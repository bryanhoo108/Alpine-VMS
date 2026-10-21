import type { AlertNotice, Notifier } from './Notifier.js';

/** Keeps notices in memory and logs them. Screens read alerts from the database. */
export class LogNotifier implements Notifier {
  readonly sent: AlertNotice[] = [];

  constructor(private readonly log: (line: string) => void = () => {}) {}

  async notify(notice: AlertNotice): Promise<void> {
    this.sent.push(notice);
    const who = notice.alert.notify.join(', ') || 'screen only';
    this.log(
      `[alert] ${notice.alert.level.toUpperCase()} ${notice.alert.type} ` +
        `trip=${notice.tripNo ?? '-'} plate=${notice.plate ?? '-'} to=${who}`,
    );
  }
}
