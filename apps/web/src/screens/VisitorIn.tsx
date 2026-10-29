/**
 * Gate In for visitors and contractors (decisions V2, V3, V6, V7), on the
 * entry guard tablet. Invited group, 3 taps:
 *   1. Visitor   2. their name (or scan their QR)   3. Photo (IC)
 * then the visitor taps the card. Walk-ins register on the same tablet and
 * the guard phones the host. Nobody is refused: problems show in colour.
 */
import {
  ArrowLeft,
  ArrowRight,
  CreditCard,
  HardHat,
  IdCard,
  Minus,
  Phone,
  PhoneOff,
  Plus,
  QrCode,
  RotateCcw,
  ThumbsUp,
  UserPlus,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  ApiError,
  type Host,
  type Invite,
  type VisitInResponse,
  type VisitType,
} from '../api';
import { BigButton } from '../components/BigButton';
import { IcReadChip, useIcRead } from '../components/IcRead';
import { PAGE, Pager } from '../components/Pager';
import { PhotoCapture } from '../components/PhotoCapture';
import { QrScanner } from '../components/QrScanner';
import { TwoPane } from '../components/TwoPane';
import { useAlarm } from '../hooks/useAlarm';
import { useCardReader } from '../hooks/useCardReader';
import { formatPlate } from '../plate';

interface Car {
  plate: string;
  plateReadId: string | null;
}

interface Visitor {
  invite: Invite | null;
  type: VisitType;
  name: string;
  company: string;
  phone: string;
  host: Host | null;
  groupSize: number;
  hostConfirmed: boolean;
}

type Stage = 'start' | 'scan' | 'form' | 'host' | 'call' | 'photo' | 'done';

const CARD_ERRORS: Record<string, string> = {
  CARD_IN_USE: 'Card in use',
  CARD_LOST: 'Card lost',
  CARD_UNKNOWN: 'Card not known',
};
const SCAN_ERRORS: Record<string, string> = {
  NOT_AN_INVITE: 'Not our QR',
  INVITE_NOT_FOUND: 'Invite not found',
};
const DONE_SECONDS = 5;

const TypeIcon = ({ type, className }: { type: VisitType; className?: string }) =>
  type === 'contractor' ? <HardHat className={className} /> : <UserRound className={className} />;

export function VisitorIn({
  car,
  mock,
  onExit,
}: {
  /** The car they came in, when the entry camera read one. */
  car: Car | null;
  mock: boolean;
  /** Back to the gate's waiting screen (done or cancelled). */
  onExit: () => void;
}) {
  const [expected, setExpected] = useState<Invite[]>([]);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [stage, setStage] = useState<Stage>('start');
  const [v, setV] = useState<Visitor | null>(null);
  const [photos, setPhotos] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VisitInResponse | null>(null);
  const uploads = useRef<Promise<string>[]>([]);
  const ic = useIcRead();

  useEffect(() => {
    void api.get<Invite[]>('/api/gate/invites/today').then(setExpected);
    void api.get<Host[]>('/api/hosts').then(setHosts);
  }, []);

  const fromInvite = useCallback((inv: Invite) => {
    const host = inv.host
      ? {
          id: inv.host.id,
          name: inv.host.name,
          department: inv.host.department,
          phone: null,
          active: true,
        }
      : null;
    setV({
      invite: inv,
      type: inv.type,
      name: inv.name,
      company: inv.company ?? '',
      phone: inv.phone ?? '',
      host,
      groupSize: inv.groupSize,
      hostConfirmed: inv.state === 'expected',
    });
    setError(null);
    // Not for today or cancelled: still let them in, but the guard phones the host.
    setStage(inv.state === 'expected' ? 'photo' : 'call');
  }, []);

  // A car whose plate is on today's invite: straight to that invite.
  useEffect(() => {
    if (stage !== 'start' || !car || v) return;
    const match = expected.find((i) => i.plate === car.plate);
    if (match) fromInvite(match);
  }, [expected, car, stage, v, fromInvite]);

  const onScan = async (text: string) => {
    try {
      const inv = await api.get<Invite>(`/api/gate/invites/find?code=${encodeURIComponent(text)}`);
      fromInvite(inv);
    } catch (e) {
      setError(e instanceof ApiError ? (SCAN_ERRORS[e.code] ?? 'Try again') : 'Try again');
    }
  };

  const startWalkIn = () => {
    setV({
      invite: null,
      type: 'visitor',
      name: '',
      company: '',
      phone: '',
      host: null,
      groupSize: 1,
      hostConfirmed: false,
    });
    setStage('form');
  };

  const onPhoto = (blob: Blob) => {
    setPhotos((n) => n + 1);
    const id = api.upload<{ id: string }>('/api/photos?kind=ic', blob).then((r) => r.id);
    uploads.current.push(id);
    ic.read(id);
  };

  const submit = async (cardNo: string) => {
    if (!v || busy) return;
    setBusy(true);
    setError(null);
    try {
      const photoIds = (await Promise.allSettled(uploads.current))
        .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
        .map((r) => r.value);
      const res = await api.post<VisitInResponse>('/api/gate/visit-in', {
        inviteId: v.invite?.id ?? null,
        type: v.type,
        name: v.name,
        company: v.company || null,
        phone: v.phone || null,
        hostId: v.host?.id ?? null,
        groupSize: v.groupSize,
        hostConfirmed: v.hostConfirmed,
        plate: car?.plate ?? null,
        plateReadId: car?.plateReadId ?? null,
        cardNo,
        photoIds,
        icRejected: ic.rejected,
      });
      setResult(res);
      setStage('done');
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'NETWORK';
      setError(CARD_ERRORS[code] ?? 'Not saved');
    } finally {
      setBusy(false);
    }
  };

  const nfc = useCardReader(stage === 'photo', (cardNo) => void submit(cardNo));
  const testCard = async () => {
    const { cardNo } = await api.get<{ cardNo: string }>('/api/dev/free-card');
    await submit(cardNo);
  };

  const resultRed = (result?.alerts ?? []).some((a) => a.level === 'red');
  useAlarm(resultRed, result?.visit.id ?? null);
  useEffect(() => {
    if (stage !== 'done') return;
    const id = setTimeout(onExit, DONE_SECONDS * 1000);
    return () => clearTimeout(id);
  }, [stage, onExit]);

  // --- Screens --------------------------------------------------------------------

  if (stage === 'start') {
    return (
      <ExpectedPicker
        list={expected}
        car={car}
        onPick={fromInvite}
        onScan={() => {
          setError(null);
          setStage('scan');
        }}
        onWalkIn={startWalkIn}
        onBack={onExit}
      />
    );
  }

  if (stage === 'scan') {
    return (
      <TwoPane
        left={<QrScanner onCode={(t) => void onScan(t)} />}
        right={
          <div className="flex h-full min-h-0 flex-col gap-3">
            {error && <ProblemBar title="Try again" text={error} />}
            <div className="flex flex-1 items-center justify-center rounded-2xl bg-panel p-4 text-center text-3xl font-extrabold text-muted">
              Hold QR to camera
            </div>
            {mock && expected[0] && (
              <BigButton
                size="sm"
                tone="plain"
                icon={QrCode}
                label="Test QR"
                onClick={() => void onScan(expected[0]!.qrText)}
              />
            )}
            <BigButton
              size="md"
              tone="plain"
              icon={ArrowLeft}
              label="Back"
              onClick={() => setStage('start')}
            />
          </div>
        }
      />
    );
  }

  if (!v) return null;

  if (stage === 'form') {
    return (
      <WalkInForm
        v={v}
        onChange={setV}
        onNext={() => setStage('host')}
        onBack={() => setStage('start')}
      />
    );
  }

  if (stage === 'host') {
    return (
      <HostPicker
        list={hosts}
        onPick={(host) => {
          setV({ ...v, host });
          setStage('call');
        }}
        onBack={() => setStage('form')}
      />
    );
  }

  if (stage === 'call') {
    const phone = hosts.find((h) => h.id === v.host?.id)?.phone ?? v.host?.phone ?? null;
    return (
      <TwoPane
        left={
          <div className="flex h-full flex-col items-center justify-center gap-3 rounded-2xl bg-panel p-4 text-center">
            {v.invite && v.invite.state !== 'expected' && (
              <div className="rounded-xl bg-warn px-4 py-2 text-2xl font-extrabold text-white">
                {v.invite.state === 'cancelled' ? 'Invite cancelled' : 'Not for today'}
              </div>
            )}
            <Phone className="size-20 text-action" />
            <div className="text-3xl font-extrabold">Call host</div>
            <div className="text-4xl font-black">{v.host?.name ?? 'No host'}</div>
            {phone && <div className="font-mono text-4xl font-black">{phone}</div>}
            <div className="text-xl text-muted">
              {v.name} · {v.company || '–'} · {v.groupSize}{' '}
              {v.groupSize === 1 ? 'person' : 'people'}
            </div>
          </div>
        }
        right={
          <div className="flex h-full min-h-0 flex-col gap-3">
            <BigButton
              className="flex-1"
              tone="ok"
              icon={ThumbsUp}
              label="Host OK"
              onClick={() => {
                setV({ ...v, hostConfirmed: true });
                setStage('photo');
              }}
            />
            <BigButton
              className="flex-1"
              tone="warn"
              icon={PhoneOff}
              label="No answer"
              onClick={() => {
                setV({ ...v, hostConfirmed: false });
                setStage('photo');
              }}
            />
            <BigButton
              size="sm"
              tone="plain"
              icon={ArrowLeft}
              label="Back"
              onClick={() => setStage(v.invite ? 'start' : 'host')}
            />
          </div>
        }
      />
    );
  }

  if (stage === 'photo') {
    return (
      <TwoPane
        left={
          <PhotoCapture
            label="IC"
            icon={IdCard}
            badges={[{ icon: IdCard, count: photos, testId: 'count-ic' }]}
            onPhoto={onPhoto}
          />
        }
        right={
          <div className="flex h-full min-h-0 flex-col gap-3">
            <div className="flex items-center gap-3 rounded-2xl bg-panel p-3">
              <button
                type="button"
                aria-label="Back"
                onClick={() => setStage(v.invite ? 'start' : 'call')}
                className="flex size-14 shrink-0 items-center justify-center rounded-xl border-2 border-slate-300"
              >
                <ArrowLeft className="size-8" />
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-2 truncate text-2xl font-black">
                  <TypeIcon type={v.type} className="size-7 shrink-0" />
                  <span className="truncate">{v.name}</span>
                </div>
                <div className="truncate text-lg font-semibold text-muted">
                  {[v.company, v.host && `host ${v.host.name}`, car && formatPlate(car.plate)]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
            </div>
            <IcReadChip ic={ic} />
            <GroupStepper value={v.groupSize} onChange={(n) => setV({ ...v, groupSize: n })} />
            {error && (
              <ProblemBar
                title={error === 'Not saved' ? 'Try again' : 'Use another card'}
                text={error}
              />
            )}
            <div
              data-testid="tap-card"
              className={`flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-2xl border-4 border-dashed p-3 text-center ${photos > 0 ? 'border-action bg-blue-50' : 'border-slate-300 bg-panel'}`}
            >
              <CreditCard
                className={`size-16 ${photos > 0 ? 'animate-pulse text-action' : 'text-muted'}`}
              />
              <div className="text-3xl font-extrabold">{busy ? 'Saving…' : 'Tap card'}</div>
              {nfc === 'blocked' && (
                <div className="text-lg text-bad">NFC is off on this tablet</div>
              )}
            </div>
            {mock && (
              <BigButton
                size="sm"
                tone="plain"
                icon={CreditCard}
                label="Test card"
                onClick={() => void testCard()}
                disabled={busy}
              />
            )}
          </div>
        }
      />
    );
  }

  // Done
  if (!result) return null;
  const shown = result.alerts.filter((a) => a.level !== 'logged');
  const others = result.visit.groupSize - 1;
  return (
    <button
      type="button"
      onClick={onExit}
      data-testid="visit-in-done"
      className={`flex h-full w-full flex-col items-center justify-center gap-4 rounded-2xl text-white ${shown.some((a) => a.level === 'red') ? 'bg-bad' : shown.length ? 'bg-warn' : 'bg-ok'}`}
    >
      <div className="text-7xl font-black">IN</div>
      <div className="flex items-center gap-3 text-5xl font-black">
        <TypeIcon type={result.visit.type} className="size-14" />
        {result.visit.name}
      </div>
      {others > 0 && <div className="text-4xl font-extrabold">+ {others} people</div>}
      <div className="text-2xl font-bold">
        {result.visit.visitNo}
        {result.visit.host ? ` · host ${result.visit.host}` : ''}
      </div>
      {shown.length > 0 && (
        <div className="text-3xl font-extrabold">{shown.map((a) => a.label).join(' · ')}</div>
      )}
      <div className="mt-2 flex items-center gap-2 text-2xl font-bold opacity-90">
        <ArrowRight className="size-8" /> Next
      </div>
    </button>
  );
}

function ProblemBar({ title, text }: { title: string; text: string }) {
  return (
    <div role="alert" className="flex items-center gap-4 rounded-2xl bg-warn px-5 py-3 text-white">
      <RotateCcw className="size-10 shrink-0" />
      <div className="min-w-0">
        <div className="text-2xl font-extrabold">{title}</div>
        <div className="text-xl font-semibold">{text}</div>
      </div>
    </div>
  );
}

/** How many people are really at the gate. One card for the whole group (V6). */
function GroupStepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div
      className="flex items-center gap-3 rounded-2xl bg-panel p-2"
      role="group"
      aria-label="People"
    >
      <button
        type="button"
        aria-label="Fewer people"
        disabled={value <= 1}
        onClick={() => onChange(value - 1)}
        className="flex size-16 items-center justify-center rounded-xl border-2 border-slate-300 disabled:opacity-40"
      >
        <Minus className="size-9" />
      </button>
      <div
        className="flex flex-1 items-center justify-center gap-2 text-3xl font-black"
        data-testid="group-size"
      >
        <UsersRound className="size-9" /> {value}
      </div>
      <button
        type="button"
        aria-label="More people"
        disabled={value >= 60}
        onClick={() => onChange(value + 1)}
        className="flex size-16 items-center justify-center rounded-xl border-2 border-slate-300 disabled:opacity-40"
      >
        <Plus className="size-9" />
      </button>
    </div>
  );
}

function ExpectedPicker({
  list,
  car,
  onPick,
  onScan,
  onWalkIn,
  onBack,
}: {
  list: Invite[];
  car: Car | null;
  onPick: (i: Invite) => void;
  onScan: () => void;
  onWalkIn: () => void;
  onBack: () => void;
}) {
  const [page, setPage] = useState(0);
  const pages = Math.ceil(list.length / PAGE);
  const shown = list.slice(page * PAGE, page * PAGE + PAGE);
  return (
    <TwoPane
      left={
        <div className="flex h-full min-h-0 flex-col gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-3xl font-extrabold">Expected ({list.length})</h2>
            {car && (
              <span className="rounded-lg bg-ink px-3 py-1 font-mono text-2xl font-black text-white">
                {formatPlate(car.plate)}
              </span>
            )}
            <div className="ml-auto">
              <Pager page={page} pages={pages} setPage={setPage} />
            </div>
          </div>
          {list.length === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded-2xl bg-panel text-3xl font-bold text-muted">
              None today
            </div>
          ) : (
            <ul
              className="grid min-h-0 flex-1 grid-cols-2 grid-rows-3 gap-3 landscape:grid-cols-3 landscape:grid-rows-2"
              aria-label="Expected today"
            >
              {shown.map((i) => (
                <li key={i.id} className="min-h-0">
                  <button
                    type="button"
                    onClick={() => onPick(i)}
                    className="flex h-full w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-2xl border-4 border-slate-300 bg-panel p-2 text-center active:bg-slate-100"
                  >
                    <TypeIcon
                      type={i.type}
                      className={`size-8 ${i.type === 'contractor' ? 'text-warn' : 'text-action'}`}
                    />
                    <span className="line-clamp-2 text-2xl font-black">{i.name}</span>
                    <span className="line-clamp-1 text-lg font-semibold text-muted">
                      {i.company ?? ''}
                      {i.groupSize > 1 ? ` · ${i.groupSize}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      }
      right={
        <div className="flex h-full min-h-0 flex-col gap-3">
          <BigButton className="flex-1" icon={QrCode} label="Scan QR" onClick={onScan} />
          <BigButton
            className="flex-1"
            tone="plain"
            icon={UserPlus}
            label="Walk-in"
            onClick={onWalkIn}
          />
          <BigButton size="sm" tone="plain" icon={X} label="Cancel" onClick={onBack} />
        </div>
      }
    />
  );
}

/**
 * Walk-in registration, typed by the visitor on the tablet (the kiosk shares
 * the entry tablet, V7). The only typing at the gate apart from plates.
 */
function WalkInForm({
  v,
  onChange,
  onNext,
  onBack,
}: {
  v: Visitor;
  onChange: (v: Visitor) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const input = 'min-h-14 w-full rounded-xl border-2 border-slate-300 bg-white px-3 text-2xl';
  const ok = v.name.trim().length >= 2;
  return (
    <TwoPane
      left={
        <form
          className="flex h-full min-h-0 flex-col gap-2 rounded-2xl bg-panel p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (ok) onNext();
          }}
        >
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Who">
            {(['visitor', 'contractor'] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={v.type === t}
                onClick={() => onChange({ ...v, type: t })}
                className={`flex min-h-14 items-center justify-center gap-2 rounded-xl border-2 text-2xl font-bold ${v.type === t ? 'border-ink bg-ink text-white' : 'border-slate-300'}`}
              >
                <TypeIcon type={t} className="size-7" />
                {t === 'visitor' ? 'Visitor' : 'Contractor'}
              </button>
            ))}
          </div>
          <input
            className={input}
            aria-label="Your name"
            placeholder="Your name"
            autoComplete="off"
            value={v.name}
            onChange={(e) => onChange({ ...v, name: e.target.value })}
          />
          <input
            className={input}
            aria-label="Company"
            placeholder="Company"
            autoComplete="off"
            value={v.company}
            onChange={(e) => onChange({ ...v, company: e.target.value })}
          />
          <input
            className={input}
            aria-label="Phone"
            placeholder="Phone"
            inputMode="tel"
            autoComplete="off"
            value={v.phone}
            onChange={(e) => onChange({ ...v, phone: e.target.value })}
          />
          <GroupStepper value={v.groupSize} onChange={(n) => onChange({ ...v, groupSize: n })} />
        </form>
      }
      right={
        <div className="flex h-full min-h-0 flex-col gap-3">
          <BigButton
            className="flex-1"
            icon={ArrowRight}
            label="Next"
            disabled={!ok}
            onClick={onNext}
          />
          <BigButton size="sm" tone="plain" icon={ArrowLeft} label="Back" onClick={onBack} />
        </div>
      }
    />
  );
}

function HostPicker({
  list,
  onPick,
  onBack,
}: {
  list: Host[];
  onPick: (h: Host) => void;
  onBack: () => void;
}) {
  const [page, setPage] = useState(0);
  const pages = Math.ceil(list.length / PAGE);
  const shown = list.slice(page * PAGE, page * PAGE + PAGE);
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center gap-3">
        <BigButton size="sm" tone="plain" icon={ArrowLeft} label="Back" onClick={onBack} />
        <h2 className="text-3xl font-extrabold">Who to see?</h2>
        <div className="ml-auto">
          <Pager page={page} pages={pages} setPage={setPage} />
        </div>
      </div>
      <ul
        className="grid min-h-0 flex-1 grid-cols-2 grid-rows-3 gap-3 landscape:grid-cols-3 landscape:grid-rows-2"
        aria-label="Hosts"
      >
        {shown.map((h) => (
          <li key={h.id} className="min-h-0">
            <button
              type="button"
              onClick={() => onPick(h)}
              className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-2xl border-4 border-slate-300 bg-panel p-2 active:bg-slate-100"
            >
              <span className="text-2xl font-black">{h.name}</span>
              {h.department && (
                <span className="text-lg font-semibold text-muted">{h.department}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
