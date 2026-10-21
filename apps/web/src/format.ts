/** Times on screen are site-local (the tablet's own clock and zone). */
export const timeOf = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '–';

export const dateTimeOf = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString([], {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '–';

export const linesSummary = (lines: { size: string; pieces: number }[]) =>
  lines.map((l) => `${l.size} × ${l.pieces}`).join(', ');
