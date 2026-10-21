/**
 * Checker (tablet or phone with NFC). Normal load, 3 taps:
 *   1. All OK (or tick / count each line)
 *   2. Photo (load)
 *   3. Approve   (or Reject → one reason button)
 * The truck opens from a card tap or the waiting list.
 */
import {
  ArrowLeft,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  CreditCard,
  Hash,
  Image,
  PackageX,
  RotateCcw,
  ShieldAlert,
  ThumbsDown,
  ThumbsUp,
  Truck,
  WifiOff,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  ApiError,
  type CheckView,
  type DecisionResponse,
  type QueueItem,
  type RejectReason,
} from '../api';
import { BigButton } from '../components/BigButton';
import { PhotoCapture } from '../components/PhotoCapture';
import { useAlarm } from '../hooks/useAlarm';
import { useCardReader } from '../hooks/useCardReader';
import { useLiveEvents } from '../hooks/useLiveEvents';
import { formatPlate } from '../plate';

const PAGE = 6;
const LINES_PER_PAGE = 4;
const DONE_SECONDS = 4;

const REASONS: { id: RejectReason; label: string; icon: typeof X }[] = [
  { id: 'wrong_item', label: 'Wrong item', icon: PackageX },
  { id: 'wrong_quantity', label: 'Wrong qty', icon: Hash },
  { id: 'damaged', label: 'Damaged', icon: ShieldAlert },
  { id: 'other', label: 'Other', icon: CircleHelp },
];

export function Checker() {
  const [tripId, setTripId] = useState<string | null>(null);
  const [done, setDone] = useState<DecisionResponse | null>(null);

  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => setDone(null), DONE_SECONDS * 1000);
    return () => clearTimeout(id);
  }, [done]);
  useAlarm(done?.decision === 'reject', done?.decidedAt ?? null);

  if (done) {
    const ok = done.decision === 'approve';
    return (
      <button
        type="button"
        data-testid="check-done"
        onClick={() => setDone(null)}
        className={`flex h-full w-full flex-col items-center justify-center gap-4 rounded-2xl text-white ${ok ? 'bg-ok' : 'bg-bad'}`}
      >
        {ok ? <ThumbsUp className="size-28" /> : <ThumbsDown className="size-28" />}
        <div className="text-6xl font-black">{ok ? 'Approved' : 'Rejected'}</div>
        {!ok && <div className="text-3xl font-bold">Back to loading</div>}
        {ok && done.differences.length > 0 && (
          <div className="text-2xl font-bold">
            {done.differences.length} line(s) with different pieces
          </div>
        )}
      </button>
    );
  }
  if (tripId) {
    return (
      <CheckLoad
        tripId={tripId}
        onBack={() => setTripId(null)}
        onDone={(d) => {
          setTripId(null);
          setDone(d);
        }}
      />
    );
  }
  return <Waiting onOpen={setTripId} />;
}

// --- Waiting list -------------------------------------------------------------------

function Waiting({ onOpen }: { onOpen: (tripId: string) => void }) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<QueueItem[]>('/api/checker/queue')
      .then(setQueue)
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [load]);
  useLiveEvents((e) => {
    if (e.type === 'trip_changed') load();
  });

  useCardReader(true, async (cardNo) => {
    setError(null);
    try {
      const { tripId } = await api.get<{ tripId: string }>(
        `/api/checker/card/${encodeURIComponent(cardNo)}`,
      );
      onOpen(tripId);
    } catch {
      setError('Card not on a truck');
    }
  });

  const pages = Math.max(1, Math.ceil(queue.length / PAGE));
  const shown = queue.slice(page * PAGE, page * PAGE + PAGE);
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center gap-3 rounded-2xl border-4 border-dashed border-action bg-blue-50 px-4 py-3">
        <CreditCard className="size-12 shrink-0 text-action" />
        <div className="text-3xl font-extrabold">Tap card</div>
        <div className="ml-auto text-xl font-bold text-muted">or pick a truck</div>
      </div>
      {error && (
        <div
          role="alert"
          className="rounded-2xl bg-warn px-5 py-3 text-2xl font-extrabold text-white"
        >
          {error}
        </div>
      )}
      {queue.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl bg-panel text-muted">
          <Truck className="size-24" />
          <div className="text-3xl font-extrabold">No truck to check</div>
        </div>
      ) : (
        <ul
          aria-label="Waiting for check"
          className="grid min-h-0 flex-1 grid-cols-2 grid-rows-3 gap-3 landscape:grid-cols-3 landscape:grid-rows-2"
        >
          {shown.map((q) => (
            <li key={q.id} className="min-h-0">
              <button
                type="button"
                onClick={() => onOpen(q.id)}
                className={`flex h-full w-full flex-col items-center justify-center gap-1 rounded-2xl border-4 bg-panel p-2 active:bg-slate-100 ${q.lastDecision === 'reject' ? 'border-warn' : 'border-slate-300'}`}
              >
                <span className="font-mono text-3xl font-black">{formatPlate(q.plate)}</span>
                <span className="text-lg font-semibold">SDO {q.sdoNos.join(', ')}</span>
                <span className="max-w-full truncate text-base text-muted">
                  {q.transporterName ?? ''}
                </span>
                {q.lastDecision === 'reject' && (
                  <span className="rounded bg-warn px-2 text-lg font-bold text-white">
                    Re-check
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <BigButton
            size="sm"
            tone="plain"
            icon={ChevronLeft}
            label="Back"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          />
          <div className="text-xl font-bold">
            {page + 1} / {pages}
          </div>
          <BigButton
            size="sm"
            tone="plain"
            icon={ChevronRight}
            label="More"
            disabled={page >= pages - 1}
            onClick={() => setPage(page + 1)}
          />
        </div>
      )}
    </div>
  );
}

// --- Checking one load --------------------------------------------------------------

interface LineState {
  key: string;
  sdoNo: string;
  lineNo: number;
  size: string;
  spec: string;
  length: string;
  /** On this truck: the DO's pieces when it has a DO, else the SDO's. */
  expected: number;
  sdoPieces: number;
  fromDo: boolean;
  actual: number | null;
  changed: boolean;
}

function CheckLoad({
  tripId,
  onBack,
  onDone,
}: {
  tripId: string;
  onBack: () => void;
  onDone: (d: DecisionResponse) => void;
}) {
  const [view, setView] = useState<CheckView | null>(null);
  const [lines, setLines] = useState<LineState[]>([]);
  const [page, setPage] = useState(0);
  const [counting, setCounting] = useState<LineState | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [photoCount, setPhotoCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const uploads = useRef<Promise<string>[]>([]);

  const load = useCallback(async () => {
    try {
      const v = await api.get<CheckView>(`/api/checker/trips/${tripId}`);
      setView(v);
      setLines(
        v.sdos.flatMap((s) =>
          s.lines.map((l) => ({
            key: `${s.sdoNo}#${l.lineNo}`,
            sdoNo: s.sdoNo,
            lineNo: l.lineNo,
            size: l.size,
            spec: l.spec,
            length: l.length,
            expected: l.expected,
            sdoPieces: l.pieces,
            fromDo: l.from === 'do',
            actual: null,
            changed: s.changes.some((c) => c.lineNo === l.lineNo),
          })),
        ),
      );
      setPage(0);
    } catch (e) {
      setError(e instanceof ApiError ? e.code : 'ERROR');
    }
  }, [tripId]);
  useEffect(() => {
    void load();
  }, [load]);

  const setActual = (key: string, actual: number | null) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, actual } : l)));
  const allOk = () =>
    setLines((ls) => ls.map((l) => (l.actual === null ? { ...l, actual: l.expected } : l)));

  const submit = async (decision: 'approve' | 'reject', reason: RejectReason | null) => {
    if (!view || busy) return;
    setBusy(true);
    setError(null);
    try {
      const photoIds = (await Promise.allSettled(uploads.current))
        .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
        .map((r) => r.value);
      const res = await api.post<DecisionResponse>(`/api/checker/trips/${tripId}/decision`, {
        decision,
        reason,
        versions: Object.fromEntries(view.sdos.map((s) => [s.sdoNo, s.version ?? ''])),
        // A reject may come before every line is counted: unchecked lines count as expected.
        lines: lines.map((l) => ({
          sdoNo: l.sdoNo,
          lineNo: l.lineNo,
          actualPieces: l.actual ?? l.expected,
        })),
        photoIds,
      });
      onDone(res);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'NETWORK';
      if (code === 'SDO_CHANGED_AGAIN') {
        setError('SDO changed. Check again.');
        await load();
      } else {
        setError('Not saved. Try again.');
      }
      setRejecting(false);
    } finally {
      setBusy(false);
    }
  };

  if (!view) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 rounded-2xl bg-panel text-2xl font-bold text-muted">
        {error ?? 'Loading…'}
        <BigButton size="sm" tone="plain" icon={ArrowLeft} label="Back" onClick={onBack} />
      </div>
    );
  }

  const changed = view.sdos.some((s) => s.changed);
  const checked = lines.filter((l) => l.actual !== null).length;
  const pages = Math.max(1, Math.ceil(lines.length / LINES_PER_PAGE));
  const shown = lines.slice(page * LINES_PER_PAGE, page * LINES_PER_PAGE + LINES_PER_PAGE);
  const ready = checked === lines.length && lines.length > 0;

  if (counting) {
    return (
      <Counter
        line={counting}
        onDone={(n) => {
          setActual(counting.key, n);
          setCounting(null);
        }}
        onCancel={() => setCounting(null)}
      />
    );
  }

  if (rejecting) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div className="flex items-center gap-3 rounded-2xl bg-bad px-5 py-3 text-white">
          <ThumbsDown className="size-10" />
          <div className="text-3xl font-extrabold">Reject: why?</div>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
          {REASONS.map((r) => (
            <BigButton
              key={r.id}
              tone="bad"
              icon={r.icon}
              label={r.label}
              disabled={busy}
              onClick={() => void submit('reject', r.id)}
            />
          ))}
        </div>
        <BigButton
          size="sm"
          tone="plain"
          icon={X}
          label="Cancel"
          onClick={() => setRejecting(false)}
        />
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 gap-3 landscape:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] portrait:grid-cols-[minmax(0,1fr)] portrait:grid-rows-[minmax(0,1fr)_auto]">
      <div className="flex min-h-0 flex-col gap-2">
        <div className="flex items-center gap-3 rounded-2xl bg-panel p-2">
          <button
            type="button"
            aria-label="Back"
            onClick={onBack}
            className="flex size-14 shrink-0 items-center justify-center rounded-xl border-2 border-slate-300"
          >
            <ArrowLeft className="size-8" />
          </button>
          <div className="min-w-0">
            <div className="font-mono text-3xl font-black">{formatPlate(view.plate)}</div>
            <div className="truncate text-lg font-semibold text-muted">
              SDO {view.sdos.map((s) => s.sdoNo).join(', ')}
              {view.sdos.some((s) => s.doNos.length > 0) &&
                ` · DO ${[...new Set(view.sdos.flatMap((s) => s.doNos))].join(', ')}`}
            </div>
          </div>
          <div className="ml-auto flex flex-col items-end gap-1">
            {changed && (
              <span
                className="rounded-lg bg-warn px-3 py-1 text-lg font-extrabold text-white"
                data-testid="sdo-changed"
              >
                SDO changed
              </span>
            )}
            {view.offline && (
              <span className="flex items-center gap-1 rounded-lg bg-warn px-3 py-1 text-lg font-extrabold text-white">
                <WifiOff className="size-5" /> Offline
              </span>
            )}
          </div>
        </div>
        {error && (
          <div
            role="alert"
            className="flex items-center gap-3 rounded-2xl bg-warn px-5 py-2 text-2xl font-extrabold text-white"
          >
            <RotateCcw className="size-8" /> {error}
          </div>
        )}
        <ul aria-label="Lines" className="flex min-h-0 flex-1 flex-col gap-2">
          {shown.map((l) => (
            <LineRow
              key={l.key}
              line={l}
              onTick={() => setActual(l.key, l.actual === null ? l.expected : null)}
              onCount={() => setCounting(l)}
            />
          ))}
        </ul>
        <div className="flex items-center gap-2">
          {pages > 1 && (
            <>
              <BigButton
                size="sm"
                tone="plain"
                icon={ChevronLeft}
                label="Back"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              />
              <span className="text-xl font-bold">
                {page + 1} / {pages}
              </span>
              <BigButton
                size="sm"
                tone="plain"
                icon={ChevronRight}
                label="More"
                disabled={page >= pages - 1}
                onClick={() => setPage(page + 1)}
              />
            </>
          )}
          <BigButton
            className="ml-auto flex-1"
            size="sm"
            tone={ready ? 'plain' : 'action'}
            icon={CheckCheck}
            label="All OK"
            onClick={allOk}
          />
        </div>
      </div>
      <div className="flex min-h-0 flex-col gap-3 portrait:h-[34dvh]">
        <div className="min-h-0 flex-1">
          <PhotoCapture
            label="Load"
            icon={Image}
            badges={[{ icon: Image, count: photoCount, testId: 'count-load' }]}
            onPhoto={(blob) => {
              setPhotoCount((n) => n + 1);
              uploads.current.push(
                api.upload<{ id: string }>('/api/photos?kind=load', blob).then((r) => r.id),
              );
            }}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <BigButton
            size="md"
            tone="bad"
            icon={ThumbsDown}
            label="Reject"
            disabled={busy}
            onClick={() => setRejecting(true)}
          />
          <BigButton
            size="md"
            tone="ok"
            icon={ThumbsUp}
            label="Approve"
            disabled={!ready || busy}
            onClick={() => void submit('approve', null)}
          />
        </div>
      </div>
    </div>
  );
}

function LineRow({
  line,
  onTick,
  onCount,
}: {
  line: LineState;
  onTick: () => void;
  onCount: () => void;
}) {
  const state = line.actual === null ? 'open' : line.actual === line.expected ? 'ok' : 'differs';
  const bg = { open: 'bg-panel', ok: 'bg-ok-soft', differs: 'bg-warn-soft' }[state];
  return (
    <li
      data-testid={`line-${line.key}`}
      data-state={state}
      className={`flex max-h-32 min-h-0 flex-1 items-center gap-2 rounded-2xl p-2 shadow-sm ${bg}`}
    >
      <button
        type="button"
        onClick={onTick}
        aria-label={`Tick ${line.size}`}
        className={`flex size-16 shrink-0 items-center justify-center rounded-xl border-4 ${state === 'open' ? 'border-slate-300 bg-white' : state === 'ok' ? 'border-ok bg-ok text-white' : 'border-warn bg-warn text-white'}`}
      >
        {state !== 'open' && <Check className="size-10" strokeWidth={3} />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-2xl font-extrabold">{line.size}</span>
          {line.changed && (
            <span className="rounded bg-warn px-2 text-base font-bold text-white">Changed</span>
          )}
        </div>
        <div className="truncate text-lg text-muted">
          {line.spec} · {line.length} · SDO {line.sdoNo}
          {line.fromDo && line.sdoPieces !== line.expected && ` (SDO ${line.sdoPieces})`}
        </div>
      </div>
      <button
        type="button"
        onClick={onCount}
        aria-label={`Count ${line.size}`}
        className="flex min-h-16 min-w-24 shrink-0 flex-col items-center justify-center rounded-xl border-2 border-slate-300 bg-white px-2 active:bg-slate-100"
      >
        {state === 'differs' ? (
          <>
            <span className="font-mono text-3xl font-black text-warn">{line.actual}</span>
            <span className="text-sm font-bold text-muted">of {line.expected}</span>
          </>
        ) : (
          <span className="font-mono text-3xl font-black">{line.expected}</span>
        )}
      </button>
    </li>
  );
}

/** Pieces counter: big number with −10/−1/+1/+10. No typing. */
function Counter({
  line,
  onDone,
  onCancel,
}: {
  line: LineState;
  onDone: (n: number) => void;
  onCancel: () => void;
}) {
  const [n, setN] = useState(line.actual ?? line.expected);
  const step = (d: number) => setN((x) => Math.max(0, x + d));
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="rounded-2xl bg-panel p-3 text-center">
        <div className="text-2xl font-extrabold">{line.size}</div>
        <div className="text-lg text-muted">
          {line.spec} · {line.length}
        </div>
        <div className="text-lg font-bold">
          SDO {line.sdoNo}: {line.expected} pcs
        </div>
      </div>
      <div
        data-testid="counter-value"
        className={`flex min-h-0 flex-1 items-center justify-center rounded-2xl font-mono text-8xl font-black ${n === line.expected ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn'}`}
      >
        {n}
      </div>
      <div className="grid grid-cols-4 gap-2">
        {[-10, -1, 1, 10].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => step(d)}
            className="min-h-20 rounded-2xl bg-panel text-3xl font-black shadow-sm active:bg-slate-200"
          >
            {d > 0 ? `+${d}` : d}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <BigButton size="md" tone="plain" icon={X} label="Cancel" onClick={onCancel} />
        <BigButton size="md" tone="ok" icon={Check} label="OK" onClick={() => onDone(n)} />
      </div>
    </div>
  );
}
