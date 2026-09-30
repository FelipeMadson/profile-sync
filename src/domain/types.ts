export type ExecutionStatus = "IDLE" | "PROCESSING" | "COMMITTED" | "ROLLED_BACK";

export interface ExecutionRecord {
  id: string;
  tenantId: string;
  correlationId: string;
  key: string;
  payload: any;
  hash: string;
  timestamp: string;
  status: "verified" | "flagged" | "processed";
  version: number;
}

export interface EngineStats {
  totalProcessed: number;
  verifiedCount: number;
  flaggedCount: number;
  walLogSize: number;
  uptimeSeconds: number;
  activeCircuitBreakerState: "CLOSED" | "OPEN" | "HALF_OPEN";
}

export interface DomainEvent<T = any> {
  eventId: string;
  eventType: string;
  occurredAt: string;
  payload: T;
}
