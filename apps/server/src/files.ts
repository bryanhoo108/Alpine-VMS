import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

/** Types people may upload. SVG is only produced by the LPR mock, never accepted from users. */
export const isAllowedUpload = (contentType: string) =>
  contentType in EXTENSIONS && contentType !== 'image/svg+xml';

/** Files live under filesDir/YYYY/MM/DD/<uuid>.<ext>; the DB stores the relative path. */
export class FileStore {
  constructor(private readonly root: string) {}

  async save(data: Buffer, contentType: string, at: Date): Promise<string> {
    const ext = EXTENSIONS[contentType];
    if (!ext) throw new Error(`unsupported file type ${contentType}`);
    const day = at.toISOString().slice(0, 10).split('-');
    const rel = path.posix.join(...day, `${randomUUID()}.${ext}`);
    const abs = this.resolve(rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, data);
    return rel;
  }

  read(rel: string): Promise<Buffer> {
    return readFile(this.resolve(rel));
  }

  remove(rel: string): Promise<void> {
    return rm(this.resolve(rel), { force: true });
  }

  private resolve(rel: string): string {
    const abs = path.resolve(this.root, rel);
    if (!abs.startsWith(path.resolve(this.root) + path.sep)) throw new Error('bad file path');
    return abs;
  }
}
