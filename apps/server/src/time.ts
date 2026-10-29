/** Site-local calendar date (YYYY-MM-DD) for a moment in time. */
export function siteDate(at: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** Add whole days to a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The moment a site-local date and HH:MM time happens, e.g. ('2026-11-02', '17:00'). */
export function siteDateTime(date: string, time: string, timeZone: string): Date {
  const asUtc = new Date(`${date}T${time}:00Z`);
  // Offset of the site's zone at that moment (Malaysia has no daylight saving,
  // but other sites might): what the zone's clock shows for asUtc, minus asUtc.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(asUtc);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const shown = new Date(
    `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:00Z`,
  );
  return new Date(asUtc.getTime() - (shown.getTime() - asUtc.getTime()));
}
