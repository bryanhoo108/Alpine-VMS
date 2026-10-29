/**
 * Emergency roll call (decision V8). The roll is everyone inside when it
 * starts: truck drivers, visitor and contractor groups. Tap a group when you
 * see them at the assembly point; missing ones stay at the top.
 */
import { CheckCircle2, Circle, HardHat, Siren, Square, Truck, UserRound, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api, type Muster, type MusterEntry } from '../api';
import { useLiveEvents } from '../hooks/useLiveEvents';
import { formatPlate } from '../plate';

const KindIcon = ({ kind, className }: { kind: MusterEntry['kind']; className?: string }) =>
  kind === 'truck' ? (
    <Truck className={className} />
  ) : kind === 'contractor' ? (
    <HardHat className={className} />
  ) : (
    <UserRound className={className} />
  );

export function MusterPanel({ onClose }: { onClose: () => void }) {
  const [muster, setMuster] = useState<Muster | null | undefined>(undefined);
  const [ending, setEnding] = useState(false);

  const load = useCallback(() => {
    void api.get<Muster | null>('/api/muster').then(setMuster);
  }, []);
  useEffect(load, [load]);
  useLiveEvents((e) => {
    if (e.type === 'muster_changed' || e.type === 'connected') load();
  });

  const start = async () => setMuster(await api.post<Muster>('/api/muster/start', {}));
  const mark = async (entryId: string, safe: boolean) =>
    muster && setMuster(await api.post<Muster>(`/api/muster/${muster.id}/mark`, { entryId, safe }));
  const end = async () => {
    if (!muster) return;
    await api.post(`/api/muster/${muster.id}/end`, {});
    setMuster(null);
    setEnding(false);
    onClose();
  };

  const missing = muster?.roll.filter((e) => !e.safe).sort((a, b) => b.people - a.people) ?? [];
  const safe = muster?.roll.filter((e) => e.safe) ?? [];
  const allSafe = muster && muster.safePeople === muster.people;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white" role="dialog" aria-label="Muster">
      <div
        className={`flex flex-wrap items-center gap-3 px-4 py-3 text-white ${allSafe ? 'bg-ok' : 'bg-bad'}`}
      >
        <Siren className="size-9" />
        <h2 className="text-2xl font-black">Muster</h2>
        {muster && (
          <span className="text-2xl font-black tabular-nums" data-testid="muster-count">
            {muster.safePeople} / {muster.people} safe
          </span>
        )}
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="ml-auto flex size-11 items-center justify-center rounded-lg active:bg-black/20"
        >
          <X className="size-7" />
        </button>
      </div>

      {muster === undefined ? null : muster === null ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4 text-center">
          <Siren className="size-20 text-bad" />
          <p className="max-w-md text-xl">
            Starts a roll call of everyone inside now: truck drivers, visitors and contractors.
          </p>
          <button
            type="button"
            onClick={() => void start()}
            className="flex min-h-16 items-center gap-3 rounded-2xl bg-bad px-8 text-2xl font-black text-white"
          >
            <Siren className="size-8" /> Start roll call
          </button>
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <h3 className="mb-2 text-lg font-extrabold text-bad">
              Not seen yet ({muster.people - muster.safePeople} people)
            </h3>
            <ul
              className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3"
              aria-label="Not seen"
            >
              {missing.map((e) => (
                <Entry key={e.id} e={e} onToggle={() => void mark(e.id, true)} />
              ))}
            </ul>
            {safe.length > 0 && (
              <>
                <h3 className="mb-2 text-lg font-extrabold text-ok">
                  Safe ({muster.safePeople} people)
                </h3>
                <ul
                  className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3"
                  aria-label="Safe"
                >
                  {safe.map((e) => (
                    <Entry key={e.id} e={e} onToggle={() => void mark(e.id, false)} />
                  ))}
                </ul>
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 p-3">
            <span className="text-sm text-muted">
              Started{' '}
              {new Date(muster.startedAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
              . People who came in after that are not on this list.
            </span>
            {ending ? (
              <div className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={() => setEnding(false)}
                  className="min-h-12 rounded-xl border-2 border-slate-300 px-4 font-bold"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => void end()}
                  className="flex min-h-12 items-center gap-2 rounded-xl bg-ink px-4 font-bold text-white"
                >
                  <Square className="size-5" /> Yes, end
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setEnding(true)}
                className="ml-auto flex min-h-12 items-center gap-2 rounded-xl border-2 border-ink px-4 font-bold"
              >
                <Square className="size-5" /> End muster
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Entry({ e, onToggle }: { e: Muster['roll'][number]; onToggle: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={e.safe}
        aria-label={`${e.kind === 'truck' ? formatPlate(e.label) : e.label}${e.safe ? ', safe' : ''}`}
        className={`flex min-h-16 w-full items-center gap-3 rounded-xl border-2 px-3 py-2 text-left ${e.safe ? 'border-ok bg-ok-soft' : 'border-bad bg-white'}`}
      >
        {e.safe ? (
          <CheckCircle2 className="size-8 shrink-0 text-ok" />
        ) : (
          <Circle className="size-8 shrink-0 text-bad" />
        )}
        <KindIcon kind={e.kind} className="size-6 shrink-0 text-muted" />
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-lg font-black ${e.kind === 'truck' ? 'font-mono' : ''}`}
          >
            {e.kind === 'truck' ? formatPlate(e.label) : e.label}
          </span>
          <span className="block truncate text-sm text-muted">
            {[e.company, e.host && `host ${e.host}`, e.cardNo && `card …${e.cardNo.slice(-4)}`]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
        <span className="shrink-0 text-xl font-black tabular-nums">
          {e.people > 1 ? `${e.people} ppl` : '1'}
        </span>
      </button>
    </li>
  );
}
