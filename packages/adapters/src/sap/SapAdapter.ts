/**
 * SAP Business One, read SDOs / DOs / business partners and write UDFs on the
 * DO. The real implementation will use the Service Layer or the partner
 * portal's backend API (docs/SPEC.md "SAP B1 integration"). It must never
 * write SAP tables directly or post stock or accounting documents.
 */

export interface SapSdoLine {
  lineNo: number;
  itemCode: string;
  description: string;
  size: string;
  spec: string;
  length: string;
  pieces: number;
}

export interface SapSdo {
  sdoNo: string;
  customerCode: string;
  customerName: string;
  status: 'open' | 'closed';
  docDate: Date;
  /** SAP update stamp; moves on any edit (header or lines). */
  updatedAt: Date;
  lines: SapSdoLine[];
}

export interface SapDoLine {
  lineNo: number;
  itemCode: string;
  pieces: number;
  /** SDO the line was copied from ("Copy To" base document), or null. */
  baseSdoNo: string | null;
  baseLineNo: number | null;
}

export interface SapDo {
  doNo: string;
  customerCode: string;
  createdAt: Date;
  lines: SapDoLine[];
}

export interface SapBusinessPartner {
  code: string;
  name: string;
  type: 'customer' | 'transporter';
}

/** UDFs on the DO that the VMS fills in. Only fields given are written. */
export interface DoUdfs {
  plate?: string;
  wbTicket?: string;
  checkerName?: string;
  checkedAt?: Date;
  gateInAt?: Date;
  gateOutAt?: Date;
}

export interface SapAdapter {
  /** Open SDOs, optionally only those updated since a time (for cache refresh). */
  listOpenSdos(opts?: { updatedSince?: Date }): Promise<SapSdo[]>;
  /** Latest version of one SDO (open or closed), or null if unknown. */
  getSdo(sdoNo: string): Promise<SapSdo | null>;
  /** Every DO with at least one line copied from one of these SDOs. */
  getDosForSdos(sdoNos: readonly string[]): Promise<SapDo[]>;
  listBusinessPartners(): Promise<SapBusinessPartner[]>;
  /**
   * Set UDFs on a DO. Safe to retry: the same idempotency key (built from the
   * CWIS ticket number) with the same fields leaves the DO unchanged.
   * Throws when SAP is unreachable; the caller's queue retries.
   */
  writeDoUdfs(doNo: string, udfs: DoUdfs, idempotencyKey: string): Promise<void>;
}
