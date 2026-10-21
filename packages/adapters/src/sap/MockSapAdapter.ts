import { systemClock, type Clock } from '../clock.js';
import { sapSampleData, type SapSampleData } from './sample-data.js';
import type {
  DoUdfs,
  SapAdapter,
  SapBusinessPartner,
  SapDo,
  SapDoLine,
  SapSdo,
} from './SapAdapter.js';

export interface UdfWrite {
  doNo: string;
  udfs: DoUdfs;
  idempotencyKey: string;
  at: Date;
}

/** Lines to copy from one SDO into a new DO; all lines in full when `lines` is omitted. */
export type DoSource = string | { sdoNo: string; lines: { lineNo: number; pieces: number }[] };

export class SapUnavailableError extends Error {
  constructor() {
    super('SAP is unreachable (mock)');
  }
}

/** In-memory SAP with sample data, plus controls for the dev panel and tests. */
export class MockSapAdapter implements SapAdapter {
  private readonly now: Clock;
  private readonly partners: SapBusinessPartner[];
  private readonly sdos = new Map<string, SapSdo>();
  private readonly dos = new Map<string, SapDo>();
  private readonly udfs = new Map<string, DoUdfs>();
  private readonly appliedKeys = new Map<string, string>();
  private nextDoNo = 8100;
  private failuresLeft = 0;
  private offline = false;
  /** Every write that changed a DO (retries with the same key are not repeated here). */
  readonly appliedWrites: UdfWrite[] = [];

  constructor(opts: { now?: Clock; data?: SapSampleData } = {}) {
    this.now = opts.now ?? systemClock;
    const data = opts.data ?? sapSampleData(this.now());
    this.partners = structuredClone(data.partners);
    for (const s of data.sdos) this.sdos.set(s.sdoNo, structuredClone(s));
    for (const d of data.dos) this.dos.set(d.doNo, structuredClone(d));
  }

  // --- SapAdapter -----------------------------------------------------------

  async listOpenSdos(opts: { updatedSince?: Date } = {}): Promise<SapSdo[]> {
    this.reach();
    const since = opts.updatedSince?.getTime() ?? -Infinity;
    return [...this.sdos.values()]
      .filter((s) => s.status === 'open' && s.updatedAt.getTime() > since)
      .map((s) => structuredClone(s));
  }

  async getSdo(sdoNo: string): Promise<SapSdo | null> {
    this.reach();
    const s = this.sdos.get(sdoNo);
    return s ? structuredClone(s) : null;
  }

  async getDosForSdos(sdoNos: readonly string[]): Promise<SapDo[]> {
    this.reach();
    const wanted = new Set(sdoNos);
    return [...this.dos.values()]
      .filter((d) => d.lines.some((l) => l.baseSdoNo !== null && wanted.has(l.baseSdoNo)))
      .map((d) => structuredClone(d));
  }

  async listBusinessPartners(): Promise<SapBusinessPartner[]> {
    this.reach();
    return structuredClone(this.partners);
  }

  async writeDoUdfs(doNo: string, udfs: DoUdfs, idempotencyKey: string): Promise<void> {
    this.reach();
    if (this.failuresLeft > 0) {
      this.failuresLeft--;
      throw new SapUnavailableError();
    }
    if (!this.dos.has(doNo)) throw new Error(`DO ${doNo} not found`);
    const fingerprint = JSON.stringify([doNo, udfs]);
    if (this.appliedKeys.get(idempotencyKey) === fingerprint) return;
    this.appliedKeys.set(idempotencyKey, fingerprint);
    this.udfs.set(doNo, { ...this.udfs.get(doNo), ...structuredClone(udfs) });
    this.appliedWrites.push({ doNo, udfs: structuredClone(udfs), idempotencyKey, at: this.now() });
  }

  // --- Controls (dev panel and tests) ---------------------------------------

  /** Current UDF values on a DO. */
  udfsOf(doNo: string): DoUdfs | undefined {
    const u = this.udfs.get(doNo);
    return u && structuredClone(u);
  }

  /** Simulate logistics doing "Copy To" from one or more SDOs (combined DO). */
  createDo(sources: DoSource[]): SapDo {
    const lines: SapDoLine[] = [];
    let customerCode: string | undefined;
    for (const src of sources) {
      const sdoNo = typeof src === 'string' ? src : src.sdoNo;
      const sdo = this.sdos.get(sdoNo);
      if (!sdo) throw new Error(`SDO ${sdoNo} not found`);
      customerCode ??= sdo.customerCode;
      const picks =
        typeof src === 'string'
          ? sdo.lines.map((l) => ({ lineNo: l.lineNo, pieces: l.pieces }))
          : src.lines;
      for (const pick of picks) {
        const line = sdo.lines.find((l) => l.lineNo === pick.lineNo);
        if (!line) throw new Error(`SDO ${sdoNo} has no line ${pick.lineNo}`);
        lines.push({
          lineNo: lines.length,
          itemCode: line.itemCode,
          pieces: pick.pieces,
          baseSdoNo: sdoNo,
          baseLineNo: line.lineNo,
        });
      }
    }
    if (!customerCode || lines.length === 0) throw new Error('a DO needs at least one line');
    const d: SapDo = { doNo: String(this.nextDoNo++), customerCode, createdAt: this.now(), lines };
    this.dos.set(d.doNo, d);
    return structuredClone(d);
  }

  /** Simulate an SDO amendment (changes the line and SAP's update stamp). */
  amendSdoLine(
    sdoNo: string,
    lineNo: number,
    changes: Partial<Omit<SapSdo['lines'][number], 'lineNo'>>,
  ) {
    const sdo = this.sdos.get(sdoNo);
    const line = sdo?.lines.find((l) => l.lineNo === lineNo);
    if (!sdo || !line) throw new Error(`SDO ${sdoNo} line ${lineNo} not found`);
    Object.assign(line, changes);
    sdo.updatedAt = this.now();
  }

  /** Make the next n UDF writes fail, to exercise the retry queue. */
  failNextWrites(n: number) {
    this.failuresLeft = n;
  }

  /** Make every call fail until set back to false. */
  setOffline(offline: boolean) {
    this.offline = offline;
  }

  private reach() {
    if (this.offline) throw new SapUnavailableError();
  }
}
