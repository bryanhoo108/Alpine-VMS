/**
 * Text from an IC photo, on this server: Tesseract with the English model
 * bundled in node_modules, so nothing is downloaded and the gate works offline.
 * One worker, started on first use and reused; photos are read one at a time.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { createWorker, type Worker } from 'tesseract.js';

export interface IcReader {
  /** Raw text seen on the photo. */
  text(image: Buffer): Promise<string>;
  close(): Promise<void>;
}

export class TesseractIcReader implements IcReader {
  private worker: Promise<Worker> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  private start(): Promise<Worker> {
    if (!this.worker) {
      const require = createRequire(import.meta.url);
      const data = path.dirname(require.resolve('@tesseract.js-data/eng/package.json'));
      this.worker = createWorker('eng', 1, {
        langPath: path.join(data, '4.0.0_best_int'),
        cacheMethod: 'none',
        gzip: true,
      });
    }
    return this.worker;
  }

  text(image: Buffer): Promise<string> {
    const run = this.queue.then(
      async () => (await (await this.start()).recognize(image)).data.text,
    );
    this.queue = run.catch(() => undefined);
    return run;
  }

  async close() {
    if (this.worker) await (await this.worker).terminate();
    this.worker = null;
  }
}
