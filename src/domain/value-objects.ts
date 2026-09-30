import { randomUUID } from "node:crypto";

export class TenantIdentifier {
  private readonly value: string;

  constructor(raw: string) {
    if (!raw || typeof raw !== "string" || !/^[a-zA-Z0-9_-]{3,64}$/.test(raw.trim())) {
      throw new Error("Identificador de Tenant inválido. Deve conter entre 3 e 64 caracteres alfanuméricos.");
    }
    this.value = raw.trim();
  }

  public toString(): string {
    return this.value;
  }

  public equals(other: TenantIdentifier): boolean {
    return this.value === other.value;
  }
}

export class CorrelationToken {
  private readonly token: string;

  constructor(raw?: string) {
    this.token = raw && raw.trim().length > 0 ? raw.trim() : randomUUID();
  }

  public toString(): string {
    return this.token;
  }

  public toTraceparent(): string {
    const traceId = this.token.replace(/-/g, "").padEnd(32, "0").slice(0, 32);
    const parentId = "0000000000000001";
    return `00-${traceId}-${parentId}-01`;
  }
}
