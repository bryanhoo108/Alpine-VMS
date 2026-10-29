/**
 * Text from an IC photo, on this server: Tesseract with the English model
 * bundled in node_modules, so nothing is downloaded and the gate works offline.
 * One worker, started on first use and reused; photos are read one at a time.
 *
 * Photos are cleaned up first (grey, contrast stretched, sharpened). The
 * device crops the photo to the card outline, and the number and name are
 * in the left part of a MyKad, so that part is read first: on 36 cropped
 * sample photos (tilted, glare, dim, upside down) all numbers and names were
 * read at about 1 s of CPU each. Other angles and the whole photo are tried
 * after (icRead.ts).
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import sharp from 'sharp';
import { createWorker, type Worker } from 'tesseract.js';

// One image at a time and no cache: the server may be small (512 MB demo).
sharp.cache(false);
sharp.concurrency(1);

export interface ReadArea {
  /** Degrees to turn the photo first. */
  angle: number;
  /** Fraction of the width to read, from the left (1 = whole photo). */
  part: number;
}

export interface IcReader {
  /** Raw text seen on that area of the photo. */
  text(image: Buffer, area: ReadArea): Promise<string>;
  close(): Promise<void>;
}

/** Cleaned-up copy of an area of the photo for reading. */
export async function prepare(image: Buffer, { angle, part }: ReadArea): Promise<Buffer> {
  // Upright (a phone's EXIF orientation) and turned, each a step of its own:
  // one sharp pipeline keeps only its last rotate(), and the left part must be
  // cut from the turned photo. Uncompressed in between, so the steps are cheap.
  const { orientation } = await sharp(image).metadata();
  let turned = image;
  if (orientation && orientation > 1) {
    turned = await sharp(turned).rotate().png({ compressionLevel: 0 }).toBuffer();
  }
  if (angle !== 0) {
    turned = await sharp(turned)
      .rotate(angle, { background: '#ffffff' })
      .png({ compressionLevel: 0 })
      .toBuffer();
  }
  const { width = 0, height = 0 } = await sharp(turned).metadata();
  let img = sharp(turned);
  if (part < 1) img = img.extract({ left: 0, top: 0, width: Math.round(width * part), height });
  img = img.grayscale().normalize();
  // Whole, uncropped photos read best enlarged; cropped cards are big enough.
  if (part === 1) img = img.resize({ width: 2000 });
  return img.sharpen().jpeg({ quality: 92 }).toBuffer();
}

export class TesseractIcReader implements IcReader {
  private worker: Promise<Worker> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * warm: load the model now rather than on the first IC photo (loading takes
   * a few seconds of CPU, much longer on a small server).
   */
  constructor(opts: { warm?: boolean } = {}) {
    if (opts.warm) this.start().catch(() => (this.worker = null));
  }

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

  text(image: Buffer, area: ReadArea): Promise<string> {
    const run = this.queue.then(
      async () => (await (await this.start()).recognize(await prepare(image, area))).data.text,
    );
    this.queue = run.catch(() => undefined);
    return run;
  }

  async close() {
    if (this.worker) await (await this.worker).terminate();
    this.worker = null;
  }
}
