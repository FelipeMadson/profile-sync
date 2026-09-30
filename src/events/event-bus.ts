import { randomUUID } from "node:crypto";
import type { DomainEvent } from "../domain/types.ts";

export type EventHandler<T = any> = (event: DomainEvent<T>) => void | Promise<void>;

export class EventBus {
  private handlers: Map<string, EventHandler[]> = new Map();
  private history: DomainEvent[] = [];

  public subscribe(eventType: string, handler: EventHandler): () => void {
    const list = this.handlers.get(eventType) || [];
    list.push(handler);
    this.handlers.set(eventType, list);
    return () => {
      const idx = list.indexOf(handler);
      if (idx !== -1) list.splice(idx, 1);
    };
  }

  public publish<T = any>(eventType: string, payload: T): DomainEvent<T> {
    const event: DomainEvent<T> = {
      eventId: randomUUID(),
      eventType,
      occurredAt: new Date().toISOString(),
      payload
    };
    this.history.push(event);

    const listeners = this.handlers.get(eventType) || [];
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error(`Erro no handler do evento ${eventType}:`, err);
      }
    }
    return event;
  }

  public getHistory(): DomainEvent[] {
    return [...this.history];
  }
}
