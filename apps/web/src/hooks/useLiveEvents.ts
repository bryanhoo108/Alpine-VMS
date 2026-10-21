import { useEffect, useRef } from 'react';

export type LiveEvent =
  | { type: 'plate_read'; camera: 'entry' | 'exit'; plateReadId: string }
  | { type: 'trip_changed'; tripId: string }
  | { type: 'alert'; alertId: string; level: 'amber' | 'red' | 'logged' };

/** Subscribe to server events; reconnects automatically (EventSource retry). */
export function useLiveEvents(handler: (event: LiveEvent) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const source = new EventSource('/api/events');
    source.onmessage = (msg) => ref.current(JSON.parse(msg.data) as LiveEvent);
    return () => source.close();
  }, []);
}
