import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export class SecurityVault {
  public static sha256(data: string | Buffer): string {
    return createHash("sha256").update(data).digest("hex");
  }

  public static hmacSha256(data: string, secret: string): string {
    return createHmac("sha256", secret).update(data).digest("hex");
  }

  public static timingSafeVerify(expectedHex: string, actualHex: string): boolean {
    if (expectedHex.length !== actualHex.length) return false;
    const a = Buffer.from(expectedHex);
    const b = Buffer.from(actualHex);
    return timingSafeEqual(a, b);
  }

  public static maskSecrets(obj: any): any {
    if (!obj || typeof obj !== "object") return obj;
    const clone = Array.isArray(obj) ? [...obj] : { ...obj };
    for (const key of Object.keys(clone)) {
      if (/key|token|secret|password|auth|credential|bearer|private/i.test(key)) {
        clone[key] = "********";
      } else if (typeof clone[key] === "object") {
        clone[key] = this.maskSecrets(clone[key]);
      }
    }
    return clone;
  }
}
