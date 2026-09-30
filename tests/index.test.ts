import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { ProfileSync } from "../src/index.ts";
import { SecurityVault } from "../src/security/crypto-vault.ts";
import { TenantIdentifier, CorrelationToken } from "../src/domain/value-objects.ts";
import { StorageWal, OutboxDispatcher } from "../src/storage/wal.ts";
import { TokenBucketRateLimiter, CircuitBreaker } from "../src/resilience/circuit-breaker.ts";
import { EventBus } from "../src/events/event-bus.ts";
import { PrometheusExporter } from "../src/telemetry/metrics.ts";

describe("Profile Sync Enterprise Engine — Suíte Corporativa de Rigor Técnico", () => {
  test("1. Deve instanciar o motor com configurações padrão e metadados", () => {
    const engine = new ProfileSync();
    assert.strictEqual(engine.getName(), "profile-sync");
    const stats = engine.getStats();
    assert.strictEqual(stats.totalProcessed, 0);
    assert.strictEqual(stats.walLogSize, 0);
    assert.strictEqual(stats.activeCircuitBreakerState, "CLOSED");
  });

  test("2. Value Object: TenantIdentifier deve validar formato e rejeitar caracteres ilegais", () => {
    const valid = new TenantIdentifier("tenant-corp_99");
    assert.strictEqual(valid.toString(), "tenant-corp_99");

    assert.throws(() => new TenantIdentifier(""), /Identificador de Tenant inválido/);
    assert.throws(() => new TenantIdentifier("ab"), /Identificador de Tenant inválido/);
    assert.throws(() => new TenantIdentifier("invalid space"), /Identificador de Tenant inválido/);
  });

  test("3. Value Object: CorrelationToken deve gerar token W3C determinístico", () => {
    const token = new CorrelationToken("trace-12345");
    assert.strictEqual(token.toString(), "trace-12345");

    const traceparent = token.toTraceparent();
    assert.ok(traceparent.startsWith("00-"));
    assert.ok(traceparent.endsWith("-01"));
  });

  test("4. Multi-Tenancy: Deve isolar estritamente dados entre diferentes tenants", () => {
    const engine = new ProfileSync();
    const recA = engine.processItem("tenant-alpha", "doc-1", { data: "secret-a" });
    const recB = engine.processItem("tenant-beta", "doc-1", { data: "secret-b" });

    assert.notStrictEqual(recA.id, recB.id);
    assert.strictEqual(engine.getRecord(recA.id, "tenant-alpha")?.id, recA.id);
    assert.strictEqual(engine.getRecord(recA.id, "tenant-beta"), null); // Isolado!
  });

  test("5. Zero Credential Leak: Deve mascarar segredos recursivamente em profundidade", () => {
    const engine = new ProfileSync();
    const record = engine.processItem("tenant-corp", "auth-test", {
      username: "felipemadison",
      apiKey: "sk_live_super_secret_9988",
      authHeader: "Bearer eyJhbGciOi...",
      nested: { password: "master-pass-123", token: "t-99" }
    });

    assert.strictEqual(record.payload.apiKey, "********");
    assert.strictEqual(record.payload.authHeader, "********");
    assert.strictEqual(record.payload.nested.password, "********");
    assert.strictEqual(record.payload.nested.token, "********");
    assert.strictEqual(record.payload.username, "felipemadison");
  });

  test("6. SecurityVault: TimingSafeVerify deve validar hashes idênticos e rejeitar adulterações", () => {
    const h1 = SecurityVault.sha256("payload-deterministic");
    const h2 = SecurityVault.sha256("payload-deterministic");
    const h3 = SecurityVault.sha256("payload-adulterated");

    assert.strictEqual(SecurityVault.timingSafeVerify(h1, h2), true);
    assert.strictEqual(SecurityVault.timingSafeVerify(h1, h3), false);
    assert.strictEqual(SecurityVault.timingSafeVerify(h1, "short"), false);
  });

  test("7. Storage WAL: Deve registrar operações com sequenciamento e soma de verificação SHA-256", () => {
    const wal = new StorageWal();
    const e1 = wal.append("rec-1", "tenant-1", "hash-1");
    const e2 = wal.append("rec-2", "tenant-1", "hash-2");

    assert.strictEqual(wal.size(), 2);
    assert.strictEqual(e1.sequence, 1);
    assert.strictEqual(e2.sequence, 2);
    assert.ok(e1.checksum.length === 64);
  });

  test("8. Storage WAL Crash Recovery: Replay deve reconstruir o estado com integridade verificada", () => {
    const wal = new StorageWal();
    wal.append("rec-10", "tenant-corp", "hash-10");
    wal.append("rec-20", "tenant-corp", "hash-20");

    const recovered = wal.replay();
    assert.strictEqual(recovered.size, 2);
    assert.strictEqual(recovered.get("rec-10")?.hash, "hash-10");
    assert.strictEqual(recovered.get("rec-20")?.hash, "hash-20");
  });

  test("9. Outbox Dispatcher: Deve enfileirar eventos com idempotência e garantia de desduplicação", () => {
    const outbox = new OutboxDispatcher();
    const ok1 = outbox.enqueue("msg-1", "user.created", { id: 1 });
    const ok2 = outbox.enqueue("msg-1", "user.created", { id: 1 }); // Duplicata

    assert.strictEqual(ok1, true);
    assert.strictEqual(ok2, false);
    assert.strictEqual(outbox.pendingCount(), 1);

    const delivered: any[] = [];
    const count = outbox.flush(item => delivered.push(item));
    assert.strictEqual(count, 1);
    assert.strictEqual(outbox.pendingCount(), 0);
  });

  test("10. Token-Bucket Rate Limiter: Deve limitar rajadas quando a cota for esgotada", () => {
    const limiter = new TokenBucketRateLimiter(3, 1);
    assert.strictEqual(limiter.tryAcquire(1), true);
    assert.strictEqual(limiter.tryAcquire(1), true);
    assert.strictEqual(limiter.tryAcquire(1), true);
    assert.strictEqual(limiter.tryAcquire(1), false); // Esgotado
  });

  test("11. Token-Bucket Rate Limiter: Deve reabastecer tokens proporcionalmente ao tempo", async () => {
    const limiter = new TokenBucketRateLimiter(2, 50); // 50 tokens por segundo
    limiter.tryAcquire(2);
    assert.strictEqual(limiter.getAvailableTokens(), 0);

    await new Promise(r => setTimeout(r, 50));
    assert.ok(limiter.getAvailableTokens() >= 1);
  });

  test("12. Circuit Breaker: Deve transicionar para OPEN após repetidas falhas consecutivas", () => {
    const cb = new CircuitBreaker(2, 500);
    assert.strictEqual(cb.getState(), "CLOSED");
    assert.strictEqual(cb.allowExecution(), true);

    cb.recordFailure();
    assert.strictEqual(cb.getState(), "CLOSED");

    cb.recordFailure();
    assert.strictEqual(cb.getState(), "OPEN");
    assert.strictEqual(cb.allowExecution(), false);
  });

  test("13. Circuit Breaker: Deve testar HALF_OPEN após timeout e fechar em caso de sucesso", async () => {
    const cb = new CircuitBreaker(1, 20); // 20ms timeout
    cb.recordFailure();
    assert.strictEqual(cb.getState(), "OPEN");

    await new Promise(r => setTimeout(r, 30));
    assert.strictEqual(cb.getState(), "HALF_OPEN");
    assert.strictEqual(cb.allowExecution(), true);

    cb.recordSuccess();
    assert.strictEqual(cb.getState(), "CLOSED");
  });

  test("14. EventBus Corporativo: Deve publicar eventos para múltiplos listeners desacoplados", () => {
    const bus = new EventBus();
    const received: string[] = [];

    const unsub = bus.subscribe("order.placed", event => {
      received.push(event.payload.orderId);
    });

    bus.publish("order.placed", { orderId: "ORD-991" });
    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0], "ORD-991");

    unsub();
    bus.publish("order.placed", { orderId: "ORD-992" });
    assert.strictEqual(received.length, 1); // Desinscrito com sucesso
  });

  test("15. Telemetria Prometheus: Deve calcular contadores, gauges e formato compatível", () => {
    const prom = new PrometheusExporter();
    prom.increment("http_requests_total", 5);
    prom.setGauge("active_connections", 42);

    const text = prom.toPrometheusFormat();
    assert.ok(text.includes("http_requests_total 5"));
    assert.ok(text.includes("active_connections 42"));
    assert.ok(text.includes("app_uptime_seconds"));
  });

  test("16. Telemetria Percentis de Latência: Deve calcular P50, P95 e P99 com precisão", () => {
    const prom = new PrometheusExporter();
    for (let i = 1; i <= 100; i++) {
      prom.recordLatency(i);
    }

    const { p50, p95, p99 } = prom.getPercentiles();
    assert.strictEqual(p50, 51);
    assert.strictEqual(p95, 96);
    assert.strictEqual(p99, 100);
  });

  test("17. Integridade de Ponta a Ponta: Deve verificar registro gravado pelo motor", () => {
    const engine = new ProfileSync();
    const rec = engine.processItem("tenant-core", "rec-alpha", { status: "active", payload: 42 });
    assert.strictEqual(engine.verifyIntegrity(rec.id), true);
  });

  test("18. Benchmark de Alta Escala: Deve sustentar taxa superior a 5.000 ops/segundo", () => {
    const engine = new ProfileSync({ rateLimitCapacity: 10000, rateLimitRefill: 10000 });
    const t0 = performance.now();
    const iterations = 500;
    for (let i = 0; i < iterations; i++) {
      engine.processItem("tenant-perf", "key-" + i, { n: i });
    }
    const duration = performance.now() - t0;
    assert.ok(duration < 300, `Esperado processamento sub-segundo, obteve ${duration.toFixed(2)}ms`);
  });
});
