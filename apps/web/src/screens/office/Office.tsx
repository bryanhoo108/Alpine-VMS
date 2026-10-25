/**
 * Office screen for the logistics clerk (PC): trucks on site and SDO matching,
 * pre-registrations, and open alerts. Typing is fine here.
 */
import { BellRing, ClipboardList, Truck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type OfficeAlert,
  type OfficeLists,
  type PreRegRow,
  type TripSummary,
} from '../../api';
import { useLiveEvents } from '../../hooks/useLiveEvents';
import { AlertsTab } from './AlertsTab';
import { PreRegTab } from './PreRegTab';
import { TrucksTab } from './TrucksTab';

type Tab = 'trucks' | 'prereg' | 'alerts';

export function Office({ mock }: { mock: boolean }) {
  const [tab, setTab] = useState<Tab>('trucks');
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [preRegs, setPreRegs] = useState<PreRegRow[]>([]);
  const [alerts, setAlerts] = useState<OfficeAlert[]>([]);
  const [lists, setLists] = useState<OfficeLists | null>(null);
  const [tick, setTick] = useState(0);

  const reload = useCallback(async () => {
    const [t, p, a, l] = await Promise.all([
      api.get<TripSummary[]>('/api/clerk/trips'),
      api.get<PreRegRow[]>('/api/clerk/pre-registrations'),
      api.get<OfficeAlert[]>('/api/alerts'),
      api.get<OfficeLists>('/api/clerk/lists'),
    ]);
    setTrips(t);
    setPreRegs(p);
    setAlerts(a);
    setLists(l);
    setTick((n) => n + 1);
  }, []);

  useEffect(() => {
    void reload();
    const id = setInterval(() => void reload(), 30_000);
    return () => clearInterval(id);
  }, [reload]);
  useLiveEvents((e) => {
    if (e.type === 'trip_changed' || e.type === 'alert' || e.type === 'connected') void reload();
  });

  const openPre = preRegs.filter((p) => p.status === 'expected' || p.status === 'late').length;
  const red = alerts.some((a) => a.level === 'red');
  const tabs: { id: Tab; label: string; icon: typeof Truck; count: number; tone?: string }[] = [
    { id: 'trucks', label: 'Trucks on site', icon: Truck, count: trips.length },
    { id: 'prereg', label: 'Pre-registered', icon: ClipboardList, count: openPre },
    {
      id: 'alerts',
      label: 'Alerts',
      icon: BellRing,
      count: alerts.length,
      tone: red ? 'bg-bad' : alerts.length ? 'bg-warn' : undefined,
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <nav className="flex shrink-0 gap-2 overflow-x-auto" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex min-h-12 items-center gap-2 whitespace-nowrap rounded-xl px-4 text-lg font-bold ${tab === t.id ? 'bg-ink text-white' : 'bg-panel text-ink'}`}
          >
            <t.icon className="size-6" />
            <span className="max-sm:sr-only">{t.label}</span>
            <span
              className={`rounded-full px-2 text-base ${t.tone ? `${t.tone} text-white` : tab === t.id ? 'bg-white/20' : 'bg-slate-200'}`}
            >
              {t.count}
            </span>
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1">
        {tab === 'trucks' && (
          <TrucksTab trips={trips} lists={lists} tick={tick} mock={mock} onChanged={reload} />
        )}
        {tab === 'prereg' && <PreRegTab rows={preRegs} lists={lists} onChanged={reload} />}
        {tab === 'alerts' && <AlertsTab alerts={alerts} onChanged={reload} />}
      </div>
    </div>
  );
}
