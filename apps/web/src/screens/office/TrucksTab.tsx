import {
  ArrowLeft,
  CheckCircle2,
  FlaskConical,
  Link2,
  PackageOpen,
  Scale,
  Search,
  Trash2,
  Truck,
  UserRound,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  api,
  ApiError,
  photoUrl,
  type OfficeLists,
  type TripDetail,
  type TripSummary,
} from '../../api';
import { dateTimeOf, linesSummary, timeOf } from '../../format';
import { formatPlate } from '../../plate';
import { DosCard } from './DosCard';
import { Button, Card, Chip, inputClass, ReasonForm } from './ui';

interface Props {
  trips: TripSummary[];
  lists: OfficeLists | null;
  /** Changes on every reload, so the open truck refreshes too. */
  tick: number;
  mock: boolean;
  onChanged: () => Promise<void>;
}

export function TrucksTab({ trips, lists, tick, mock, onChanged }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [onlyUnmatched, setOnlyUnmatched] = useState(false);
  const shown = onlyUnmatched
    ? trips.filter((t) => t.type === 'outbound' && !t.stage.matched)
    : trips;

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(320px,2fr)_minmax(0,5fr)]">
      <div className={`flex min-h-0 flex-col gap-2 ${selected ? 'max-lg:hidden' : ''}`}>
        <label className="flex min-h-11 items-center gap-2 rounded-xl bg-panel px-3 font-semibold">
          <input
            type="checkbox"
            className="size-5"
            checked={onlyUnmatched}
            onChange={(e) => setOnlyUnmatched(e.target.checked)}
          />
          Not matched only
        </label>
        <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1" aria-label="Trucks on site">
          {shown.length === 0 && <li className="rounded-xl bg-panel p-4 text-muted">No trucks.</li>}
          {shown.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setSelected(t.id)}
                className={`w-full rounded-xl border-l-8 bg-panel p-3 text-left shadow-sm ${selected === t.id ? 'ring-4 ring-action' : ''} ${t.alertLevel === 'red' ? 'border-bad' : t.alertLevel === 'amber' ? 'border-warn' : 'border-transparent'}`}
              >
                <div className="flex items-center gap-2">
                  {t.type === 'outbound' ? (
                    <Truck className="size-5" />
                  ) : (
                    <PackageOpen className="size-5" />
                  )}
                  <span className="font-mono text-xl font-black">{formatPlate(t.plate)}</span>
                  <span className="ml-auto text-sm text-muted">{timeOf(t.gateInAt)}</span>
                </div>
                <div className="truncate text-sm text-muted">
                  {t.tripNo} · {t.transporterName ?? 'Company not set'}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {t.type === 'outbound' &&
                    (t.stage.matched ? (
                      <Chip tone="ok">SDO {t.sdoNos.join(', ')}</Chip>
                    ) : (
                      <Chip tone="warn">Not matched</Chip>
                    ))}
                  {t.preAdvised && <Chip tone="info">Pre-advised</Chip>}
                  <Chip tone={t.stage.weighedOut ? 'ok' : t.stage.weighedIn ? 'info' : 'off'}>
                    {t.stage.weighedOut
                      ? 'Weighed out'
                      : t.stage.weighedIn
                        ? 'Weighed in'
                        : 'Not weighed'}
                  </Chip>
                  {t.type === 'outbound' && (
                    <Chip
                      tone={
                        t.stage.checked === 'approve'
                          ? 'ok'
                          : t.stage.checked === 'reject'
                            ? 'bad'
                            : 'off'
                      }
                    >
                      {t.stage.checked === 'approve'
                        ? 'Checked'
                        : t.stage.checked === 'reject'
                          ? 'Rejected'
                          : 'Not checked'}
                    </Chip>
                  )}
                  {t.type === 'outbound' && (
                    <Chip tone={t.stage.doCount ? 'ok' : 'off'}>DO {t.stage.doCount}</Chip>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className={`min-h-0 overflow-y-auto ${selected ? '' : 'max-lg:hidden'}`}>
        {selected ? (
          <TripPanel
            key={selected}
            tripId={selected}
            lists={lists}
            tick={tick}
            mock={mock}
            onChanged={onChanged}
            onBack={() => setSelected(null)}
          />
        ) : (
          <div className="flex h-full items-center justify-center rounded-2xl bg-panel p-6 text-xl font-bold text-muted">
            Pick a truck
          </div>
        )}
      </div>
    </div>
  );
}

const REASON = {
  on_ticket: { tone: 'ok', text: 'On CWIS ticket' },
  usual_customer: { tone: 'info', text: 'Usual customer' },
  open: { tone: 'off', text: 'Open' },
} as const;

function TripPanel({
  tripId,
  lists,
  tick,
  mock,
  onChanged,
  onBack,
}: {
  tripId: string;
  lists: OfficeLists | null;
  tick: number;
  mock: boolean;
  onChanged: () => Promise<void>;
  onBack: () => void;
}) {
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [bigPhoto, setBigPhoto] = useState<string | null>(null);
  const [clearing, setClearing] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<TripDetail>(`/api/clerk/trips/${tripId}`)
      .then(setTrip)
      .catch((e) => setError(e instanceof ApiError ? e.code : 'ERROR'));
  }, [tripId, tick]);

  const act = async (fn: () => Promise<TripDetail | unknown>) => {
    setError(null);
    try {
      const res = await fn();
      if (res && typeof res === 'object' && 'tripNo' in res) setTrip(res as TripDetail);
      await onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.code : 'ERROR');
    }
  };

  const shortlist = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = trip?.shortlist ?? [];
    return q
      ? all.filter((s) => s.sdoNo.includes(q) || (s.customerName ?? '').toLowerCase().includes(q))
      : all.slice(0, 8);
  }, [trip, search]);

  if (!trip) return <div className="rounded-2xl bg-panel p-6">{error ?? 'Loading…'}</div>;
  const outbound = trip.type === 'outbound';

  return (
    <div className="space-y-3" data-testid="trip-panel">
      <section className="rounded-2xl bg-panel p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={onBack} aria-label="Back to list" className="lg:hidden">
            <ArrowLeft className="size-5" />
          </Button>
          <span className="rounded-lg bg-ink px-3 py-1 font-mono text-3xl font-black text-white">
            {formatPlate(trip.plate)}
          </span>
          <div>
            <div className="text-lg font-bold">
              {trip.tripNo} · {outbound ? 'Collect (pipes)' : 'Deliver (coil)'}
            </div>
            <div className="text-muted">
              In {dateTimeOf(trip.gateInAt)} by {trip.gateInBy ?? '–'}
            </div>
          </div>
          {trip.preAdvised && <Chip tone="info">Pre-advised</Chip>}
        </div>
        {error && (
          <p className="mt-2 font-bold text-bad" role="alert">
            {error}
          </p>
        )}
        <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 font-semibold">
            Company
            <select
              className={`${inputClass} w-full min-w-0`}
              value={trip.transporterId ?? ''}
              onChange={(e) =>
                act(() =>
                  api.put(`/api/clerk/trips/${trip.id}/transporter`, {
                    transporterId: e.target.value || null,
                  }),
                )
              }
            >
              <option value="">Not set</option>
              {lists?.transporters.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <DriverForm
            trip={trip}
            onSave={(name, icLast4) =>
              act(() => api.put(`/api/clerk/trips/${trip.id}/driver`, { name, icLast4 }))
            }
          />
        </div>
      </section>

      {trip.photos.length > 0 && (
        <Card title="Gate photos">
          <div className="flex gap-2 overflow-x-auto">
            {trip.photos.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setBigPhoto(p.id)}
                className="shrink-0 text-center"
              >
                <img
                  src={photoUrl(p.id)}
                  alt={p.kind}
                  className="h-28 w-40 rounded-lg bg-slate-200 object-cover"
                />
                <span className="text-sm font-semibold capitalize text-muted">
                  {p.kind === 'ic' ? 'IC' : p.kind}
                </span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {outbound && (
        <Card title={`SDOs on this truck (${trip.sdos.length})`}>
          {trip.sdos.length === 0 && (
            <p className="font-semibold text-warn">Not matched yet. Pick from the list below.</p>
          )}
          <div className="space-y-2">
            {trip.sdos.map((s) => (
              <div
                key={s.sdoNo}
                className="rounded-xl border-2 border-slate-200 p-3"
                data-testid={`linked-${s.sdoNo}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-lg font-black">SDO {s.sdoNo}</span>
                  <span className="text-muted">{s.customerName ?? 'Not in SAP cache'}</span>
                  {s.changed && <Chip tone="warn">SDO changed</Chip>}
                  {s.status === 'closed' && <Chip tone="bad">Closed in SAP</Chip>}
                  <Chip tone="off">
                    {s.source === 'clerk' ? 'Matched by clerk' : 'Pre-registered'}
                  </Chip>
                  <Button
                    tone="danger"
                    className="ml-auto"
                    aria-label={`Remove SDO ${s.sdoNo}`}
                    onClick={() =>
                      act(() => api.del(`/api/clerk/trips/${trip.id}/sdos/${s.sdoNo}`))
                    }
                  >
                    <Trash2 className="size-5" /> Remove
                  </Button>
                </div>
                <LinesTable lines={s.lines} />
              </div>
            ))}
          </div>
        </Card>
      )}

      {outbound && (
        <Card
          title="Add SDO"
          actions={
            <Button
              tone="action"
              disabled={picked.length === 0}
              onClick={() =>
                act(async () => {
                  const r = await api.post(`/api/clerk/trips/${trip.id}/sdos`, { sdoNos: picked });
                  setPicked([]);
                  setSearch('');
                  return r;
                })
              }
            >
              <Link2 className="size-5" /> Link {picked.length || ''}
            </Button>
          }
        >
          <label className="mb-2 flex items-center gap-2">
            <Search className="size-5 text-muted" />
            <input
              className={`${inputClass} flex-1`}
              placeholder="SDO number or customer"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search SDOs"
            />
          </label>
          <ul className="divide-y divide-slate-200" aria-label="SDO shortlist">
            {shortlist.length === 0 && <li className="py-2 text-muted">No open SDOs match.</li>}
            {shortlist.map((s) => (
              <li key={s.sdoNo}>
                <label className="flex cursor-pointer flex-wrap items-center gap-3 py-2">
                  <input
                    type="checkbox"
                    className="size-6"
                    checked={picked.includes(s.sdoNo)}
                    onChange={(e) =>
                      setPicked((p) =>
                        e.target.checked ? [...p, s.sdoNo] : p.filter((x) => x !== s.sdoNo),
                      )
                    }
                  />
                  <span className="text-lg font-black">SDO {s.sdoNo}</span>
                  <Chip tone={REASON[s.reason].tone}>{REASON[s.reason].text}</Chip>
                  <span className="font-semibold">{s.customerName}</span>
                  <span className="w-full pl-9 text-sm text-muted">{linesSummary(s.lines)}</span>
                </label>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {outbound && <DosCard trip={trip} mock={mock} act={act} />}

      <Card
        title="Weighbridge (CWIS)"
        actions={
          mock && (
            <WeighbridgeTest
              tripId={trip.id}
              plate={trip.plate}
              weighedIn={trip.tickets.length > 0}
              onDone={onChanged}
            />
          )
        }
      >
        {trip.tickets.length === 0 ? (
          <p className="text-muted">No ticket yet.</p>
        ) : (
          <table className="w-full text-left">
            <thead className="text-sm text-muted">
              <tr>
                <th className="py-1">Ticket</th>
                <th>Plate</th>
                <th>SDO</th>
                <th>In</th>
                <th>Out</th>
              </tr>
            </thead>
            <tbody>
              {trip.tickets.map((t) => (
                <tr key={t.ticketNo} className="border-t border-slate-200">
                  <td className="py-1 font-mono font-bold">{t.ticketNo}</td>
                  <td>
                    <span className="font-mono">{formatPlate(t.plate)}</span>{' '}
                    {t.plateDiffers && <Chip tone="warn">Plate differs</Chip>}
                  </td>
                  <td>{t.sdoNos.join(', ') || '–'}</td>
                  <td>{timeOf(t.weighInAt)}</td>
                  <td>{timeOf(t.weighOutAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {trip.alerts.length > 0 && (
        <Card title="Alerts on this truck">
          <ul className="space-y-2">
            {trip.alerts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2">
                <Chip tone={a.level === 'red' ? 'bad' : a.level === 'amber' ? 'warn' : 'off'}>
                  {a.label}
                </Chip>
                <span className="text-sm text-muted">{timeOf(a.raisedAt)}</span>
                {a.clearedAt ? (
                  <span className="text-sm text-muted">Cleared: {a.clearReason}</span>
                ) : a.level === 'logged' ? null : clearing === a.id ? (
                  <div className="w-full">
                    <ReasonForm
                      label="Clear"
                      onCancel={() => setClearing(null)}
                      onSubmit={(reason) =>
                        act(async () => {
                          await api.post(`/api/alerts/${a.id}/clear`, { reason });
                          setClearing(null);
                        })
                      }
                    />
                  </div>
                ) : (
                  <Button onClick={() => setClearing(a.id)}>Clear</Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {bigPhoto && (
        <button
          type="button"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setBigPhoto(null)}
          aria-label="Close photo"
        >
          <img src={photoUrl(bigPhoto)} alt="" className="max-h-full max-w-full rounded-lg" />
        </button>
      )}
    </div>
  );
}

function LinesTable({ lines }: { lines: TripDetail['sdos'][number]['lines'] }) {
  if (lines.length === 0) return null;
  return (
    <table className="mt-2 w-full text-left">
      <thead className="text-sm text-muted">
        <tr>
          <th>Size</th>
          <th>Spec</th>
          <th>Length</th>
          <th className="text-right">Pieces</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.lineNo} className="border-t border-slate-100">
            <td className="py-1 font-semibold">{l.size}</td>
            <td>{l.spec}</td>
            <td>{l.length}</td>
            <td className="text-right font-mono font-bold">{l.pieces}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DriverForm({
  trip,
  onSave,
}: {
  trip: TripDetail;
  onSave: (name: string, icLast4: string | null) => void;
}) {
  const [name, setName] = useState(trip.driver?.name ?? '');
  const [ic, setIc] = useState(trip.driver?.icLast4 ?? '');
  const valid = name.trim().length >= 2 && (ic === '' || /^\d{4}$/.test(ic));
  return (
    <form
      className="flex flex-col gap-1 font-semibold"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSave(name.trim(), ic || null);
      }}
    >
      <span className="flex items-center gap-1">
        <UserRound className="size-5" /> Driver
      </span>
      <div className="flex flex-wrap gap-2">
        <input
          className={`${inputClass} min-w-40 flex-1`}
          placeholder="Name"
          aria-label="Driver name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className={`${inputClass} w-28`}
          placeholder="IC last 4"
          aria-label="IC last 4 digits"
          inputMode="numeric"
          maxLength={4}
          value={ic}
          onChange={(e) => setIc(e.target.value.replace(/\D/g, ''))}
        />
        <Button type="submit" tone="action" disabled={!valid}>
          Save
        </Button>
      </div>
    </form>
  );
}

/** Mock mode only: stand in for the weighbridge operator. */
function WeighbridgeTest({
  tripId,
  plate,
  weighedIn,
  onDone,
}: {
  tripId: string;
  plate: string;
  weighedIn: boolean;
  onDone: () => Promise<void>;
}) {
  const run = async (url: string, body: object) => {
    await api.post(url, body);
    await onDone();
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-purple-50 p-1">
      <FlaskConical className="size-5 text-purple-700" />
      {!weighedIn ? (
        <>
          <Button onClick={() => run('/api/dev/cwis/weigh-in', { tripId })}>
            <Scale className="size-5" /> Test weigh in
          </Button>
          <Button
            onClick={() =>
              run('/api/dev/cwis/weigh-in', {
                tripId,
                plate: plate.slice(0, -1) + ((Number(plate.at(-1)) + 1) % 10),
              })
            }
          >
            <XCircle className="size-5" /> Wrong plate
          </Button>
        </>
      ) : (
        <Button onClick={() => run('/api/dev/cwis/weigh-out', { tripId })}>
          <CheckCircle2 className="size-5" /> Test weigh out
        </Button>
      )}
    </div>
  );
}
