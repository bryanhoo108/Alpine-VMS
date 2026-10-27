/**
 * Licence plate recognition cameras (one at entry, one at exit).
 * Real cameras push reads over HTTP; the server's webhook route hands the
 * request body to parseWebhook, and the adapter emits a PlateEvent.
 */

export type Camera = 'entry' | 'exit';

export interface PlatePhoto {
  contentType: string;
  data: Buffer;
}

export interface PlateEvent {
  camera: Camera;
  plateText: string;
  /** 0..1, as reported by the camera. */
  confidence: number;
  photo: PlatePhoto | null;
  readAt: Date;
}

export type PlateHandler = (event: PlateEvent) => void | Promise<void>;

export interface LprAdapter {
  /** Subscribe to plate reads. Returns an unsubscribe function. */
  onPlateEvent(handler: PlateHandler): () => void;
  /** Handle a camera's HTTP push. Throws on a body it cannot parse. */
  handleWebhook(camera: Camera, body: unknown): Promise<void>;
}
