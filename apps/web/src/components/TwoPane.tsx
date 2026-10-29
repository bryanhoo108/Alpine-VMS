import type { ReactNode } from 'react';

/** Two columns on a landscape tablet, stacked on a portrait phone. */
export function TwoPane({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div className="grid h-full min-h-0 gap-3 landscape:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] portrait:grid-cols-[minmax(0,1fr)] portrait:grid-rows-[minmax(0,1fr)_auto]">
      <div className="min-h-0 min-w-0">{left}</div>
      <div className="min-h-0 min-w-0">{right}</div>
    </div>
  );
}
