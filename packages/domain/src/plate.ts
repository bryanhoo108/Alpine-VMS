/**
 * Malaysian plates are read and typed with varying spacing and case
 * ("WXY 1234", "wxy1234", "WXY-1234"). Compare on letters and digits only.
 */
export function normalizePlate(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function platesMatch(a: string, b: string): boolean {
  const na = normalizePlate(a);
  return na.length > 0 && na === normalizePlate(b);
}

/** Display form: letters and digits separated by a space, e.g. "WXY 1234". */
export function formatPlate(raw: string): string {
  return normalizePlate(raw)
    .replace(/([A-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Z])/g, '$1 $2');
}
