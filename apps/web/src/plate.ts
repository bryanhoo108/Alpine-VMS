// Same rules as packages/domain/src/plate.ts, kept dependency-free for the browser.
export const normalizePlate = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, '');

export const formatPlate = (raw: string) =>
  normalizePlate(raw)
    .replace(/([A-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Z])/g, '$1 $2');
