/**
 * After the IC photo: the number and name read from it (decision Q2a). The
 * guard sees only the last 4 digits and the name, and taps "Wrong" if they do
 * not match the card in hand. No typing.
 */
import { IdCard, Loader2, RotateCcw, X } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { api, type IcReadView } from '../api';

type IcState = { status: 'none' } | { status: 'reading' } | { status: 'done'; read: IcReadView };

export function useIcRead() {
  const [state, setState] = useState<IcState>({ status: 'none' });
  const [rejected, setRejected] = useState(false);
  const latest = useRef(0);

  /** Read the IC photo once its upload has finished; the newest photo wins. */
  const read = useCallback((photoId: Promise<string>) => {
    const n = ++latest.current;
    setRejected(false);
    setState({ status: 'reading' });
    photoId
      .then((id) => api.post<IcReadView>(`/api/photos/${id}/read-ic`, {}))
      .then((r) => n === latest.current && setState({ status: 'done', read: r }))
      .catch(
        () =>
          n === latest.current &&
          setState({
            status: 'done',
            read: { found: false, masked: null, last4: null, name: null },
          }),
      );
  }, []);

  /** Next vehicle or visitor: forget the last read. */
  const clear = useCallback(() => {
    latest.current++;
    setRejected(false);
    setState({ status: 'none' });
  }, []);

  return { state, rejected, setRejected, read, clear };
}

export function IcReadChip({ ic }: { ic: ReturnType<typeof useIcRead> }) {
  const { state, rejected, setRejected } = ic;
  if (state.status === 'none') return null;
  if (state.status === 'reading') {
    return (
      <div
        className="flex min-h-16 items-center gap-3 rounded-2xl bg-panel px-4 text-xl font-bold text-muted"
        data-testid="ic-read"
      >
        <Loader2 className="size-8 animate-spin" /> Reading IC…
      </div>
    );
  }
  const { read } = state;
  if (!read.found) {
    return (
      <div
        className="flex min-h-16 items-center gap-3 rounded-2xl bg-warn-soft px-4 text-xl font-bold text-warn"
        data-testid="ic-read"
      >
        <IdCard className="size-8 shrink-0" /> IC not read · photo again
      </div>
    );
  }
  return (
    <div
      data-testid="ic-read"
      data-rejected={rejected}
      className={`flex min-h-16 items-center gap-3 rounded-2xl px-3 ${rejected ? 'bg-slate-100 text-muted' : 'bg-ok-soft text-ink'}`}
    >
      <IdCard className={`size-8 shrink-0 ${rejected ? '' : 'text-ok'}`} />
      <div className={`min-w-0 flex-1 ${rejected ? 'line-through' : ''}`}>
        <div className="font-mono text-xl font-black">{read.masked}</div>
        {read.name && <div className="truncate text-lg font-bold">{read.name}</div>}
      </div>
      <button
        type="button"
        onClick={() => setRejected(!rejected)}
        className="flex min-h-12 shrink-0 items-center gap-2 rounded-xl border-2 border-slate-300 bg-white px-3 text-lg font-bold"
      >
        {rejected ? <RotateCcw className="size-6" /> : <X className="size-6" />}
        {rejected ? 'Use' : 'Wrong'}
      </button>
    </div>
  );
}
