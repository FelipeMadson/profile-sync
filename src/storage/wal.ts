import { SecurityVault } from "../security/crypto-vault.ts";

export interface WalEntry {
  sequence: number;
  id: string;
  tenantId: string;
  hash: string;
  timestamp: string;
  checksum: string;
}

export class StorageWal {
  private log: WalEntry[] = [];
  private sequenceCounter = 0;

  public append(id: string, tenantId: string, hash: string): WalEntry {
    this.sequenceCounter++;
    const timestamp = new Date().toISOString();
    const checksum = SecurityVault.sha256(`${this.sequenceCounter}:${id}:${tenantId}:${hash}:${timestamp}`);
    const entry: WalEntry = {
      sequence: this.sequenceCounter,
      id,
      tenantId,
      hash,
      timestamp,
      checksum
    };
    this.log.push(entry);
    return entry;
  }

  public size(): number {
    return this.log.length;
  }

  public getEntries(): WalEntry[] {
    return [...this.log];
  }

  public replay(): Map<string, { id: string; tenantId: string; hash: string }> {
    const state = new Map<string, { id: string; tenantId: string; hash: string }>();
    for (const entry of this.log) {
      const expectedChecksum = SecurityVault.sha256(`${entry.sequence}:${entry.id}:${entry.tenantId}:${entry.hash}:${entry.timestamp}`);
      if (SecurityVault.timingSafeVerify(entry.checksum, expectedChecksum)) {
        state.set(entry.id, { id: entry.id, tenantId: entry.tenantId, hash: entry.hash });
      }
    }
    return state;
  }

  public clear(): void {
    this.log = [];
    this.sequenceCounter = 0;
  }
}

export class OutboxDispatcher {
  private queue: Array<{ id: string; eventType: string; payload: any; delivered: boolean }> = [];
  private processedIds: Set<string> = new Set();

  public enqueue(id: string, eventType: string, payload: any): boolean {
    if (this.processedIds.has(id)) {
      return false; // Idempotência: rejeita duplicata
    }
    this.processedIds.add(id);
    this.queue.push({ id, eventType, payload, delivered: false });
    return true;
  }

  public flush(consumer: (item: { id: string; eventType: string; payload: any }) => void): number {
    let count = 0;
    for (const item of this.queue) {
      if (!item.delivered) {
        consumer(item);
        item.delivered = true;
        count++;
      }
    }
    return count;
  }

  public pendingCount(): number {
    return this.queue.filter(i => !i.delivered).length;
  }
}
