export class PrometheusExporter {
  private startTime = Date.now();
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();
  private latencies: number[] = [];

  public increment(metric: string, n = 1): void {
    const curr = this.counters.get(metric) || 0;
    this.counters.set(metric, curr + n);
  }

  public setGauge(metric: string, val: number): void {
    this.gauges.set(metric, val);
  }

  public recordLatency(ms: number): void {
    this.latencies.push(ms);
    if (this.latencies.length > 5000) {
      this.latencies.shift();
    }
  }

  public getPercentiles(): { p50: number; p95: number; p99: number } {
    if (this.latencies.length === 0) return { p50: 0, p95: 0, p99: 0 };
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
    const p99 = sorted[Math.floor(sorted.length * 0.99)] || 0;
    return { p50, p95, p99 };
  }

  public toPrometheusFormat(): string {
    const lines: string[] = [
      "# HELP app_uptime_seconds Tempo de atividade em segundos",
      "# TYPE app_uptime_seconds gauge",
      `app_uptime_seconds ${Math.floor((Date.now() - this.startTime) / 1000)}`
    ];

    for (const [k, v] of this.counters.entries()) {
      lines.push(`# TYPE ${k} counter`, `${k} ${v}`);
    }

    for (const [k, v] of this.gauges.entries()) {
      lines.push(`# TYPE ${k} gauge`, `${k} ${v}`);
    }

    const { p50, p95, p99 } = this.getPercentiles();
    lines.push(
      "# HELP app_latency_ms Percentis de latência em milissegundos",
      "# TYPE app_latency_ms summary",
      `app_latency_ms{quantile="0.5"} ${p50.toFixed(2)}`,
      `app_latency_ms{quantile="0.95"} ${p95.toFixed(2)}`,
      `app_latency_ms{quantile="0.99"} ${p99.toFixed(2)}`
    );

    return lines.join("\n");
  }
}
