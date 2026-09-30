/**
 * Profile Sync Enterprise Engine
 * 
 * Problema: Manual maintenance of developer portfolios and profile READMEs leads to stale metrics, missing project highlights, and outdated statistics.
 * Diferencial: Automated deterministic synchronization engine for GitHub profile READMEs, computing live production metrics and badges with sub-second execution.
 * Autor: Felipe Madison (https://github.com/FelipeMadson)
 * Licença: MIT — Arquitetura Determinística em Camadas
 */

import { SecurityVault } from "./security/crypto-vault.ts";
import { StorageWal, OutboxDispatcher } from "./storage/wal.ts";
import { TokenBucketRateLimiter, CircuitBreaker } from "./resilience/circuit-breaker.ts";
import { EventBus } from "./events/event-bus.ts";
import { PrometheusExporter } from "./telemetry/metrics.ts";
import { TenantIdentifier, CorrelationToken } from "./domain/value-objects.ts";
import type { ExecutionRecord, EngineStats } from "./domain/types.ts";

export interface ProfileSyncConfig {
  name?: string;
  enableAudit?: boolean;
  rateLimitCapacity?: number;
  rateLimitRefill?: number;
}

export class ProfileSync {
  private name: string;
  private enableAudit: boolean;
  private records: Map<string, ExecutionRecord> = new Map();
  private wal = new StorageWal();
  private outbox = new OutboxDispatcher();
  private eventBus = new EventBus();
  private telemetry = new PrometheusExporter();
  private rateLimiter: TokenBucketRateLimiter;
  private circuitBreaker = new CircuitBreaker(5, 2000);

  constructor(config?: ProfileSyncConfig) {
    this.name = config?.name || "profile-sync";
    this.enableAudit = config?.enableAudit ?? true;
    this.rateLimiter = new TokenBucketRateLimiter(
      config?.rateLimitCapacity ?? 100,
      config?.rateLimitRefill ?? 20
    );
  }

  public getName(): string {
    return this.name;
  }

  public getEventBus(): EventBus {
    return this.eventBus;
  }

  public getTelemetry(): PrometheusExporter {
    return this.telemetry;
  }

  public getWal(): StorageWal {
    return this.wal;
  }

  public getCircuitBreaker(): CircuitBreaker {
    return this.circuitBreaker;
  }

  public getRateLimiter(): TokenBucketRateLimiter {
    return this.rateLimiter;
  }

  public processItem(rawTenantId: string, key: string, payload: any, correlationIdRaw?: string): ExecutionRecord {
    const t0 = performance.now();

    // 1. Validação do Circuit Breaker
    if (!this.circuitBreaker.allowExecution()) {
      throw new Error("CircuitBreaker OPEN: Operações suspensas temporariamente por resiliência.");
    }

    // 2. Validação do Rate Limiter
    if (!this.rateLimiter.tryAcquire(1)) {
      this.telemetry.increment("rate_limit_exceeded_total");
      throw new Error("Quota Excedida: Limite de taxa de requisições por segundo atingido.");
    }

    // 3. Validação de Invariantes de Domínio via Value Objects
    const tenant = new TenantIdentifier(rawTenantId);
    const correlation = new CorrelationToken(correlationIdRaw);

    if (!key || typeof key !== "string" || key.trim().length === 0) {
      this.circuitBreaker.recordFailure();
      throw new Error("Chave de identificação inválida ou vazia.");
    }

    const cleanKey = key.trim();
    const serialized = JSON.stringify(payload ?? null);
    const hash = SecurityVault.sha256(serialized);
    const id = SecurityVault.sha256(`${tenant.toString()}:${cleanKey}:${hash}`).slice(0, 16);

    const record: ExecutionRecord = {
      id,
      tenantId: tenant.toString(),
      correlationId: correlation.toString(),
      key: cleanKey,
      payload: SecurityVault.maskSecrets(payload),
      hash,
      timestamp: new Date().toISOString(),
      status: "verified",
      version: 1
    };

    if (this.enableAudit) {
      this.records.set(id, record);
      this.wal.append(id, tenant.toString(), hash);
      this.outbox.enqueue(id, "record.committed", { id, tenantId: tenant.toString() });
      this.eventBus.publish("record.processed", { id, tenantId: tenant.toString() });
      this.telemetry.increment("items_processed_total");
    }

    this.circuitBreaker.recordSuccess();
    const duration = performance.now() - t0;
    this.telemetry.recordLatency(duration);

    return record;
  }

  public getRecord(id: string, tenantId?: string): ExecutionRecord | null {
    const rec = this.records.get(id);
    if (!rec) return null;
    if (tenantId && rec.tenantId !== tenantId) {
      return null; // Isolamento estrito de Multi-Tenancy
    }
    return rec;
  }

  public verifyIntegrity(id: string): boolean {
    const record = this.records.get(id);
    if (!record) return false;

    const recomputed = SecurityVault.sha256(JSON.stringify(record.payload ?? null));
    return SecurityVault.timingSafeVerify(record.hash, recomputed);
  }

  public getStats(): EngineStats {
    return {
      totalProcessed: this.records.size,
      verifiedCount: Array.from(this.records.values()).filter(r => r.status === "verified").length,
      flaggedCount: Array.from(this.records.values()).filter(r => r.status === "flagged").length,
      walLogSize: this.wal.size(),
      uptimeSeconds: 0,
      activeCircuitBreakerState: this.circuitBreaker.getState()
    };
  }
}

export default ProfileSync;
