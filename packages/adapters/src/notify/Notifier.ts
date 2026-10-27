import type { RaisedAlert } from '@vms/domain';

export interface AlertNotice {
  siteCode: string;
  alert: RaisedAlert;
  tripNo: string | null;
  plate: string | null;
  raisedAt: Date;
}

/**
 * Tells the supervisor (and logistics, for rejects) about an alert.
 * Phase 1 shows alerts on screen only; WhatsApp is a later implementation.
 */
export interface Notifier {
  notify(notice: AlertNotice): Promise<void>;
}
