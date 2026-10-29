import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BellRing,
  CheckCircle2,
  ClipboardCheck,
  CloudUpload,
  FileText,
  Link2,
  LogIn,
  LogOut,
  Scale,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type Timeline as TimelineData, type TimelineEvent } from '../api';
import { formatPlate } from '../plate';

const ICONS: Record<string, LucideIcon> = {
  gate_in: LogIn,
  sdo: Link2,
  cwis: CloudUpload,
  weigh_in: ArrowDownToLine,
  weigh_out: ArrowUpFromLine,
  do: FileText,
  sap: CloudUpload,
  check: ClipboardCheck,
  alert: BellRing,
  alert_cleared: CheckCircle2,
  gate_out: LogOut,
};

const TONE: Record<TimelineEvent['tone'], string> = {
  ok: 'bg-ok text-white',
  warn: 'bg-warn text-white',
  bad: 'bg-bad text-white',
  info: 'bg-action text-white',
  muted: 'bg-slate-200 text-slate-600',
};

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** A truck's whole journey, newest at the bottom. */
export function TimelineList({ events }: { events: TimelineEvent[] }) {
  return (
    <ol className="relative space-y-3" aria-label="Timeline">
      {events.map((e, i) => {
        const Icon = ICONS[e.kind] ?? Scale;
        return (
          <li key={i} className="relative flex gap-3" data-kind={e.kind}>
            {i < events.length - 1 && (
              <span
                aria-hidden
                className="absolute left-[18px] top-10 h-[calc(100%-1.5rem)] w-0.5 bg-slate-200"
              />
            )}
            <span
              className={`z-10 flex size-9 shrink-0 items-center justify-center rounded-full ${TONE[e.tone]}`}
            >
              <Icon className="size-5" />
            </span>
            <div className="min-w-0 flex-1 pb-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-sm font-bold text-muted">{time(e.at)}</span>
                <span className="font-bold">{e.title}</span>
              </div>
              {e.detail && <div className="text-sm text-muted">{e.detail}</div>}
              {e.actor && <div className="text-xs font-semibold text-slate-500">{e.actor}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Loads and shows one truck's timeline; refreshes when `tick` changes. */
export function TripTimeline({ tripId, tick }: { tripId: string; tick?: number }) {
  const [data, setData] = useState<TimelineData | null>(null);
  useEffect(() => {
    api
      .get<TimelineData>(`/api/trips/${tripId}/timeline`)
      .then(setData)
      .catch(() => setData(null));
  }, [tripId, tick]);
  if (!data) return <p className="text-muted">Loading…</p>;
  return <TimelineList events={data.events} />;
}

/** Full-screen timeline over any screen (Live overview). */
export function TimelineDialog({ tripId, onClose }: { tripId: string; onClose: () => void }) {
  const [data, setData] = useState<TimelineData | null>(null);
  useEffect(() => {
    api
      .get<TimelineData>(`/api/trips/${tripId}/timeline`)
      .then(setData)
      .catch(() => setData(null));
  }, [tripId]);
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={onClose}
      role="dialog"
      aria-label="Truck timeline"
    >
      <div
        className="flex h-full w-full max-w-xl flex-col bg-page shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 bg-ink px-4 py-3 text-white">
          <span className="shrink-0 whitespace-nowrap font-mono text-2xl font-black">
            {data ? formatPlate(data.plate) : '…'}
          </span>
          <span className="truncate">
            {data?.tripNo} · {data?.transporterName ?? ''}
          </span>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="ml-auto flex size-11 items-center justify-center rounded-lg active:bg-slate-700"
          >
            <X className="size-7" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {data ? <TimelineList events={data.events} /> : 'Loading…'}
        </div>
      </div>
    </div>
  );
}
