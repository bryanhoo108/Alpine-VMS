/**
 * QR gate pass (decision G1). The QR holds "APMVMS-PASS:GP0007"; an RFID
 * card or a USB reader gives the number plain. Same rules as the server's
 * parsePassQr / normalizeCardNo in packages/domain.
 */
export const PASS_QR_PREFIX = 'APMVMS-PASS:';

const clean = (raw: string) => raw.toUpperCase().replace(/[^0-9A-Z]/g, '');

export const passQrText = (cardNo: string) => `${PASS_QR_PREFIX}${clean(cardNo)}`;

/** Pass number from a scanned QR; null when the QR is something else. */
export function passFromQr(text: string): string | null {
  const raw = text.trim().toUpperCase();
  if (!raw.startsWith(PASS_QR_PREFIX)) return null;
  const no = clean(raw.slice(PASS_QR_PREFIX.length));
  return no.length >= 3 ? no : null;
}

/** Pass number from anything a reader typed: a pass QR, or a plain card number. */
export const passFromInput = (text: string) => passFromQr(text) ?? clean(text);
