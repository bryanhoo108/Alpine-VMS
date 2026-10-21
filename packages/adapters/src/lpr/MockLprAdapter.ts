import { systemClock, type Clock } from '../clock.js';
import type { Camera, LprAdapter, PlateEvent, PlateHandler } from './LprAdapter.js';
import { plateImageSvg } from './sample-plates.js';

export interface SimulateOptions {
  confidence?: number;
  /** Attach a generated plate photo (default true). */
  withPhoto?: boolean;
}

/** Plate reads come from the dev panel (simulate) or a JSON webhook body {plate, confidence}. */
export class MockLprAdapter implements LprAdapter {
  private readonly now: Clock;
  private readonly handlers = new Set<PlateHandler>();

  constructor(opts: { now?: Clock } = {}) {
    this.now = opts.now ?? systemClock;
  }

  onPlateEvent(handler: PlateHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async handleWebhook(camera: Camera, body: unknown): Promise<void> {
    if (
      typeof body !== 'object' ||
      body === null ||
      typeof (body as { plate?: unknown }).plate !== 'string'
    ) {
      throw new Error('expected a JSON body with a "plate" string');
    }
    const { plate, confidence } = body as { plate: string; confidence?: unknown };
    await this.simulate(camera, plate, {
      ...(typeof confidence === 'number' && { confidence }),
    });
  }

  /** Emit a plate read as if the camera saw it; resolves after all handlers finish. */
  async simulate(
    camera: Camera,
    plateText: string,
    opts: SimulateOptions = {},
  ): Promise<PlateEvent> {
    const event: PlateEvent = {
      camera,
      plateText,
      confidence: opts.confidence ?? 0.97,
      photo:
        opts.withPhoto === false
          ? null
          : { contentType: 'image/svg+xml', data: plateImageSvg(plateText) },
      readAt: this.now(),
    };
    for (const h of this.handlers) await h(event);
    return event;
  }
}
