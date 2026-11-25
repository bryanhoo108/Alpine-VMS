/**
 * Simulated CWIS weighbridge PC (mock only, for demos and training).
 * Shows what CWIS received from the VMS when the guard gave out a gate pass,
 * and the operator scanning that pass to weigh in and out. The real CWIS has
 * its own screens; the VMS only pushes pending trucks and reads tickets.
 */
import { ArrowDownToLine, ArrowUpFromLine, MonitorCog, Scale, Truck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../api';
import { QrScanner } from '../components/QrScanner';
import { useCardReader } from '../hooks/useCardReader';
import { passFromQr } from '../pass';

interface Pending {
  tripNo: string;
  cardNo: string | null;
  plate: string;
  transporterName: string | null;
  driverName: string | null;
  sdoNos: string[];
  receivedAt: string;
}
interface Ticket {
  ticketNo: string;
  plate: string;
  sdoNos: string[];
  transporterName: string | null;
  vmsTripNo: string | null;
  weighInAt: string | null;
  weighOutAt: string | null;
  inKg: number | null;
  outKg: number | null;
}
interface State {
  pending: Pending[];
  tickets: Ticket[];
}

const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '–';
const kg = (n: number | null) => (n == null ? '–' : n.toLocaleString('en-MY'));
const plateText = (p: string) => p.replace(/^([A-Z]+)(\d)/, '$1 $2');
const NEW_MS = 15_000;

export function CwisSim() {
  const [state, setState] = useState<State>({ pending: [], tickets: [] });
  const [scale, setScale] = useState(0);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  const busy = useRef(false);

  const load = () => api.get<State>('/api/dev/cwis/state').then(setState);
  useEffect(() => {
    void load();
    const t = setInterval(() => {
      setNow(Date.now());
      void load().catch(() => undefined);
    }, 1500);
    return () => clearInterval(t);
  }, []);

  /** The scale display counts up to the new reading, like the real indicator. */
  const showWeight = (target: number) => {
    const start = performance.now();
    const step = (t: number) => {
      const f = Math.min(1, (t - start) / 1200);
      setScale(Math.round((target * (1 - (1 - f) ** 3)) / 20) * 20);
      if (f < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const scan = async (cardNo: string) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await api.post<{ action: 'in' | 'out'; ticket: Ticket }>('/api/dev/cwis/scan', {
        cardNo,
      });
      const fresh = await api.get<State>('/api/dev/cwis/state');
      setState(fresh);
      const t = fresh.tickets.find((x) => x.ticketNo === r.ticket.ticketNo);
      const w = r.action === 'in' ? t?.inKg : t?.outKg;
      if (w) showWeight(w);
      setMessage({
        tone: 'ok',
        text: `${r.ticket.ticketNo} · ${plateText(r.ticket.plate)} · weighed ${r.action}`,
      });
    } catch (e) {
      setMessage({
        tone: 'bad',
        text:
          e instanceof ApiError && e.code === 'CARD_NOT_ON_TRIP'
            ? 'Pass not on a truck'
            : 'Not saved',
      });
    } finally {
      busy.current = false;
    }
  };
  useCardReader(true, (c) => void scan(c));

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-[#c9d1dc] text-[15px] text-slate-900"
      data-testid="cwis-sim"
    >
      {/* Window title bar: this is the weighbridge PC, not the VMS. */}
      <div className="flex items-center gap-2 bg-gradient-to-r from-[#1f3b63] to-[#3a6aa6] px-3 py-1.5 text-white">
        <MonitorCog className="size-5" aria-hidden />
        <span className="whitespace-nowrap font-bold">CWIS Weighbridge</span>
        <span className="truncate text-sm opacity-80 max-sm:hidden">
          · simulated for the demo · real CWIS unchanged
        </span>
      </div>

      <div className="grid min-h-0 flex-1 gap-2 overflow-auto p-2 lg:grid-cols-[1fr_300px] lg:grid-rows-[auto_1fr_1fr]">
        {/* Scale indicator */}
        <div className="flex items-center gap-4 rounded border border-slate-500 bg-[#0d1a12] px-4 py-2 lg:col-span-1">
          <Scale className="size-8 text-emerald-300" aria-hidden />
          <span
            data-testid="cwis-scale"
            className="font-mono text-5xl font-bold tabular-nums tracking-wider text-emerald-300 max-sm:text-4xl"
          >
            {kg(scale)}
          </span>
          <span className="font-mono text-2xl text-emerald-300/70">kg</span>
          {message && (
            <span
              role="status"
              className={`ml-auto rounded px-3 py-1 font-semibold ${message.tone === 'ok' ? 'bg-emerald-200 text-emerald-900' : 'bg-red-200 text-red-900'}`}
            >
              {message.text}
            </span>
          )}
        </div>

        {/* Pass scanner */}
        <div className="flex min-h-56 flex-col gap-1 rounded border border-slate-500 bg-white p-2 lg:row-span-3">
          <div className="font-bold">Gate pass reader</div>
          <div className="min-h-0 flex-1">
            <QrScanner
              label="Scan pass"
              onCode={(text) => {
                const no = passFromQr(text);
                if (no) void scan(no);
                else setMessage({ tone: 'bad', text: 'Not a gate pass' });
              }}
            />
          </div>
          <p className="text-sm text-slate-600">
            Scan the driver&apos;s pass: first scan weighs in, second scan weighs out. Plate,
            transporter, driver and SDO come from the VMS. No typing.
          </p>
        </div>

        {/* Pending trucks pushed by the VMS */}
        <section className="flex min-h-0 flex-col rounded border border-slate-500 bg-white">
          <h2 className="flex items-center gap-2 border-b border-slate-400 bg-[#e4e9f0] px-2 py-1 font-bold">
            <ArrowDownToLine className="size-4" aria-hidden /> Received from VMS · waiting to weigh
            in
            <span className="ml-auto rounded bg-[#1f3b63] px-2 text-sm text-white">
              {state.pending.length}
            </span>
          </h2>
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full text-left" aria-label="Received from VMS">
              <thead className="sticky top-0 bg-[#f1f4f8] text-sm text-slate-600">
                <tr>
                  <th className="px-2 py-1">Received</th>
                  <th className="px-2 py-1">Plate</th>
                  <th className="px-2 py-1">Pass</th>
                  <th className="px-2 py-1 max-sm:hidden">Transporter</th>
                  <th className="px-2 py-1 max-sm:hidden">Driver</th>
                  <th className="px-2 py-1">SDO</th>
                  <th className="px-2 py-1 max-md:hidden">VMS trip</th>
                </tr>
              </thead>
              <tbody>
                {state.pending.map((p) => {
                  const isNew = now - new Date(p.receivedAt).getTime() < NEW_MS;
                  return (
                    <tr
                      key={p.tripNo}
                      data-testid={`cwis-pending-${p.tripNo}`}
                      className={`border-t border-slate-200 ${isNew ? 'animate-pulse bg-yellow-100' : ''}`}
                    >
                      <td className="px-2 py-1 tabular-nums">
                        {time(p.receivedAt)}
                        {isNew && (
                          <span className="ml-1 rounded bg-yellow-400 px-1 text-xs font-bold">
                            NEW
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1 font-mono font-bold">{plateText(p.plate)}</td>
                      <td className="px-2 py-1 font-mono">{p.cardNo ?? '–'}</td>
                      <td className="px-2 py-1 max-sm:hidden">{p.transporterName ?? '–'}</td>
                      <td className="px-2 py-1 max-sm:hidden">{p.driverName ?? '–'}</td>
                      <td className="px-2 py-1">{p.sdoNos.join(', ') || '–'}</td>
                      <td className="px-2 py-1 font-mono max-md:hidden">{p.tripNo}</td>
                    </tr>
                  );
                })}
                {state.pending.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-2 py-3 text-slate-500">
                      Nothing waiting. Trucks appear here when the guard gives out a gate pass.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Tickets */}
        <section className="flex min-h-0 flex-col rounded border border-slate-500 bg-white">
          <h2 className="flex items-center gap-2 border-b border-slate-400 bg-[#e4e9f0] px-2 py-1 font-bold">
            <Truck className="size-4" aria-hidden /> Weighing tickets
          </h2>
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full text-left" aria-label="Weighing tickets">
              <thead className="sticky top-0 bg-[#f1f4f8] text-sm text-slate-600">
                <tr>
                  <th className="px-2 py-1">Ticket</th>
                  <th className="px-2 py-1">Plate</th>
                  <th className="px-2 py-1 max-sm:hidden">SDO</th>
                  <th className="px-2 py-1 max-md:hidden">VMS trip</th>
                  <th className="px-2 py-1 text-right">In</th>
                  <th className="px-2 py-1 text-right">Out</th>
                  <th className="px-2 py-1 text-right max-sm:hidden">Net kg</th>
                </tr>
              </thead>
              <tbody>
                {state.tickets.map((t) => (
                  <tr
                    key={t.ticketNo}
                    data-testid={`cwis-ticket-${t.ticketNo}`}
                    className="border-t border-slate-200"
                  >
                    <td className="px-2 py-1 font-mono font-bold">{t.ticketNo}</td>
                    <td className="px-2 py-1 font-mono">{plateText(t.plate)}</td>
                    <td className="px-2 py-1 max-sm:hidden">{t.sdoNos.join(', ') || '–'}</td>
                    <td className="px-2 py-1 font-mono max-md:hidden">{t.vmsTripNo ?? '–'}</td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {time(t.weighInAt)} · {kg(t.inKg)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {t.weighOutAt ? (
                        `${time(t.weighOutAt)} · ${kg(t.outKg)}`
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-700">
                          <ArrowUpFromLine className="size-4" aria-hidden /> on site
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums max-sm:hidden">
                      {t.inKg != null && t.outKg != null ? kg(Math.abs(t.outKg - t.inKg)) : '–'}
                    </td>
                  </tr>
                ))}
                {state.tickets.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-2 py-3 text-slate-500">
                      No tickets yet today.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
