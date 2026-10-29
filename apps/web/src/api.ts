/** Small fetch wrapper. Errors carry the server's error code. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function request<T>(
  method: string,
  url: string,
  body?: unknown,
  contentType?: string,
): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: {} };
  if (body instanceof Blob) {
    init.body = body;
    (init.headers as Record<string, string>)['content-type'] = contentType ?? body.type;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['content-type'] = 'application/json';
  }
  const res = await fetch(url, init);
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok)
    throw new ApiError(
      res.status,
      (data as { error?: string } | null)?.error ?? `HTTP_${res.status}`,
    );
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
  upload: <T>(url: string, blob: Blob) => request<T>('POST', url, blob),
};

// --- Types shared with the server responses ---------------------------------

export type Role = 'guard' | 'clerk' | 'checker' | 'supervisor' | 'admin';

export interface Me {
  id: string;
  displayName: string;
  role: Role;
}

export interface Person {
  username: string;
  displayName: string;
  role: Role;
}

export type AlertLevel = 'amber' | 'red' | 'logged';

export interface Alert {
  type: string;
  level: AlertLevel;
  label: string;
  detail?: Record<string, string>;
}

export interface PreReg {
  id: string;
  plate: string;
  expectedDate: string;
  late: boolean;
  sdoNos: string[];
  transporterId: string | null;
}

export interface EntryState {
  read: {
    id: string;
    plate: string;
    confidence: number;
    photoId: string | null;
    readAt: string;
    transporterId: string | null;
    preRegistration: PreReg | null;
    alerts: Alert[];
  } | null;
  openPreRegistrations: PreReg[];
  transporters: { id: string; name: string }[];
}

export interface GateInResponse {
  trip: { id: string; tripNo: string; plate: string; type: 'outbound' | 'inbound' };
  cardNo: string;
  sdoNos: string[];
  alerts: Alert[];
}

export const photoUrl = (id: string) => `/api/photos/${id}`;

// --- Office (clerk) ------------------------------------------------------------

export interface TripSummary {
  id: string;
  tripNo: string;
  type: 'outbound' | 'inbound';
  plate: string;
  transporterName: string | null;
  gateInAt: string;
  gateOutAt: string | null;
  exitLevel: 'green' | 'amber' | 'red' | null;
  preAdvised: boolean;
  sdoNos: string[];
  stage: {
    matched: boolean;
    weighedIn: boolean;
    weighedOut: boolean;
    checked: 'approve' | 'reject' | null;
    doCount: number;
  };
  alertLevel: 'red' | 'amber' | null;
}

export interface SdoLine {
  lineNo: number;
  size: string;
  spec: string;
  length: string;
  pieces: number;
}

export interface SdoView {
  sdoNo: string;
  customerName: string | null;
  status: string | null;
  docDate: string | null;
  lines: SdoLine[];
}

export interface OfficeAlert {
  id: string;
  type: string;
  label: string;
  level: AlertLevel;
  detail: Record<string, string> | null;
  raisedAt: string;
  clearedAt: string | null;
  clearReason: string | null;
  tripId?: string | null;
  tripNo?: string | null;
  plate?: string | null;
}

export interface TripDetail {
  id: string;
  tripNo: string;
  type: 'outbound' | 'inbound';
  status: 'on_site' | 'closed';
  plate: string;
  gateInAt: string;
  gateInBy: string | null;
  transporterId: string | null;
  transporterName: string | null;
  driver: { name: string | null; icLast4: string | null } | null;
  preAdvised: boolean;
  photos: { id: string; kind: 'plate' | 'ic' | 'document' | 'load' }[];
  sdos: (SdoView & { source: 'pre_registration' | 'clerk'; linkedAt: string; changed: boolean })[];
  shortlist: (SdoView & { reason: 'on_ticket' | 'usual_customer' | 'open' })[];
  tickets: {
    ticketNo: string;
    plate: string;
    plateDiffers: boolean;
    sdoNos: string[];
    weighInAt: string | null;
    weighOutAt: string | null;
  }[];
  dos: TripDos;
  alerts: OfficeAlert[];
}

export interface DoView {
  doNo: string;
  createdAt: string;
  lines: {
    lineNo: number;
    itemCode: string;
    pieces: number;
    sdoNo: string | null;
    sdoLineNo: number | null;
  }[];
}

export interface TripDos {
  linked: (DoView & {
    source: 'auto' | 'clerk';
    sap: {
      status: 'pending' | 'done' | 'failed' | 'superseded';
      attempts: number;
      lastError: string | null;
    } | null;
  })[];
  candidates: (DoView & {
    reason: 'before_gate_in' | 'other_truck' | 'unlinked' | 'needs_clerk';
    otherTripNo: string | null;
  })[];
  sdosWithoutDo: string[];
  unlinkedSdosOnDos: string[];
}

export interface PreRegRow {
  id: string;
  plate: string;
  expectedDate: string;
  sdoNos: string[];
  transporterId: string | null;
  transporterName: string | null;
  note: string | null;
  status: 'expected' | 'late' | 'arrived' | 'cleared';
  tripNo: string | null;
  clearReason: string | null;
}

export interface OfficeLists {
  transporters: { id: string; name: string }[];
  openSdos: { sdoNo: string; customerName: string; docDate: string }[];
  today: string;
}

// --- Checker ---------------------------------------------------------------------

export type RejectReason = 'wrong_item' | 'wrong_quantity' | 'damaged' | 'other';

export interface QueueItem {
  id: string;
  tripNo: string;
  plate: string;
  transporterName: string | null;
  sdoNos: string[];
  gateInAt: string;
  weighedIn: boolean;
  lastDecision: 'reject' | null;
}

export interface CheckSdo {
  sdoNo: string;
  customerName: string | null;
  version: string | null;
  changed: boolean;
  changes: { lineNo: number; change: 'added' | 'removed' | 'changed' }[];
  doNos: string[];
  lines: (SdoLine & { expected: number; from: 'do' | 'sdo' })[];
}

export interface CheckView {
  id: string;
  tripNo: string;
  plate: string;
  transporterName: string | null;
  gateInAt: string;
  offline: boolean;
  sdos: CheckSdo[];
  lastDecision: {
    decision: 'approve' | 'reject';
    reason: RejectReason | null;
    decidedAt: string;
    checkerName: string;
  } | null;
}

export interface DecisionResponse {
  decision: 'approve' | 'reject';
  decidedAt: string;
  differences: { sdoNo: string; lineNo: number; expectedPieces: number; actualPieces: number }[];
}

// --- Gate out --------------------------------------------------------------------

export interface ExitTruck {
  id: string;
  tripNo: string;
  plate: string;
  type: 'outbound' | 'inbound';
  transporterName: string | null;
  gateInAt: string;
  status: { level: 'green' | 'amber' | 'red'; reasons: Alert[] };
}

export interface ExitState {
  read: {
    id: string;
    plate: string;
    confidence: number;
    photoId: string | null;
    readAt: string;
  } | null;
  truck: ExitTruck | null;
  onSite: { id: string; tripNo: string; plate: string; type: 'outbound' | 'inbound' }[];
}

export interface GateOutResponse {
  trip: { id: string; tripNo: string; plate: string; type: 'outbound' | 'inbound' };
  status: ExitTruck['status'];
  cardReturned: boolean;
}

// --- Timeline and overview --------------------------------------------------------

export interface TimelineEvent {
  at: string;
  kind: string;
  title: string;
  detail: string | null;
  tone: 'ok' | 'warn' | 'bad' | 'info' | 'muted';
  actor: string | null;
}

export interface Timeline {
  id: string;
  tripNo: string;
  plate: string;
  type: 'outbound' | 'inbound';
  status: 'on_site' | 'closed';
  transporterName: string | null;
  gateInAt: string;
  gateOutAt: string | null;
  exitLevel: 'green' | 'amber' | 'red' | null;
  events: TimelineEvent[];
}

export type Stage =
  | 'Not matched'
  | 'Waiting weigh-in'
  | 'Rejected'
  | 'Waiting check'
  | 'Waiting DO'
  | 'Waiting weigh-out'
  | 'Ready to go';

export interface Overview {
  at: string;
  date: string;
  today: {
    in: number;
    out: number;
    inside: number;
    avgMinutesInside: number | null;
    exits: { green: number; amber: number; red: number };
  };
  stages: Record<Stage, number>;
  inside: {
    id: string;
    tripNo: string;
    plate: string;
    type: 'outbound' | 'inbound';
    transporterName: string | null;
    sdoNos: string[];
    minutesInside: number;
    stage: Stage;
    level: 'green' | 'amber' | 'red';
    reasons: string[];
    openAlert: 'red' | 'amber' | null;
  }[];
  openAlerts: OfficeAlert[];
  integrations: {
    sapWaiting: number;
    sapOldestWaitingAt: string | null;
    cwisWaiting: number;
    cwisOldestWaitingAt: string | null;
  };
}

// --- Visitors and contractors ---

export type VisitType = 'visitor' | 'contractor';

export interface Host {
  id: string;
  name: string;
  department: string | null;
  phone: string | null;
  active: boolean;
}

export interface Invite {
  id: string;
  code: string;
  qrText: string;
  type: VisitType;
  name: string;
  company: string | null;
  phone: string | null;
  groupSize: number;
  host: { id: string; name: string; department: string | null } | null;
  purpose: string | null;
  validFrom: string;
  validTo: string;
  untilTime: string | null;
  plate: string | null;
  createdAt: string;
  state: 'not_yet' | 'expected' | 'expired' | 'cancelled';
  insideVisitId: string | null;
  lastArrivalAt: string | null;
}

export interface VisitInResponse {
  visit: {
    id: string;
    visitNo: string;
    type: VisitType;
    name: string;
    company: string | null;
    groupSize: number;
    host: string | null;
  };
  cardNo: string;
  alerts: Alert[];
}
