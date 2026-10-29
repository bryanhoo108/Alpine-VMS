/**
 * Text from an IC photo, on this server: Tesseract with the English model
 * bundled in node_modules, so nothing is downloaded and the gate works offline.
 * One worker, started on first use and reused; photos are read one at a time.
 *
 * Photos are cleaned up first (grey, contrast stretched, enlarged, sharpened):
 * on tilted, small, dim or glary sample photos this took the number from 21
 * to 36 found out of 36, together with trying other angles (icRead.ts).
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import sharp from 'sharp';
import { createWorker, type Worker } from 'tesseract.js';

export interface IcReader {
  /** Raw text seen on the photo, turned by `angle` degrees first. */
  text(image: Buffer, angle: number): Promise<string>;
  close(): Promise<void>;
}

/** Cleaned-up copy of the photo for reading. */
export async function prepare(image: Buffer, angle: number): Promise<Buffer> {
  // Upright first (a phone's EXIF orientation), as its own step: one sharp
  // pipeline keeps only its last rotate().
  const { orientation } = await sharp(image).metadata();
  const upright =
    orientation && orientation > 1 ? await sharp(image).rotate().png().toBuffer() : image;
  return sharp(upright)
    .rotate(angle, { background: '#ffffff' })
    .grayscale()
    .normalize()
    .resize({ width: 2000 })
    .sharpen()
    .jpeg({ quality: 92 })
    .toBuffer();
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

  text(image: Buffer, angle: number): Promise<string> {
    const run = this.queue.then(
      async () => (await (await this.start()).recognize(await prepare(image, angle))).data.text,
    );
    this.queue = run.catch(() => undefined);
    return run;
  }

  async close() {
    if (this.worker) await (await this.worker).terminate();
    this.worker = null;
  }
}
