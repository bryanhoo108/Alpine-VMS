import { AlertTriangle, CheckCircle2, PhoneCall } from 'lucide-react';
import type { Alert } from '../api';

/** Colour bar: red = call supervisor, amber = check. Logged-only alerts are not shown. */
export function StatusBanner({ alerts }: { alerts: Alert[] }) {
  const shown = alerts.filter((a) => a.level !== 'logged');
  if (shown.length === 0) return null;
  const red = shown.some((a) => a.level === 'red');
  return (
    <div
      role="alert"
      data-level={red ? 'red' : 'amber'}
      className={`flex items-center gap-4 rounded-2xl px-5 py-3 text-white ${red ? 'bg-bad' : 'bg-warn'}`}
    >
      {red ? (
        <PhoneCall className="size-10 shrink-0" />
      ) : (
        <AlertTriangle className="size-10 shrink-0" />
      )}
      <div className="min-w-0">
        <div className="text-2xl font-extrabold">{red ? 'Call supervisor' : 'Check'}</div>
        <div className="truncate text-xl font-semibold">
          {shown.map((a) => a.label).join(' · ')}
        </div>
      </div>
    </div>
  );
}

export function OkBanner({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl bg-ok px-5 py-3 text-white">
      <CheckCircle2 className="size-10 shrink-0" />
      <div className="text-2xl font-extrabold">{text}</div>
    </div>
  );
}
