/**
 * Visitors and contractors (office): invite people before they come, send the
 * QR, and keep the list of hosts (Alpine staff that visitors come to see).
 */
import { HardHat, Plus, QrCode, UserRound, X } from 'lucide-react';
import { useState } from 'react';
import { api, ApiError, type Host, type Invite, type VisitType } from '../../api';
import { InviteQr } from '../../components/InviteQr';
import { formatPlate } from '../../plate';
import { Button, Card, Chip, inputClass } from './ui';

const STATE = {
  expected: { tone: 'info', text: 'Expected' },
  not_yet: { tone: 'off', text: 'Coming' },
  expired: { tone: 'off', text: 'Ended' },
  cancelled: { tone: 'off', text: 'Cancelled' },
} as const;

const ERRORS: Record<string, string> = {
  NAME_REQUIRED: 'Enter a name.',
  GROUP_SIZE_INVALID: 'Group size must be 1 to 60.',
  DATES_INVALID: 'The last day is before the first day.',
  DATES_IN_PAST: 'The dates are in the past.',
  DATES_TOO_LONG: 'An invite can be at most 31 days.',
  HOST_NOT_FOUND: 'Pick a host.',
};
const errorText = (e: unknown) =>
  e instanceof ApiError ? (ERRORS[e.code] ?? e.code) : 'Something went wrong.';

export function VisitorsTab({
  invites,
  hosts,
  today,
  onChanged,
}: {
  invites: Invite[];
  hosts: Host[];
  today: string;
  onChanged: () => Promise<void>;
}) {
  const [openQr, setOpenQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="h-full min-h-0 space-y-3 overflow-y-auto lg:grid lg:grid-cols-[minmax(340px,2fr)_minmax(0,3fr)] lg:gap-3 lg:space-y-0 lg:overflow-hidden">
      <div className="space-y-3 lg:min-h-0 lg:overflow-y-auto">
        <NewInvite
          hosts={hosts}
          today={today}
          onCreated={async (inv) => {
            await onChanged();
            setOpenQr(inv.id);
          }}
        />
        <HostsCard hosts={hosts} onChanged={onChanged} />
      </div>
      <div className="lg:min-h-0 lg:overflow-y-auto">
        <Card title="Invites">
          {error && (
            <p className="mb-2 font-bold text-bad" role="alert">
              {error}
            </p>
          )}
          {invites.length === 0 && <p className="text-muted">None.</p>}
          <ul className="divide-y divide-slate-200" aria-label="Invites">
            {invites.map((inv) => (
              <li key={inv.id} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  {inv.type === 'contractor' ? (
                    <HardHat className="size-5 text-warn" aria-label="Contractor" />
                  ) : (
                    <UserRound className="size-5 text-blue-800" aria-label="Visitor" />
                  )}
                  <span className="text-lg font-black">{inv.name}</span>
                  {inv.groupSize > 1 && <Chip tone="info">+{inv.groupSize - 1} people</Chip>}
                  {inv.insideVisitId ? (
                    <Chip tone="ok">Inside</Chip>
                  ) : (
                    <Chip tone={STATE[inv.state].tone}>{STATE[inv.state].text}</Chip>
                  )}
                  <span className="text-muted">
                    {[
                      inv.company,
                      inv.host && `host ${inv.host.name}`,
                      inv.validFrom === inv.validTo
                        ? inv.validFrom
                        : `${inv.validFrom} → ${inv.validTo}`,
                      inv.untilTime && `until ${inv.untilTime}`,
                      inv.plate && formatPlate(inv.plate),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <div className="ml-auto flex gap-2">
                    {inv.state !== 'cancelled' && inv.state !== 'expired' && (
                      <Button
                        aria-expanded={openQr === inv.id}
                        onClick={() => setOpenQr(openQr === inv.id ? null : inv.id)}
                      >
                        <QrCode className="size-5" /> QR
                      </Button>
                    )}
                    {(inv.state === 'expected' || inv.state === 'not_yet') &&
                      !inv.insideVisitId && (
                        <Button
                          tone="danger"
                          aria-label={`Cancel invite for ${inv.name}`}
                          onClick={async () => {
                            setError(null);
                            try {
                              await api.post(`/api/invites/${inv.id}/cancel`, {});
                              await onChanged();
                            } catch (e) {
                              setError(errorText(e));
                            }
                          }}
                        >
                          <X className="size-5" /> Cancel
                        </Button>
                      )}
                  </div>
                </div>
                {inv.purpose && <span className="text-sm text-muted">{inv.purpose}</span>}
                {openQr === inv.id && <InviteQr invite={inv} />}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function NewInvite({
  hosts,
  today,
  onCreated,
}: {
  hosts: Host[];
  today: string;
  onCreated: (inv: Invite) => Promise<void>;
}) {
  const [type, setType] = useState<VisitType>('visitor');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  const [groupSize, setGroupSize] = useState(1);
  const [hostId, setHostId] = useState('');
  const [purpose, setPurpose] = useState('');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [until, setUntil] = useState('17:00');
  const [plate, setPlate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const valid = name.trim().length >= 2 && hostId !== '' && groupSize >= 1 && !!from && !!to;

  return (
    <Card title="New invite">
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            const inv = await api.post<Invite>('/api/invites', {
              type,
              name: name.trim(),
              company: company.trim() || null,
              phone: phone.trim() || null,
              groupSize,
              hostId,
              purpose: purpose.trim() || null,
              validFrom: from,
              validTo: to < from ? from : to,
              untilTime: until || null,
              plate: plate.trim() || null,
            });
            setName('');
            setCompany('');
            setPhone('');
            setGroupSize(1);
            setPurpose('');
            setPlate('');
            await onCreated(inv);
          } catch (err) {
            setError(errorText(err));
          }
        }}
      >
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Who">
          {(['visitor', 'contractor'] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={type === t}
              onClick={() => setType(t)}
              className={`flex min-h-12 items-center justify-center gap-2 rounded-lg border-2 font-bold ${type === t ? 'border-ink bg-ink text-white' : 'border-slate-300 bg-panel'}`}
            >
              {t === 'visitor' ? <UserRound className="size-5" /> : <HardHat className="size-5" />}
              {t === 'visitor' ? 'Visitor' : 'Contractor'}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1 font-semibold">
          Name (person who registers)
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1 font-semibold">
            Company
            <input
              className={inputClass}
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 font-semibold">
            Mobile (for WhatsApp)
            <input
              className={inputClass}
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="012-345 6789"
            />
          </label>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1 font-semibold">
            Host
            <select
              className={inputClass}
              value={hostId}
              onChange={(e) => setHostId(e.target.value)}
            >
              <option value="">Pick a host</option>
              {hosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                  {h.department ? ` (${h.department})` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 font-semibold">
            People in the group
            <input
              type="number"
              min={1}
              max={60}
              className={inputClass}
              value={groupSize}
              onChange={(e) => setGroupSize(Math.max(1, Number(e.target.value) || 1))}
            />
          </label>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <label className="flex flex-col gap-1 font-semibold">
            From
            <input
              type="date"
              className={inputClass}
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                if (to < e.target.value) setTo(e.target.value);
              }}
            />
          </label>
          <label className="flex flex-col gap-1 font-semibold">
            To
            <input
              type="date"
              className={inputClass}
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 font-semibold">
            Until (each day)
            <input
              type="time"
              className={inputClass}
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
          </label>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1 font-semibold">
            Purpose
            <input
              className={inputClass}
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 font-semibold">
            Car plate (if any)
            <input
              className={`${inputClass} font-mono uppercase`}
              value={plate}
              onChange={(e) => setPlate(e.target.value)}
            />
          </label>
        </div>
        {error && (
          <p className="font-bold text-bad" role="alert">
            {error}
          </p>
        )}
        <Button tone="action" type="submit" disabled={!valid}>
          <Plus className="size-5" /> Create invite
        </Button>
      </form>
    </Card>
  );
}

function HostsCard({ hosts, onChanged }: { hosts: Host[]; onChanged: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [department, setDepartment] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <Card title={`Hosts (${hosts.length})`}>
      <ul className="mb-3 divide-y divide-slate-200" aria-label="Hosts">
        {hosts.map((h) => (
          <li key={h.id} className="flex flex-wrap items-center gap-2 py-2">
            <span className="font-bold">{h.name}</span>
            <span className="text-sm text-muted">
              {[h.department, h.phone].filter(Boolean).join(' · ')}
            </span>
            <Button
              className="ml-auto"
              aria-label={`Remove host ${h.name}`}
              onClick={async () => {
                await api.post(`/api/hosts/${h.id}/active`, { active: false });
                await onChanged();
              }}
            >
              <X className="size-5" /> Remove
            </Button>
          </li>
        ))}
      </ul>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            await api.post('/api/hosts', {
              name: name.trim(),
              department: department.trim() || null,
              phone: phone.trim() || null,
            });
            setName('');
            setDepartment('');
            setPhone('');
            await onChanged();
          } catch (err) {
            setError(errorText(err));
          }
        }}
      >
        <input
          className={`${inputClass} min-w-0 flex-1 basis-40`}
          aria-label="Host name"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className={`${inputClass} min-w-0 flex-1 basis-32`}
          aria-label="Department"
          placeholder="Department"
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
        />
        <input
          className={`${inputClass} min-w-0 flex-1 basis-32`}
          aria-label="Phone or extension"
          placeholder="Phone / ext"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <Button type="submit" disabled={name.trim().length < 2}>
          <Plus className="size-5" /> Add host
        </Button>
        {error && (
          <p className="w-full font-bold text-bad" role="alert">
            {error}
          </p>
        )}
      </form>
    </Card>
  );
}
