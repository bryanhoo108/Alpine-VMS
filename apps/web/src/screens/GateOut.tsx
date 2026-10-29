/**
 * Gate Out (exit guard tablet). The exit camera reads the plate and the guard
 * sees green (go), amber (check) or red (call supervisor, with alarm), with
 * the reasons in 1-3 words. The card tap closes the trip:
 *   1. driver hands the card: guard taps it on the tablet → OUT
 *   or: No card → Yes (card lost, red)
 * The truck is never kept in by the system; amber and red alert the supervisor.
 */
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  List,
  PhoneCall,
  RotateCcw,
  SearchX,
  TriangleAlert,
  HardHat,
  Truck,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  api,
  ApiError,
  type ExitState,
  type ExitTruck,
  type GateOutResponse,
  type VisitExit,
  type VisitOutResponse,
} from '../api';
import { BigButton } from '../components/BigButton';
import { PlateCard } from '../components/PlateCard';
import { useAlarm } from '../hooks/useAlarm';
import { useCardReader } from '../hooks/useCardReader';
import { useLiveEvents } from '../hooks/useLiveEvents';
import { formatPlate } from '../plate';

type Stage =
  | 'waiting'
  | 'truck'
  | 'unknown'
  | 'pick'
  | 'no-card'
  | 'done'
  | 'people'
  | 'visit'
  | 'visit-no-card'
  | 'visit-done'
  | 'staff';

const CARD_ERRORS: Record<string, string> = {
  CARD_ON_OTHER_TRIP: 'Wrong card',
  CARD_NOT_ISSUED: 'Wrong card',
  CARD_UNKNOWN: 'Card not known',
  CARD_NOT_ON_TRIP: 'Card not in use',
  CARD_NOT_ON_VISIT: 'Card not in use',
};

const DONE_SECONDS = 5;
const PAGE = 6;

const LOOK = {
  green: { bg: 'bg-ok', text: 'Go', icon: CheckCircle2 },
  amber: { bg: 'bg-warn', text: 'Check', icon: TriangleAlert },
  red: { bg: 'bg-bad', text: 'Call supervisor', icon: PhoneCall },
} as const;

export function GateOut({ mock }: { mock: boolean }) {
  const [state, setState] = useState<ExitState | null>(null);
  const [stage, setStage] = useState<Stage>('waiting');
  const [truck, setTruck] = useState<ExitTruck | null>(null);
  const [readId, setReadId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GateOutResponse | null>(null);
  const [people, setPeople] = useState<VisitExit[]>([]);
  const [visit, setVisit] = useState<VisitExit | null>(null);
  const [visitResult, setVisitResult] = useState<VisitOutResponse | null>(null);
  const ignoredReads = useRef(new Set<string>());

  const load = useCallback(async () => {
    const [s, p] = await Promise.all([
      api.get<ExitState>('/api/gate/exit'),
      api.get<VisitExit[]>('/api/gate/exit/people'),
    ]);
    setPeople(p);
    setState(s);
    return s;
  }, []);

  const reset = useCallback(() => {
    setTruck(null);
    setVisit(null);
    setVisitResult(null);
    setReadId(null);
    setError(null);
    setResult(null);
    setState(null);
    setStage('waiting');
    void load();
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (stage !== 'waiting') return;
    const id = setInterval(() => void load(), 10_000);
    return () => clearInterval(id);
  }, [stage, load]);
  useLiveEvents((e) => {
    const fresh = e.type === 'connected' || (e.type === 'plate_read' && e.camera === 'exit');
    if (stage === 'waiting' && fresh) void load();
    // A check or DO done while the truck waits at the exit updates its colour.
    if (stage === 'truck' && e.type === 'trip_changed' && truck && e.tripId === truck.id) {
      void api
        .get<ExitTruck>(`/api/gate/exit/trips/${truck.id}`)
        .then(setTruck)
        .catch(() => undefined);
    }
  });

  // A fresh exit camera read opens the truck (or "not inside").
  useEffect(() => {
    if (stage !== 'waiting' || !state?.read || ignoredReads.current.has(state.read.id)) return;
    setReadId(state.read.id);
    if (state.truck) {
      setTruck(state.truck);
      setStage('truck');
    } else {
      setStage('unknown');
    }
  }, [state, stage]);

  const red =
    (stage === 'truck' && truck?.status.level === 'red') ||
    (stage === 'visit' && visit?.status.level === 'red');
  useAlarm(red, truck?.id ?? visit?.id ?? null);
  useAlarm(result?.status.level === 'red', result?.trip.id ?? null);
  useAlarm(visitResult?.status.level === 'red', visitResult?.visit.id ?? null);

  const submit = async (tripId: string, cardNo: string | null) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<GateOutResponse>('/api/gate/out', {
        tripId,
        plateReadId: truck?.id === tripId ? readId : null,
        cardNo,
      });
      if (readId) ignoredReads.current.add(readId);
      setResult(res);
      setStage('done');
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'NETWORK';
      setError(CARD_ERRORS[code] ?? 'Not saved');
      if (stage === 'no-card') setStage('truck');
    } finally {
      setBusy(false);
    }
  };

  const submitVisit = async (visitId: string, cardNo: string | null) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<VisitOutResponse>('/api/gate/visit-out', {
        visitId,
        cardNo,
        // The exit camera read their car: use it up so it does not come back.
        plateReadId: stage === 'unknown' || visit?.plate === state?.read?.plate ? readId : null,
      });
      if (readId) ignoredReads.current.add(readId);
      setVisitResult(res);
      setStage('visit-done');
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'NETWORK';
      setError(CARD_ERRORS[code] ?? 'Not saved');
      if (stage === 'visit-no-card') setStage('visit');
    } finally {
      setBusy(false);
    }
  };

  // Card tap: with a truck or group open it must be its card; otherwise it finds who it is.
  const onCard = async (cardNo: string) => {
    if (stage === 'truck' && truck) return submit(truck.id, cardNo);
    if (stage === 'visit' && visit) return submitVisit(visit.id, cardNo);
    setError(null);
    const enc = encodeURIComponent(cardNo);
    try {
      const found = await api.get<ExitTruck>(`/api/gate/exit/card/${enc}`);
      setTruck(found);
      await submit(found.id, cardNo);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : '';
      if (code !== 'CARD_ON_VISIT') {
        setError(CARD_ERRORS[code] ?? 'Card not known');
        return;
      }
      // A visitor group's card: one tap and they are out.
      try {
        const found = await api.get<VisitExit>(`/api/gate/exit/visit-card/${enc}`);
        setVisit(found);
        await submitVisit(found.id, cardNo);
      } catch (e2) {
        setError(CARD_ERRORS[e2 instanceof ApiError ? e2.code : ''] ?? 'Card not known');
      }
    }
  };
  useCardReader(
    stage === 'waiting' ||
      stage === 'truck' ||
      stage === 'unknown' ||
      stage === 'pick' ||
      stage === 'people' ||
      stage === 'visit',
    (c) => void onCard(c),
  );

  const openVisit = (v: VisitExit) => {
    setVisit(v);
    setError(null);
    setStage('visit');
  };

  /** A car that is not a truck: is it a visitor's car? */
  const visitorCar = () => {
    const plate = state?.read?.plate;
    const match = plate ? people.find((p) => p.plate === plate) : undefined;
    if (match) openVisit(match);
    else setStage('people');
  };

  const logStaff = async () => {
    if (!state?.read || busy) return;
    setBusy(true);
    try {
      await api.post('/api/gate/staff', {
        camera: 'exit',
        plate: state.read.plate,
        plateReadId: state.read.id,
      });
      ignoredReads.current.add(state.read.id);
      setStage('staff');
    } catch {
      setError('Not saved');
    } finally {
      setBusy(false);
    }
  };

  const testVisitCard = async () => {
    if (visit?.cardNo) await submitVisit(visit.id, visit.cardNo);
  };

  const testCard = async () => {
    if (!truck) return;
    const { cardNo } = await api.get<{ cardNo: string }>(`/api/dev/card-of/${truck.id}`);
    await submit(truck.id, cardNo);
  };

  const pickTruck = async (tripId: string) => {
    setTruck(await api.get<ExitTruck>(`/api/gate/exit/trips/${tripId}`));
    setStage('truck');
  };

  const cancel = () => {
    if (readId) ignoredReads.current.add(readId);
    reset();
  };

  useEffect(() => {
    if (stage !== 'done' && stage !== 'visit-done' && stage !== 'staff') return;
    const id = setTimeout(reset, (stage === 'staff' ? 2 : DONE_SECONDS) * 1000);
    return () => clearTimeout(id);
  }, [stage, reset]);

  const onSite = state?.onSite ?? [];
  const errorBanner = error && (
    <div role="alert" className="flex items-center gap-3 rounded-2xl bg-warn px-5 py-3 text-white">
      <RotateCcw className="size-10 shrink-0" />
      <div>
        <div className="text-2xl font-extrabold">
          {error === 'Not saved' ? 'Try again' : "Use this truck's card"}
        </div>
        <div className="text-xl font-semibold">{error}</div>
      </div>
    </div>
  );

  if (stage === 'done' && result) {
    const look = LOOK[result.status.level];
    const shown = result.status.reasons.filter((r) => r.level !== 'logged');
    return (
      <button
        type="button"
        data-testid="gate-out-done"
        data-level={result.status.level}
        onClick={reset}
        className={`flex h-full w-full flex-col items-center justify-center gap-4 rounded-2xl text-white ${look.bg}`}
      >
        <div className="text-7xl font-black">OUT</div>
        <div className="font-mono text-6xl font-black">{formatPlate(result.trip.plate)}</div>
        <div className="text-3xl font-bold">{result.trip.tripNo}</div>
        {shown.length > 0 && (
          <div className="px-4 text-center text-3xl font-extrabold">
            {shown.map((r) => r.label).join(' · ')}
          </div>
        )}
        <div className="mt-2 flex items-center gap-2 text-2xl font-bold opacity-90">
          <ArrowRight className="size-8" /> Next
        </div>
      </button>
    );
  }

  if (stage === 'visit-done' && visitResult) {
    const look = LOOK[visitResult.status.level];
    const shown = visitResult.status.reasons.filter((r) => r.level !== 'logged');
    const others = visitResult.visit.groupSize - 1;
    return (
      <button
        type="button"
        data-testid="visit-out-done"
        data-level={visitResult.status.level}
        onClick={reset}
        className={`flex h-full w-full flex-col items-center justify-center gap-4 rounded-2xl text-white ${look.bg}`}
      >
        <div className="text-7xl font-black">OUT</div>
        <div className="flex items-center gap-3 text-5xl font-black">
          <PersonIcon type={visitResult.visit.type} className="size-14" />
          {visitResult.visit.name}
        </div>
        {others > 0 && <div className="text-4xl font-extrabold">+ {others} people</div>}
        <div className="text-3xl font-bold">{visitResult.visit.visitNo}</div>
        {shown.length > 0 && (
          <div className="px-4 text-center text-3xl font-extrabold">
            {shown.map((r) => r.label).join(' · ')}
          </div>
        )}
        <div className="mt-2 flex items-center gap-2 text-2xl font-bold opacity-90">
          <ArrowRight className="size-8" /> Next
        </div>
      </button>
    );
  }

  if (stage === 'staff') {
    return (
      <button
        type="button"
        onClick={reset}
        data-testid="staff-done"
        className="flex h-full w-full flex-col items-center justify-center gap-4 rounded-2xl bg-ok text-white"
      >
        <BadgeCheck className="size-24" />
        <div className="text-6xl font-black">STAFF OUT</div>
        <div className="font-mono text-5xl font-black">{formatPlate(state?.read?.plate ?? '')}</div>
      </button>
    );
  }

  if (stage === 'people') {
    return (
      <PeoplePicker
        list={people}
        onPick={openVisit}
        onBack={() => setStage(readId ? 'unknown' : 'waiting')}
      />
    );
  }

  if ((stage === 'visit' || stage === 'visit-no-card') && visit) {
    const vlook = LOOK[visit.status.level];
    const vreasons = visit.status.reasons.filter((r) => r.level !== 'logged');
    if (stage === 'visit-no-card') {
      return (
        <div className="flex h-full min-h-0 flex-col gap-3">
          <div className="flex items-center gap-4 rounded-2xl bg-bad px-5 py-4 text-white">
            <CreditCard className="size-12" />
            <div className="text-4xl font-extrabold">No card?</div>
            <div className="ml-auto truncate text-3xl font-black">{visit.name}</div>
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
            <BigButton
              tone="plain"
              icon={ArrowLeft}
              label="Back"
              onClick={() => setStage('visit')}
            />
            <BigButton
              tone="bad"
              icon={X}
              label="Yes, no card"
              disabled={busy}
              onClick={() => void submitVisit(visit.id, null)}
            />
          </div>
        </div>
      );
    }
    return (
      <TwoPane
        left={
          <div className="flex h-full min-h-0 flex-col gap-3">
            <div
              data-testid="exit-status"
              data-level={visit.status.level}
              className={`flex items-center gap-4 rounded-2xl px-5 py-4 text-white ${vlook.bg}`}
            >
              <vlook.icon className="size-14 shrink-0" />
              <div className="min-w-0">
                <div className="text-4xl font-black">{vlook.text}</div>
                {vreasons.length > 0 && (
                  <div className="text-2xl font-bold">
                    {vreasons.map((r) => r.label).join(' · ')}
                  </div>
                )}
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-2xl bg-panel p-4 text-center">
              <PersonIcon type={visit.type} className="size-20 text-muted" />
              <div className="text-5xl font-black">{visit.name}</div>
              <div
                className="flex items-center gap-2 text-4xl font-extrabold"
                data-testid="exit-group"
              >
                <UsersRound className="size-10" /> {visit.groupSize}
              </div>
              <div className="text-2xl text-muted">
                {[visit.company, visit.host && `host ${visit.host}`].filter(Boolean).join(' · ')}
              </div>
            </div>
          </div>
        }
        right={
          <div className="flex h-full min-h-0 flex-col gap-3">
            {errorBanner}
            <CardBox />
            <div className="grid grid-cols-2 gap-3">
              <BigButton
                size="md"
                tone="bad"
                icon={X}
                label="No card"
                onClick={() => setStage('visit-no-card')}
              />
              <BigButton size="md" tone="plain" icon={ArrowLeft} label="Cancel" onClick={cancel} />
            </div>
            {mock && (
              <BigButton
                size="sm"
                tone="plain"
                icon={CreditCard}
                label="Test card"
                disabled={busy}
                onClick={() => void testVisitCard()}
              />
            )}
          </div>
        }
      />
    );
  }

  if (stage === 'pick') {
    return (
      <Picker
        list={onSite}
        onPick={(id) => void pickTruck(id)}
        onBack={() => setStage(readId ? 'unknown' : 'waiting')}
      />
    );
  }

  if (stage === 'waiting') {
    return (
      <TwoPane
        left={
          <div className="flex h-full flex-col items-center justify-center gap-4 rounded-2xl bg-panel text-muted">
            <Truck className="size-28" />
            <div className="text-4xl font-extrabold">Waiting for truck</div>
          </div>
        }
        right={
          <div className="flex h-full min-h-0 flex-col gap-3">
            {errorBanner}
            <CardBox />
            <div className="grid grid-cols-2 gap-3">
              <BigButton
                size="md"
                tone="plain"
                icon={List}
                label={`Trucks (${onSite.length})`}
                onClick={() => setStage('pick')}
              />
              <BigButton
                size="md"
                tone="plain"
                icon={UsersRound}
                label={`People (${people.length})`}
                onClick={() => setStage('people')}
              />
            </div>
          </div>
        }
      />
    );
  }

  if (stage === 'unknown') {
    return (
      <TwoPane
        left={
          <div className="flex h-full min-h-0 flex-col gap-3">
            <div
              role="alert"
              data-level="amber"
              className="flex items-center gap-4 rounded-2xl bg-warn px-5 py-3 text-white"
            >
              <SearchX className="size-10 shrink-0" />
              <div className="text-2xl font-extrabold">Not inside</div>
            </div>
            <PlateCard
              plate={state?.read?.plate ?? ''}
              photoId={state?.read?.photoId ?? null}
              confidence={state?.read?.confidence ?? null}
            />
          </div>
        }
        right={
          <div className="flex h-full min-h-0 flex-col gap-3">
            {errorBanner}
            <CardBox />
            <BigButton
              size="md"
              tone="action"
              icon={List}
              label="Pick truck"
              onClick={() => setStage('pick')}
            />
            <div className="grid grid-cols-2 gap-3">
              <BigButton
                size="md"
                tone="plain"
                icon={UserRound}
                label="Visitor"
                onClick={visitorCar}
              />
              <BigButton
                size="md"
                tone="plain"
                icon={BadgeCheck}
                label="Staff"
                disabled={busy}
                onClick={() => void logStaff()}
              />
            </div>
            <BigButton size="sm" tone="plain" icon={X} label="Cancel" onClick={cancel} />
          </div>
        }
      />
    );
  }

  if (!truck) return null;
  const look = LOOK[truck.status.level];
  const reasons = truck.status.reasons.filter((r) => r.level !== 'logged');

  if (stage === 'no-card') {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div className="flex items-center gap-4 rounded-2xl bg-bad px-5 py-4 text-white">
          <CreditCard className="size-12" />
          <div className="text-4xl font-extrabold">No card?</div>
          <div className="ml-auto font-mono text-3xl font-black">{formatPlate(truck.plate)}</div>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
          <BigButton tone="plain" icon={ArrowLeft} label="Back" onClick={() => setStage('truck')} />
          <BigButton
            tone="bad"
            icon={X}
            label="Yes, no card"
            disabled={busy}
            onClick={() => void submit(truck.id, null)}
          />
        </div>
      </div>
    );
  }

  return (
    <TwoPane
      left={
        <div className="flex h-full min-h-0 flex-col gap-3">
          <div
            data-testid="exit-status"
            data-level={truck.status.level}
            className={`flex items-center gap-4 rounded-2xl px-5 py-4 text-white ${look.bg}`}
          >
            <look.icon className="size-14 shrink-0" />
            <div className="min-w-0">
              <div className="text-4xl font-black">{look.text}</div>
              {reasons.length > 0 && (
                <div className="text-2xl font-bold">{reasons.map((r) => r.label).join(' · ')}</div>
              )}
            </div>
          </div>
          <PlateCard
            plate={truck.plate}
            photoId={readId && state?.truck?.id === truck.id ? (state.read?.photoId ?? null) : null}
            confidence={null}
          />
        </div>
      }
      right={
        <div className="flex h-full min-h-0 flex-col gap-3">
          <div className="rounded-2xl bg-panel p-3 portrait:hidden">
            <div className="text-xl font-bold">{truck.tripNo}</div>
            <div className="truncate text-lg text-muted">
              {truck.type === 'outbound' ? 'Collect' : 'Deliver'} ·{' '}
              {truck.transporterName ?? 'Company not set'}
            </div>
          </div>
          {errorBanner}
          <CardBox />
          <div className="grid grid-cols-2 gap-3">
            <BigButton
              size="md"
              tone="bad"
              icon={X}
              label="No card"
              onClick={() => setStage('no-card')}
            />
            <BigButton size="md" tone="plain" icon={ArrowLeft} label="Cancel" onClick={cancel} />
          </div>
          {mock && (
            <BigButton
              size="sm"
              tone="plain"
              icon={CreditCard}
              label="Test card"
              disabled={busy}
              onClick={() => void testCard()}
            />
          )}
        </div>
      }
    />
  );
}

function CardBox() {
  return (
    <div
      data-testid="tap-card"
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-2xl border-4 border-dashed border-action bg-blue-50 p-3 text-center portrait:min-h-28 portrait:flex-none"
    >
      <CreditCard className="size-20 text-action portrait:size-12" />
      <div className="text-4xl font-extrabold portrait:text-3xl">Tap card</div>
    </div>
  );
}

function TwoPane({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div className="grid h-full min-h-0 gap-3 landscape:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] portrait:grid-cols-[minmax(0,1fr)] portrait:grid-rows-[minmax(0,1fr)_auto]">
      <div className="min-h-0 min-w-0">{left}</div>
      <div className="min-h-0 min-w-0">{right}</div>
    </div>
  );
}

function Picker({
  list,
  onPick,
  onBack,
}: {
  list: ExitState['onSite'];
  onPick: (id: string) => void;
  onBack: () => void;
}) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const shown = list.slice(page * PAGE, page * PAGE + PAGE);
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center gap-3">
        <BigButton size="sm" tone="plain" icon={ArrowLeft} label="Back" onClick={onBack} />
        <h2 className="text-3xl font-extrabold">Trucks inside</h2>
      </div>
      {list.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-2xl bg-panel text-3xl font-bold text-muted">
          None
        </div>
      ) : (
        <ul
          aria-label="Trucks inside"
          className="grid min-h-0 flex-1 grid-cols-2 grid-rows-3 gap-3 landscape:grid-cols-3 landscape:grid-rows-2"
        >
          {shown.map((t) => (
            <li key={t.id} className="min-h-0">
              <button
                type="button"
                onClick={() => onPick(t.id)}
                className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-2xl border-4 border-slate-300 bg-panel p-2 active:bg-slate-100"
              >
                <span className="font-mono text-3xl font-black">{formatPlate(t.plate)}</span>
                <span className="text-lg font-semibold text-muted">
                  {t.type === 'outbound' ? 'Collect' : 'Deliver'} · {t.tripNo}
                </span>
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

const PersonIcon = ({ type, className }: { type: VisitExit['type']; className?: string }) =>
  type === 'contractor' ? <HardHat className={className} /> : <UserRound className={className} />;

function PeoplePicker({
  list,
  onPick,
  onBack,
}: {
  list: VisitExit[];
  onPick: (v: VisitExit) => void;
  onBack: () => void;
}) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const shown = list.slice(page * PAGE, page * PAGE + PAGE);
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center gap-3">
        <BigButton size="sm" tone="plain" icon={ArrowLeft} label="Back" onClick={onBack} />
        <h2 className="text-3xl font-extrabold">People inside</h2>
      </div>
      {list.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-2xl bg-panel text-3xl font-bold text-muted">
          None
        </div>
      ) : (
        <ul
          aria-label="People inside"
          className="grid min-h-0 flex-1 grid-cols-2 grid-rows-3 gap-3 landscape:grid-cols-3 landscape:grid-rows-2"
        >
          {shown.map((v) => (
            <li key={v.id} className="min-h-0">
              <button
                type="button"
                onClick={() => onPick(v)}
                className="flex h-full w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-2xl border-4 border-slate-300 bg-panel p-2 text-center active:bg-slate-100"
              >
                <PersonIcon type={v.type} className="size-8 text-muted" />
                <span className="line-clamp-2 text-2xl font-black">{v.name}</span>
                <span className="text-lg font-semibold text-muted">
                  {v.groupSize > 1 ? `${v.groupSize} people` : '1 person'}
                </span>
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
