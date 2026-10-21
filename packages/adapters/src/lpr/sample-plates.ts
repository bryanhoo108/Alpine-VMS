/** Sample plates for the dev panel. Format only; not tied to any real vehicle. */
export const SAMPLE_PLATES = [
  'BMK 7710',
  'WVT 3388',
  'BPN 2045',
  'VBA 5521',
  'BJR 9102',
  'WRC 6630',
  'BQL 1187',
  'BHE 4092',
  'WXY 1234',
  'BKA 4321',
];

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A simple front-plate image (black plate, white text) so screens have a photo to show. */
export function plateImageSvg(plateText: string): Buffer {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">` +
    `<rect width="640" height="360" fill="#5b6470"/>` +
    `<rect x="120" y="130" width="400" height="100" rx="8" fill="#111" stroke="#ddd" stroke-width="4"/>` +
    `<text x="320" y="200" font-family="Arial, sans-serif" font-size="60" font-weight="700" ` +
    `fill="#fff" text-anchor="middle">${escape(plateText)}</text></svg>`;
  return Buffer.from(svg, 'utf8');
}
