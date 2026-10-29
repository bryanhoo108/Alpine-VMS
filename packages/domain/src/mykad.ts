/**
 * Reading a Malaysian IC (MyKad) from OCR text (decision Q2a). The number is
 * YYMMDD-PB-###G: date of birth, place-of-birth code, serial. OCR mixes up
 * look-alike characters, so digits are repaired only where a digit must be.
 * Screens only ever show the last 4 digits (CLAUDE.md "Data and privacy").
 */

export interface MyKadRead {
  /** Full number as 12 digits, or null when none was found. */
  icNumber: string | null;
  /** Name as printed (upper case), or null. */
  name: string | null;
}

/** Letters OCR confuses with digits, in a place that must be a digit. */
const DIGIT_FIX: Record<string, string> = {
  O: '0',
  D: '0',
  Q: '0',
  I: '1',
  L: '1',
  '|': '1',
  Z: '2',
  S: '5',
  B: '8',
  G: '6',
};

/** YYMMDD is a real calendar date (any century). */
function validBirthDate(yymmdd: string): boolean {
  const mm = Number(yymmdd.slice(2, 4));
  const dd = Number(yymmdd.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1) return false;
  // Leap years: 2000 is one; any YY divisible by 4 can be.
  const yy = Number(yymmdd.slice(0, 2));
  const days = [31, yy % 4 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mm - 1]!;
  return dd <= days;
}

/** Place-of-birth code 00 is never issued. */
export function validIcNumber(digits: string): boolean {
  return (
    /^\d{12}$/.test(digits) && validBirthDate(digits.slice(0, 6)) && digits.slice(6, 8) !== '00'
  );
}

export function formatIc(digits: string): string {
  return `${digits.slice(0, 6)}-${digits.slice(6, 8)}-${digits.slice(8)}`;
}

/** What screens show: "••••••-••-5678". */
export function maskIc(digits: string): string {
  return `••••••-••-${digits.slice(-4)}`;
}

const NUMBER_SHAPE =
  /[0-9OQDILSZBG|]{6}\s*[-–—~]?\s*[0-9OQDILSZBG|]{2}\s*[-–—~]?\s*[0-9OQDILSZBG|]{4}/g;

function findNumber(lines: string[]): { digits: string; line: number } | null {
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i]!.toUpperCase().matchAll(NUMBER_SHAPE)) {
      const digits = m[0]
        .replace(/[\s\-–—~]/g, '')
        .split('')
        .map((ch) => DIGIT_FIX[ch] ?? ch)
        .join('');
      if (validIcNumber(digits)) return { digits, line: i };
    }
  }
  return null;
}

/** Card and address words that are never part of a name. (Not place names: "ALAM" or "ISLAM" can be in a name.) */
const NOT_NAME =
  /\b(KAD|PENGENALAN|MALAYSIA|IDENTITY|CARD|MYKAD|WARGANEGARA|LELAKI|PEREMPUAN|JALAN|JLN|TAMAN|TMN|LORONG|KAMPUNG|BLOK)\b/;

function nameLine(line: string): string | null {
  const t = line
    .toUpperCase()
    .replace(/[^A-Z@'/.\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length < 3 || NOT_NAME.test(t)) return null;
  // A name line is letters only; an address line has a house or postcode number.
  if (/\d/.test(line)) return null;
  return t;
}

/**
 * The name is printed right under the number, on one or two lines, before
 * the address (whose first line starts with a house number).
 */
function findName(lines: string[], numberLine: number): string | null {
  const parts: string[] = [];
  for (let i = numberLine + 1; i < lines.length && parts.length < 2; i++) {
    const raw = lines[i]!.trim();
    if (raw === '') continue;
    const n = nameLine(raw);
    if (!n) break;
    parts.push(n);
  }
  const name = parts.join(' ').trim();
  return name.length >= 3 ? name : null;
}

export function readMyKad(ocrText: string): MyKadRead {
  const lines = ocrText.split(/\r?\n/);
  const found = findNumber(lines);
  if (!found) return { icNumber: null, name: null };
  return { icNumber: found.digits, name: findName(lines, found.line) };
}
