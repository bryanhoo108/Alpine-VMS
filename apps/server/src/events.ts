import { EventEmitter } from 'node:events';

/** Live events pushed to screens over Server-Sent Events. */
export type LiveEvent =
  | { type: 'plate_read'; camera: 'entry' | 'exit'; plateReadId: string }
  | { type: 'trip_changed'; tripId: string }
  | { type: 'visit_changed'; visitId: string }
  | { type: 'alert'; alertId: string; level: 'amber' | 'red' | 'logged' };

export class EventBus {
  private readonly emitter = new EventEmitter().setMaxListeners(200);

  publish(event: LiveEvent): void {
    this.emitter.emit('event', event);
  }

  subscribe(handler: (event: LiveEvent) => void): () => void {
    this.emitter.on('event', handler);
    return () => this.emitter.off('event', handler);
  }
}
