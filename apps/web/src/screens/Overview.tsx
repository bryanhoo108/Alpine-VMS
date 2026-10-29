/**
 * Live overview for the supervisor and management (office PC or a big screen):
 * trucks inside now and where each one is, today's numbers, exits by colour,
 * open alerts and whether SAP and CWIS keep up. Tap a truck for its timeline.
 * In the demo it also has the demo controls (auto-play, restart the day).
 */
import {
  BellRing,
  CheckCircle2,
  Clock,
  FastForward,
  FlaskConical,
  HardHat,
  LogIn,
  LogOut,
  PackageOpen,
  Play,
  RotateCcw,
  Siren,
  Square,
  Truck,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api, type Overview as OverviewData, type People, type Stage } from '../api';
import { MusterPanel } from '../components/MusterPanel';
import { TimelineDialog } from '../components/Timeline';
import { dateTimeOf } from '../format';
import { useLiveEvents } from '../hooks/useLiveEvents';
import { formatPlate } from '../plate';

const STAGES: Stage[] = [
  'Not matched',
  'Waiting weigh-in',
  'Waiting check',
  'Rejected',
  'Waiting DO',
  'Waiting weigh-out',
  'Ready to go',
];

const DOT = { green: 'bg-ok', amber: 'bg-warn', red: 'bg-bad' } as const;
const STAGE_TONE: Record<Stage, string> = {
  'Not matched': 'bg-warn-soft text-warn',
  'Waiting weigh-in': 'bg-slate-100 text-slate-700',
  'Waiting check': 'bg-blue-100 text-blue-800',
  Rejected: 'bg-bad-soft text-bad',
  'Waiting DO': 'bg-warn-soft text-warn',
  'Waiting weigh-out': 'bg-slate-100 text-slate-700',
  'Ready to go': 'bg-ok-soft text-ok',
};

const hm = (minutes: number | null) =>
  minutes === null
    ? '–'
    : minutes < 60
      ? `${minutes} min`
      : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;

/** demoControls: mock mode and allowed to restart the day (supervisor or admin). */
export function Overview({ demoControls }: { demoControls: boolean }) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [people, setPeople] = useState<People | null>(null);
  const [muster, setMuster] = useState(false);
  const [musterOn, setMusterOn] = useState(false);

  const load = useCallback(() => {
    api
      .get<OverviewData>('/api/overview')
      .then(setData)
      .catch(() => undefined);
    api
      .get<People>('/api/people')
      .then(setPeople)
      .catch(() => undefined);
    api
      .get<unknown>('/api/muster')
      .then((m) => setMusterOn(m !== null))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    load();
    // Minutes inside keep counting even when nothing happens.
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);
  useLiveEvents((e) => {
    if (
      e.type === 'trip_changed' ||
      e.type === 'visit_changed' ||
      e.type === 'muster_changed' ||
      e.type === 'alert' ||
      e.type === 'connected'
    ) {
      load();
    }
  });

  if (!data)
    return <div className="rounded-2xl bg-panel p-6 text-xl font-bold text-muted">Loading…</div>;
  const t = data.today;
  const maxStage = Math.max(1, ...Object.values(data.stages));
  const exitsTotal = t.exits.green + t.exits.amber + t.exits.red;

  return (
    <div className="h-full overflow-y-auto" data-testid="overview">
      <div className="flex flex-col gap-3">
        {demoControls && <DemoBar onChanged={load} />}

        {people && (
          <section
            className="flex flex-wrap items-center gap-3 rounded-2xl bg-panel p-3 shadow-sm"
            aria-label="People on site"
          >
            <UsersRound className="size-8 text-muted" />
            <div>
              <div className="text-sm font-bold uppercase text-muted">People on site</div>
              <div className="text-3xl font-black tabular-nums" data-testid="headcount">
                {people.headcount.total}
              </div>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-lg">
              <span className="flex items-center gap-1">
                <Truck className="size-5 text-muted" /> {people.headcount.truckDrivers} drivers
              </span>
              <span className="flex items-center gap-1">
                <UserRound className="size-5 text-muted" /> {people.headcount.visitors} visitors
              </span>
              <span className="flex items-center gap-1">
                <HardHat className="size-5 text-muted" /> {people.headcount.contractors} contractors
              </span>
            </div>
            <button
              type="button"
              onClick={() => setMuster(true)}
              className={`ml-auto flex min-h-12 items-center gap-2 rounded-xl px-5 text-lg font-black text-white ${musterOn ? 'animate-pulse bg-bad' : 'bg-bad'}`}
            >
              <Siren className="size-6" /> {musterOn ? 'Muster on' : 'Muster'}
            </button>
          </section>
        )}

        <section className="grid grid-cols-2 gap-3 md:grid-cols-5" aria-label="Today">
          <Kpi icon={Truck} label="Inside now" value={t.inside} />
          <Kpi icon={LogIn} label="In today" value={t.in} />
          <Kpi icon={LogOut} label="Out today" value={t.out} />
          <Kpi icon={Clock} label="Avg time inside" value={hm(t.avgMinutesInside)} />
          <div className="col-span-2 rounded-2xl bg-panel p-4 shadow-sm md:col-span-1">
            <div className="text-sm font-bold uppercase text-muted">Exits today</div>
            <div className="mt-1 flex items-end gap-3 text-3xl font-black" data-testid="exits">
              <span className="text-ok" title="Green">
                {t.exits.green}
              </span>
              <span className="text-warn" title="Amber">
                {t.exits.amber}
              </span>
              <span className="text-bad" title="Red">
                {t.exits.red}
              </span>
            </div>
            {exitsTotal > 0 && (
              <div className="mt-2 flex h-3 overflow-hidden rounded-full" aria-hidden>
                <div
                  className="bg-ok"
                  style={{ width: `${(t.exits.green / exitsTotal) * 100}%` }}
                />
                <div
                  className="bg-warn"
                  style={{ width: `${(t.exits.amber / exitsTotal) * 100}%` }}
                />
                <div className="bg-bad" style={{ width: `${(t.exits.red / exitsTotal) * 100}%` }} />
              </div>
            )}
          </div>
        </section>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
          <section className="rounded-2xl bg-panel p-4 shadow-sm">
            <h2 className="mb-2 text-xl font-extrabold">Trucks inside ({data.inside.length})</h2>
            {data.inside.length === 0 ? (
              <p className="text-muted">No trucks inside.</p>
            ) : (
              <ul className="divide-y divide-slate-200" aria-label="Trucks inside">
                {data.inside.map((x) => (
                  <li key={x.id}>
                    <button
                      type="button"
                      onClick={() => setOpen(x.id)}
                      className="flex min-h-14 w-full flex-wrap items-center gap-x-3 gap-y-1 py-2 text-left active:bg-slate-50"
                    >
                      <span
                        className={`size-4 shrink-0 rounded-full ${DOT[x.level]}`}
                        title={`Exit now: ${x.level}`}
                      />
                      {x.type === 'outbound' ? (
                        <Truck className="size-5 shrink-0 text-muted" />
                      ) : (
                        <PackageOpen className="size-5 shrink-0 text-muted" />
                      )}
                      <span className="font-mono text-lg font-black sm:w-28">
                        {formatPlate(x.plate)}
                      </span>
                      <span
                        className={`rounded-md px-2 py-0.5 text-sm font-bold ${STAGE_TONE[x.stage]}`}
                      >
                        {x.stage}
                      </span>
                      {x.openAlert && (
                        <BellRing
                          className={`size-5 ${x.openAlert === 'red' ? 'text-bad' : 'text-warn'}`}
                          aria-label="Open alert"
                        />
                      )}
                      <span className="order-last w-[calc(100%-5rem)] truncate text-sm text-muted sm:order-none sm:w-auto sm:min-w-0 sm:flex-1">
                        {[
                          x.transporterName,
                          x.sdoNos.length ? `SDO ${x.sdoNos.join(', ')}` : null,
                          x.reasons.join(' · '),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      <span className="order-last ml-auto font-mono text-sm font-bold tabular-nums sm:order-none">
                        {hm(x.minutesInside)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="flex flex-col gap-3">
            <section className="rounded-2xl bg-panel p-4 shadow-sm" aria-label="Where trucks are">
              <h2 className="mb-2 text-xl font-extrabold">Where trucks are</h2>
              <ul className="space-y-1.5">
                {STAGES.map((s) => (
                  <li key={s} className="grid grid-cols-[9rem_1fr_2rem] items-center gap-2 text-sm">
                    <span className="font-semibold">{s}</span>
                    <span className="h-4 rounded bg-slate-100">
                      <span
                        className={`block h-4 rounded ${STAGE_TONE[s].split(' ')[0]}`}
                        style={{ width: `${(data.stages[s] / maxStage) * 100}%` }}
                      />
                    </span>
                    <span className="text-right font-bold tabular-nums">{data.stages[s]}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-2xl bg-panel p-4 shadow-sm">
              <h2 className="mb-2 text-xl font-extrabold">
                Open alerts ({data.openAlerts.length})
              </h2>
              {data.openAlerts.length === 0 ? (
                <p className="text-muted">None.</p>
              ) : (
                <ul className="space-y-1.5" aria-label="Open alerts">
                  {data.openAlerts.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <span
                        className={`rounded-md px-2 py-0.5 font-bold ${a.level === 'red' ? 'bg-bad-soft text-bad' : 'bg-warn-soft text-warn'}`}
                      >
                        {a.label}
                      </span>
                      {a.plate && (
                        <span className="font-mono font-bold">{formatPlate(a.plate)}</span>
                      )}
                      <span className="text-muted">{dateTimeOf(a.raisedAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-2xl bg-panel p-4 shadow-sm" aria-label="SAP and CWIS">
              <h2 className="mb-2 text-xl font-extrabold">SAP and CWIS</h2>
              <Sync
                name="SAP (DO updates)"
                waiting={data.integrations.sapWaiting}
                since={data.integrations.sapOldestWaitingAt}
              />
              <Sync
                name="CWIS (truck details)"
                waiting={data.integrations.cwisWaiting}
                since={data.integrations.cwisOldestWaitingAt}
              />
            </section>
          </div>
        </div>
      </div>
      {muster && (
        <MusterPanel
          onClose={() => {
            setMuster(false);
            load();
          }}
        />
      )}
      {open && <TimelineDialog tripId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Truck;
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-2xl bg-panel p-4 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-bold uppercase text-muted">
        <Icon className="size-4" /> {label}
      </div>
      <div className="mt-1 text-3xl font-black tabular-nums">{value}</div>
    </div>
  );
}

function Sync({ name, waiting, since }: { name: string; waiting: number; since: string | null }) {
  const late = since !== null && Date.now() - new Date(since).getTime() > 5 * 60_000;
  return (
    <div className="flex items-center gap-2 py-1">
      {waiting === 0 ? (
        <CheckCircle2 className="size-5 text-ok" />
      ) : (
        <Clock className={`size-5 ${late ? 'text-bad' : 'text-warn'}`} />
      )}
      <span className="font-semibold">{name}</span>
      <span className="ml-auto text-sm text-muted">
        {waiting === 0
          ? 'Up to date'
          : `${waiting} waiting${since ? ` since ${new Date(since).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}`}
      </span>
    </div>
  );
}

/** Mock mode only: auto-play and restarting the sample day. */
/** One step every 20 s at 1×; 10× is a step every 2 s. */
const SPEEDS = [1, 4, 10] as const;

function DemoBar({ onChanged }: { onChanged: () => void }) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api
      .get<{ autoplay?: boolean; autoplaySpeed?: number }>('/api/dev')
      .then((d) => {
        setPlaying(!!d.autoplay);
        setSpeed(d.autoplaySpeed ?? 1);
      })
      .catch(() => undefined);
  }, []);
  const send = async (on: boolean, newSpeed = speed) => {
    const r = await api.post<{ autoplay: boolean; speed: number }>('/api/dev/demo/autoplay', {
      on,
      speed: newSpeed,
    });
    setPlaying(r.autoplay);
    setSpeed(r.speed);
  };
  const restart = async () => {
    if (!window.confirm('Restart the demo day? Trucks entered by hand will be cleared.')) return;
    setBusy(true);
    try {
      await api.post('/api/dev/demo/reset');
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-purple-50 p-2 text-purple-900">
      <FlaskConical className="size-5" />
      <span className="font-bold">Demo</span>
      <span className="text-sm">sample data, simulated SAP / CWIS / cameras</span>
      <div className="ml-auto flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => void send(!playing)}
          aria-pressed={playing}
          className={`flex min-h-11 items-center gap-2 rounded-lg px-4 font-bold ${playing ? 'bg-purple-700 text-white' : 'border-2 border-purple-300 bg-white'}`}
        >
          {playing ? <Square className="size-5" /> : <Play className="size-5" />}
          {playing ? 'Stop auto-play' : 'Auto-play'}
        </button>
        {/* Fast forward: picking a speed also starts auto-play. */}
        <div
          role="group"
          aria-label="Auto-play speed"
          className="flex items-center gap-1 rounded-lg border-2 border-purple-300 bg-white px-1"
        >
          <FastForward className="mx-1 size-5" aria-hidden />
          {SPEEDS.map((x) => (
            <button
              key={x}
              type="button"
              aria-pressed={playing && speed === x}
              aria-label={`Speed ${x}×`}
              onClick={() => void send(true, x)}
              className={`min-h-11 min-w-11 rounded-md px-2 font-bold ${playing && speed === x ? 'bg-purple-700 text-white' : ''}`}
            >
              {x}×
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void restart()}
          className="flex min-h-11 items-center gap-2 rounded-lg border-2 border-purple-300 bg-white px-4 font-bold disabled:opacity-50"
        >
          <RotateCcw className="size-5" />
          {busy ? 'Restarting…' : 'Restart day'}
        </button>
      </div>
    </div>
  );
}
