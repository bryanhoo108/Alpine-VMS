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
