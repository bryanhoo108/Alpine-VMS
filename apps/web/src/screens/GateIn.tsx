/**
 * Gate In (entry guard tablet). Normal truck, 3 guard taps:
 *   1. Collect / Deliver (also confirms the plate)
 *   2. Photo (IC)
 *   3. Photo (documents)
 * then the driver taps the card on the tablet and the trip opens.
 * The truck is never refused: alerts show in colour and go to the supervisor.
 */
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  CreditCard,
  FileText,
  IdCard,
  Keyboard,
  PackageOpen,
  RotateCcw,
  SkipForward,
  BadgeCheck,
  Truck,
  UserRound,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  api,
  ApiError,
  type Alert,
  type EntryState,
  type GateInResponse,
  type PreReg,
} from '../api';
import { BigButton } from '../components/BigButton';
import { IcReadChip, useIcRead } from '../components/IcRead';
import { PAGE, Pager } from '../components/Pager';
import { TwoPane } from '../components/TwoPane';
import { PhotoCapture } from '../components/PhotoCapture';
import { PlateCard } from '../components/PlateCard';
import { PlateKeyboard } from '../components/PlateKeyboard';
import { OkBanner, StatusBanner } from '../components/StatusBanner';
import { VisitorIn } from './VisitorIn';
import { useAlarm } from '../hooks/useAlarm';
import { useCardReader } from '../hooks/useCardReader';
import { useLiveEvents } from '../hooks/useLiveEvents';
import { formatPlate, normalizePlate } from '../plate';

type TripType = 'outbound' | 'inbound';
/** First shot is the IC, then documents. */
type PhotoKind = 'ic' | 'document';

interface Draft {
  plateReadId: string | null;
  /** Plate as read by the camera (null if none). */
  lprPlate: string | null;
  plate: string;
  photoId: string | null;
  confidence: number | null;
  alerts: Alert[];
  preReg: PreReg | null;
  /** True when the guard picked the pre-registration (camera misread). */
  pickedPreReg: boolean;
  transporterId: string | null;
  type: TripType | null;
}

type Stage =
  | 'waiting'
  | 'pick'
  | 'keyboard'
  | 'plate'
  | 'transporter'
  | 'photos'
  | 'done'
  | 'visitor'
  | 'staff';

/** Card problems: the guard just uses another card. Not a supervisor matter. */
const CARD_ERRORS: Record<string, string> = {
  CARD_IN_USE: 'Card in use',
  CARD_LOST: 'Card lost',
  CARD_UNKNOWN: 'Card not known',
};

const DONE_SECONDS = 5;

export function GateIn({ mock }: { mock: boolean }) {
  const [entry, setEntry] = useState<EntryState | null>(null);
  const [stage, setStage] = useState<Stage>('waiting');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [photos, setPhotos] = useState({ ic: 0, document: 0 });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GateInResponse | null>(null);
  const uploads = useRef<Promise<string>[]>([]);
  const ic = useIcRead();
  const clearIc = ic.clear;
  const ignoredReads = useRef(new Set<string>());

  const load = useCallback(async () => {
    const state = await api.get<EntryState>('/api/gate/entry');
    setEntry(state);
    return state;
  }, []);

  const reset = useCallback(() => {
    setDraft(null);
    setPhotos({ ic: 0, document: 0 });
    setError(null);
    setResult(null);
    uploads.current = [];
    clearIc();
    // Drop the old state so the waiting screen never re-opens a used read.
    setEntry(null);
    setStage('waiting');
    void load();
  }, [load, clearIc]);

  // A fresh camera read moves the waiting screen to the plate screen.
  useEffect(() => {
    if (stage !== 'waiting' || !entry?.read || ignoredReads.current.has(entry.read.id)) return;
    const r = entry.read;
    setDraft({
      plateReadId: r.id,
      lprPlate: r.plate,
      plate: r.plate,
      photoId: r.photoId,
      confidence: r.confidence,
      alerts: r.alerts,
      preReg: r.preRegistration,
      pickedPreReg: false,
      transporterId: r.transporterId ?? r.preRegistration?.transporterId ?? null,
      type: null,
    });
    setStage('plate');
  }, [entry, stage]);

  useEffect(() => {
    void load();
  }, [load]);
  // Fallback refresh in case the live connection drops.
  useEffect(() => {
    if (stage !== 'waiting') return;
    const id = setInterval(() => void load(), 10_000);
    return () => clearInterval(id);
  }, [stage, load]);
  useLiveEvents((e) => {
    const fresh = e.type === 'connected' || (e.type === 'plate_read' && e.camera === 'entry');
    if (fresh && stage === 'waiting') void load();
  });

  const red = (draft?.alerts ?? []).some((a) => a.level === 'red');
  useAlarm(red && stage === 'plate', draft?.plateReadId ?? draft?.plate ?? null);
  const resultRed = (result?.alerts ?? []).some((a) => a.level === 'red');
  useAlarm(resultRed, result?.trip.id ?? null);

  // --- Actions --------------------------------------------------------------

  const startManual = (plate: string) => {
    setDraft({
      plateReadId: null,
      lprPlate: null,
      plate,
      photoId: null,
      confidence: null,
      alerts: [],
      preReg: null,
      pickedPreReg: false,
      transporterId: null,
      type: null,
    });
    setStage('plate');
  };

  const editPlate = (plate: string) => {
    if (!draft) return startManual(plate);
    const p = normalizePlate(plate);
    const match = entry?.openPreRegistrations.find((x) => x.plate === p) ?? null;
    setDraft({
      ...draft,
      plate: p,
      // A guard-typed plate no longer matches the camera's alerts preview.
      alerts: draft.lprPlate === p ? draft.alerts : [],
      preReg: match,
      pickedPreReg: false,
      transporterId: match?.transporterId ?? (draft.lprPlate === p ? draft.transporterId : null),
    });
    setStage('plate');
  };

  const pickPreReg = (pre: PreReg) => {
    const base: Draft = draft ?? {
      plateReadId: null,
      lprPlate: null,
      plate: pre.plate,
      photoId: null,
      confidence: null,
      alerts: [],
      preReg: null,
      pickedPreReg: false,
      transporterId: null,
      type: null,
    };
    setDraft({
      ...base,
      plate: pre.plate,
      alerts: base.lprPlate === pre.plate ? base.alerts : [],
      preReg: pre,
      pickedPreReg: true,
      transporterId: pre.transporterId ?? base.transporterId,
    });
    setStage('plate');
  };

  const choosePurpose = (type: TripType) => {
    if (!draft) return;
    setDraft({ ...draft, type });
    setStage(draft.transporterId ? 'photos' : 'transporter');
  };

  const cancelTruck = () => {
    if (draft?.plateReadId) ignoredReads.current.add(draft.plateReadId);
    reset();
  };

  /** Staff car: log the plate only (decision V9). */
  const logStaff = async () => {
    if (!draft || busy) return;
    setBusy(true);
    try {
      await api.post('/api/gate/staff', {
        camera: 'entry',
        plate: draft.plate,
        plateReadId: draft.plateReadId,
      });
      if (draft.plateReadId) ignoredReads.current.add(draft.plateReadId);
      setStage('staff');
    } catch {
      setError('Not saved');
    } finally {
      setBusy(false);
    }
  };

  const onPhoto = (kind: PhotoKind, blob: Blob) => {
    setPhotos((c) => ({ ...c, [kind]: c[kind] + 1 }));
    const id = api.upload<{ id: string }>(`/api/photos?kind=${kind}`, blob).then((r) => r.id);
    uploads.current.push(id);
    if (kind === 'ic') ic.read(id);
  };

  const submit = async (cardNo: string) => {
    if (!draft?.type || busy) return;
    setBusy(true);
    setError(null);
    try {
      const photoIds = (await Promise.allSettled(uploads.current))
        .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
        .map((r) => r.value);
      const res = await api.post<GateInResponse>('/api/gate/in', {
        plateReadId: draft.plateReadId,
        plate: draft.plate,
        type: draft.type,
        cardNo,
        photoIds,
        transporterId: draft.transporterId,
        preRegistrationId: draft.pickedPreReg ? (draft.preReg?.id ?? null) : null,
        icRejected: ic.rejected,
      });
      if (draft.plateReadId) ignoredReads.current.add(draft.plateReadId);
      setResult(res);
      setStage('done');
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'NETWORK';
      setError(CARD_ERRORS[code] ?? 'Not saved');
    } finally {
      setBusy(false);
    }
  };

  const nfc = useCardReader(stage === 'photos', (cardNo) => void submit(cardNo));

  const testCard = async () => {
    const { cardNo } = await api.get<{ cardNo: string }>('/api/dev/free-card');
    await submit(cardNo);
  };

  // Done screen resets itself.
  useEffect(() => {
    if (stage !== 'done' && stage !== 'staff') return;
    const id = setTimeout(reset, (stage === 'staff' ? 2 : DONE_SECONDS) * 1000);
    return () => clearTimeout(id);
  }, [stage, reset]);

  // --- Screens --------------------------------------------------------------

  const preRegs = entry?.openPreRegistrations ?? [];

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
          <div className="flex h-full flex-col gap-3">
            <BigButton
              className="flex-1"
              icon={UserRound}
              label="Visitor"
              onClick={() => setStage('visitor')}
            />
            <BigButton
              className="flex-1"
              tone="plain"
              icon={ClipboardList}
              label={`Pre-registered (${preRegs.length})`}
              onClick={() => setStage('pick')}
            />
            <BigButton
              className="flex-1"
              tone="plain"
              icon={Keyboard}
              label="Type plate"
              onClick={() => setStage('keyboard')}
            />
          </div>
        }
      />
    );
  }

  if (stage === 'visitor') {
    return (
      <VisitorIn
        car={draft ? { plate: draft.plate, plateReadId: draft.plateReadId } : null}
        mock={mock}
        onExit={() => {
          if (draft?.plateReadId) ignoredReads.current.add(draft.plateReadId);
          reset();
        }}
      />
    );
  }

  if (stage === 'keyboard') {
    return (
      <PlateKeyboard
        initial={draft?.plate ?? ''}
        onCancel={() => setStage(draft ? 'plate' : 'waiting')}
        onDone={editPlate}
      />
    );
  }

  if (stage === 'pick') {
    return (
      <PreRegPicker
        list={preRegs}
        onPick={pickPreReg}
        onBack={() => setStage(draft ? 'plate' : 'waiting')}
      />
    );
  }

  if (!draft) return null;

  const plateCard = (
    <PlateCard
      plate={draft.plate}
      photoId={draft.photoId}
      confidence={draft.confidence}
      onEdit={stage === 'plate' ? () => setStage('keyboard') : undefined}
    />
  );

  if (stage === 'plate') {
    return (
      <TwoPane
        left={
          <div className="flex h-full min-h-0 flex-col gap-3">
            <StatusBanner alerts={draft.alerts} />
            {plateCard}
          </div>
        }
        right={
          <div className="flex h-full min-h-0 flex-col gap-3">
            <PreRegChip preReg={draft.preReg} />
            <BigButton
              className="flex-1"
              icon={Truck}
              label="Collect"
              onClick={() => choosePurpose('outbound')}
            />
            <BigButton
              className="flex-1"
              icon={PackageOpen}
              label="Deliver"
              onClick={() => choosePurpose('inbound')}
            />
            <div className="flex gap-3">
              <BigButton
                className="flex-1"
                size="md"
                tone="plain"
                icon={UserRound}
                label="Visitor"
                onClick={() => setStage('visitor')}
              />
              <BigButton
                className="flex-1"
                size="md"
                tone="plain"
                icon={BadgeCheck}
                label="Staff"
                disabled={busy}
                onClick={() => void logStaff()}
              />
            </div>
            <div className="flex gap-3">
              {!draft.preReg && preRegs.length > 0 && (
                <BigButton
                  className="flex-1"
                  size="sm"
                  tone="plain"
                  icon={ClipboardList}
                  label="Pre-registered"
                  onClick={() => setStage('pick')}
                />
              )}
              <BigButton
                className="flex-1"
                size="sm"
                tone="plain"
                icon={X}
                label="Cancel"
                onClick={cancelTruck}
              />
            </div>
          </div>
        }
      />
    );
  }

  if (stage === 'transporter') {
    return (
      <TransporterPicker
        list={entry?.transporters ?? []}
        onPick={(id) => {
          setDraft({ ...draft, transporterId: id });
          setStage('photos');
        }}
        onBack={() => setStage('plate')}
      />
    );
  }

  if (stage === 'photos') {
    const step: PhotoKind = photos.ic === 0 ? 'ic' : 'document';
    const ready = photos.ic > 0 && photos.document > 0;
    return (
      <TwoPane
        left={
          <PhotoCapture
            label={step === 'ic' ? 'IC' : 'Documents'}
            cardGuide={step === 'ic'}
            icon={step === 'ic' ? IdCard : FileText}
            badges={[
              { icon: IdCard, count: photos.ic, testId: 'count-ic' },
              { icon: FileText, count: photos.document, testId: 'count-doc' },
            ]}
            onPhoto={(blob) => onPhoto(step, blob)}
          />
        }
        right={
          <div className="flex h-full min-h-0 flex-col gap-3">
            <div className="flex items-center gap-3 rounded-2xl bg-panel p-3">
              <button
                type="button"
                aria-label="Back"
                onClick={() => setStage('plate')}
                className="flex size-14 items-center justify-center rounded-xl border-2 border-slate-300"
              >
                <ArrowLeft className="size-8" />
              </button>
              <div className="min-w-0">
                <div className="font-mono text-3xl font-black">{formatPlate(draft.plate)}</div>
                <div className="flex items-center gap-2 text-xl font-semibold text-muted">
                  {draft.type === 'outbound' ? (
                    <Truck className="size-6" />
                  ) : (
                    <PackageOpen className="size-6" />
                  )}
                  {draft.type === 'outbound' ? 'Collect' : 'Deliver'}
                  {draft.preReg && draft.type === 'outbound' && (
                    <span>· SDO {draft.preReg.sdoNos.join(', ')}</span>
                  )}
                </div>
              </div>
            </div>
            <IcReadChip ic={ic} />
            {error && (
              <div
                role="alert"
                className="flex items-center gap-4 rounded-2xl bg-warn px-5 py-3 text-white"
              >
                <RotateCcw className="size-10 shrink-0" />
                <div className="min-w-0">
                  <div className="text-2xl font-extrabold">
                    {error === 'Not saved' ? 'Try again' : 'Use another card'}
                  </div>
                  <div className="text-xl font-semibold">{error}</div>
                </div>
              </div>
            )}
            <div
              data-testid="tap-card"
              className={`flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-2xl border-4 border-dashed p-4 text-center ${ready ? 'border-action bg-blue-50' : 'border-slate-300 bg-panel'}`}
            >
              <CreditCard
                className={`size-24 ${ready ? 'animate-pulse text-action' : 'text-muted'}`}
              />
              <div className="text-4xl font-extrabold">{busy ? 'Saving…' : 'Tap card'}</div>
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

  if (stage === 'staff') {
    return (
      <button
        type="button"
        onClick={reset}
        data-testid="staff-done"
        className="flex h-full w-full flex-col items-center justify-center gap-4 rounded-2xl bg-ok text-white"
      >
        <BadgeCheck className="size-24" />
        <div className="text-6xl font-black">STAFF</div>
        <div className="font-mono text-5xl font-black">{formatPlate(draft.plate)}</div>
      </button>
    );
  }

  // Done
  if (!result) return null;
  const shown = result.alerts.filter((a) => a.level !== 'logged');
  return (
    <button
      type="button"
      onClick={reset}
      data-testid="gate-in-done"
      className={`flex h-full w-full flex-col items-center justify-center gap-4 rounded-2xl text-white ${shown.some((a) => a.level === 'red') ? 'bg-bad' : shown.length ? 'bg-warn' : 'bg-ok'}`}
    >
      <div className="text-7xl font-black">IN</div>
      <div className="font-mono text-6xl font-black">{formatPlate(result.trip.plate)}</div>
      <div className="text-3xl font-bold">{result.trip.tripNo}</div>
      {result.sdoNos.length > 0 && (
        <div className="text-2xl font-semibold">SDO {result.sdoNos.join(', ')}</div>
      )}
      {shown.length > 0 && (
        <div className="text-3xl font-extrabold">{shown.map((a) => a.label).join(' · ')}</div>
      )}
      <div className="mt-2 flex items-center gap-2 text-2xl font-bold opacity-90">
        <ArrowRight className="size-8" /> Next
      </div>
    </button>
  );
}

function PreRegChip({ preReg }: { preReg: PreReg | null }) {
  if (!preReg) return <OkBanner text="New truck" />;
  return (
    <div
      className={`rounded-2xl px-5 py-3 text-white ${preReg.late ? 'bg-warn' : 'bg-ok'}`}
      data-testid="prereg-chip"
    >
      <div className="text-2xl font-extrabold">
        {preReg.late ? 'Pre-advised · Late' : 'Pre-advised'}
      </div>
      <div className="text-xl font-semibold">SDO {preReg.sdoNos.join(', ')}</div>
    </div>
  );
}

function PreRegPicker({
  list,
  onPick,
  onBack,
}: {
  list: PreReg[];
  onPick: (p: PreReg) => void;
  onBack: () => void;
}) {
  const [page, setPage] = useState(0);
  const pages = Math.ceil(list.length / PAGE);
  const shown = list.slice(page * PAGE, page * PAGE + PAGE);
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center gap-3">
        <BigButton size="sm" tone="plain" icon={ArrowLeft} label="Back" onClick={onBack} />
        <h2 className="text-3xl font-extrabold">Pre-registered</h2>
        <div className="ml-auto">
          <Pager page={page} pages={pages} setPage={setPage} />
        </div>
      </div>
      {list.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-2xl bg-panel text-3xl font-bold text-muted">
          None
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-2 gap-3 landscape:grid-cols-3">
          {shown.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onPick(p)}
              className={`flex flex-col items-center justify-center gap-1 rounded-2xl border-4 bg-panel p-2 active:bg-slate-100 ${p.late ? 'border-warn' : 'border-slate-300'}`}
            >
              <span className="font-mono text-3xl font-black">{formatPlate(p.plate)}</span>
              <span className="text-lg font-semibold text-muted">SDO {p.sdoNos.join(', ')}</span>
              {p.late && (
                <span className="rounded bg-warn px-2 text-lg font-bold text-white">Late</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TransporterPicker({
  list,
  onPick,
  onBack,
}: {
  list: { id: string; name: string }[];
  onPick: (id: string | null) => void;
  onBack: () => void;
}) {
  const [page, setPage] = useState(0);
  const pages = Math.ceil(list.length / PAGE);
  const shown = list.slice(page * PAGE, page * PAGE + PAGE);
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center gap-3">
        <BigButton size="sm" tone="plain" icon={ArrowLeft} label="Back" onClick={onBack} />
        <h2 className="flex items-center gap-2 text-3xl font-extrabold">
          <Building2 className="size-9" /> Company?
        </h2>
        <div className="ml-auto">
          <Pager page={page} pages={pages} setPage={setPage} />
        </div>
      </div>
      <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-2 gap-3 landscape:grid-cols-3">
        {shown.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onPick(t.id)}
            className="rounded-2xl border-4 border-slate-300 bg-panel p-2 text-2xl font-bold active:bg-slate-100"
          >
            {t.name}
          </button>
        ))}
      </div>
      <BigButton
        size="md"
        tone="plain"
        icon={SkipForward}
        label="Skip"
        onClick={() => onPick(null)}
      />
    </div>
  );
}
