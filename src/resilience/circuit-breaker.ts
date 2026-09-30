export class TokenBucketRateLimiter {
  private capacity: number;
  private tokens: number;
  private refillRatePerSec: number;
  private lastRefill: number;

  constructor(capacity = 50, refillRatePerSec = 10) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillRatePerSec = refillRatePerSec;
    this.lastRefill = Date.now();
  }

  public tryAcquire(cost = 1): boolean {
    this.refill();
    if (this.tokens >= cost) {
      this.tokens -= cost;
      return true;
    }
    return false;
  }

  public getAvailableTokens(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefill) / 1000;
    if (elapsedSeconds > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillRatePerSec);
      this.lastRefill = now;
    }
  }
}

export class CircuitBreaker {
  private failureCount = 0;
  private threshold: number;
  private resetTimeoutMs: number;
  private state: "CLOSED" | "OPEN" | "HALF_OPEN" = "CLOSED";
  private nextAttempt: number = Date.now();

  constructor(threshold = 3, resetTimeoutMs = 1000) {
    this.threshold = threshold;
    this.resetTimeoutMs = resetTimeoutMs;
  }

  public getState(): "CLOSED" | "OPEN" | "HALF_OPEN" {
    if (this.state === "OPEN" && Date.now() >= this.nextAttempt) {
      this.state = "HALF_OPEN";
    }
    return this.state;
  }

  public recordSuccess(): void {
    this.failureCount = 0;
    this.state = "CLOSED";
  }

  public recordFailure(): void {
    this.failureCount++;
    if (this.failureCount >= this.threshold) {
      this.state = "OPEN";
      this.nextAttempt = Date.now() + this.resetTimeoutMs;
    }
  }

  public allowExecution(): boolean {
    const s = this.getState();
    return s === "CLOSED" || s === "HALF_OPEN";
  }
}
