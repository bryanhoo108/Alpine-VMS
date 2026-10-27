import { Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api, ApiError, type OfficeLists, type PreRegRow } from '../../api';
import { formatPlate, normalizePlate } from '../../plate';
import { Button, Card, Chip, inputClass, ReasonForm } from './ui';

const STATUS = {
  late: { tone: 'warn', text: 'Late' },
  expected: { tone: 'info', text: 'Expected' },
  arrived: { tone: 'ok', text: 'Arrived' },
  cleared: { tone: 'off', text: 'Cleared' },
} as const;

/** Pre-registrations: the clerk enters plate + SDO(s) before the truck comes. */
export function PreRegTab({
  rows,
  lists,
  onChanged,
}: {
  rows: PreRegRow[];
  lists: OfficeLists | null;
  onChanged: () => Promise<void>;
}) {
  const [clearing, setClearing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    // Phone/tablet portrait: one scrolling column. PC: two columns that scroll on their own.
    <div className="h-full min-h-0 space-y-3 overflow-y-auto lg:grid lg:grid-cols-[minmax(340px,2fr)_minmax(0,3fr)] lg:gap-3 lg:space-y-0 lg:overflow-hidden">
      <div className="lg:min-h-0 lg:overflow-y-auto">
        {lists && <NewPreReg lists={lists} onCreated={onChanged} />}
      </div>
      <div className="lg:min-h-0 lg:overflow-y-auto">
        <Card title="Pre-registered trucks">
          {error && (
            <p className="mb-2 font-bold text-bad" role="alert">
              {error}
            </p>
          )}
          {rows.length === 0 && <p className="text-muted">None.</p>}
          <ul className="divide-y divide-slate-200" aria-label="Pre-registered trucks">
            {rows.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="font-mono text-xl font-black">{formatPlate(p.plate)}</span>
                <Chip tone={STATUS[p.status].tone}>{STATUS[p.status].text}</Chip>
                <span className="font-semibold">SDO {p.sdoNos.join(', ')}</span>
                <span className="text-muted">
                  {p.expectedDate} · {p.transporterName ?? 'Company not set'}
                </span>
                {p.tripNo && <span className="text-sm text-muted">→ {p.tripNo}</span>}
                {p.status === 'cleared' && (
                  <span className="text-sm text-muted">({p.clearReason})</span>
                )}
                {(p.status === 'expected' || p.status === 'late') &&
                  (clearing === p.id ? (
                    <div className="w-full">
                      <ReasonForm
                        label="Clear"
                        onCancel={() => setClearing(null)}
                        onSubmit={async (reason) => {
                          try {
                            await api.post(`/api/clerk/pre-registrations/${p.id}/clear`, {
                              reason,
                            });
                            setClearing(null);
                            await onChanged();
                          } catch (e) {
                            setError(e instanceof ApiError ? e.code : 'ERROR');
                          }
                        }}
                      />
                    </div>
                  ) : (
                    <Button className="ml-auto" onClick={() => setClearing(p.id)}>
                      Clear
                    </Button>
                  ))}
                {p.note && <span className="w-full text-sm text-muted">{p.note}</span>}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function NewPreReg({ lists, onCreated }: { lists: OfficeLists; onCreated: () => Promise<void> }) {
  const [plate, setPlate] = useState('');
  const [date, setDate] = useState(lists.today);
  const [transporterId, setTransporterId] = useState('');
  const [sdoNos, setSdoNos] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const options = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = lists.openSdos;
    return (
      q ? all.filter((s) => s.sdoNo.includes(q) || s.customerName.toLowerCase().includes(q)) : all
    ).slice(0, 8);
  }, [lists, search]);

  const valid = normalizePlate(plate).length >= 2 && sdoNos.length > 0 && !!date;

  return (
    <Card title="New pre-registration">
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            await api.post('/api/clerk/pre-registrations', {
              plate,
              expectedDate: date,
              sdoNos,
              transporterId: transporterId || null,
              note: note.trim() || null,
            });
            setSaved(formatPlate(plate));
            setPlate('');
            setSdoNos([]);
            setNote('');
            setSearch('');
            await onCreated();
          } catch (err) {
            setError(err instanceof ApiError ? err.code : 'ERROR');
          }
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 font-semibold">
            Plate
            <input
              className={`${inputClass} font-mono uppercase`}
              value={plate}
              onChange={(e) => setPlate(e.target.value)}
              placeholder="WXY 1234"
            />
          </label>
          <label className="flex flex-col gap-1 font-semibold">
            Expected date
            <input
              type="date"
              className={inputClass}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        </div>
        <label className="flex flex-col gap-1 font-semibold">
          Company
          <select
            className={inputClass}
            value={transporterId}
            onChange={(e) => setTransporterId(e.target.value)}
          >
            <option value="">Not set</option>
            {lists.transporters.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="flex flex-col gap-1">
          <legend className="font-semibold">SDO(s)</legend>
          {sdoNos.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {sdoNos.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSdoNos((x) => x.filter((y) => y !== s))}
                  className="min-h-9 rounded-md bg-blue-100 px-2 font-bold text-blue-800"
                >
                  {s} ×
                </button>
              ))}
            </div>
          )}
          <label className="flex items-center gap-2">
            <Search className="size-5 text-muted" />
            <input
              className={`${inputClass} flex-1`}
              placeholder="SDO number or customer"
              aria-label="Search SDOs"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <ul className="max-h-64 divide-y divide-slate-200 overflow-y-auto">
            {options.map((s) => (
              <li key={s.sdoNo}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={sdoNos.includes(s.sdoNo)}
                    onChange={(e) =>
                      setSdoNos((x) =>
                        e.target.checked ? [...x, s.sdoNo] : x.filter((y) => y !== s.sdoNo),
                      )
                    }
                  />
                  <span className="font-bold">SDO {s.sdoNo}</span>
                  <span className="truncate text-muted">{s.customerName}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        <label className="flex flex-col gap-1 font-semibold">
          Note
          <input
            className={inputClass}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
          />
        </label>
        {error && (
          <p className="font-bold text-bad" role="alert">
            {error}
          </p>
        )}
        {saved && !error && <p className="font-bold text-ok">Saved {saved}.</p>}
        <Button type="submit" tone="action" disabled={!valid}>
          <Plus className="size-5" /> Pre-register
        </Button>
      </form>
    </Card>
  );
}
