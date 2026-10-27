import { useState } from 'react';
import { api, ApiError, type OfficeAlert } from '../../api';
import { dateTimeOf } from '../../format';
import { formatPlate } from '../../plate';
import { Button, Card, Chip, ReasonForm } from './ui';

/** Open amber and red alerts, red first. Clearing needs a reason (audit trail). */
export function AlertsTab({
  alerts,
  onChanged,
}: {
  alerts: OfficeAlert[];
  onChanged: () => Promise<void>;
}) {
  const [clearing, setClearing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="h-full overflow-y-auto">
      <Card title="Open alerts">
        {error && (
          <p className="mb-2 font-bold text-bad" role="alert">
            {error}
          </p>
        )}
        {alerts.length === 0 && <p className="text-muted">No open alerts.</p>}
        <ul className="divide-y divide-slate-200" aria-label="Open alerts">
          {alerts.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 py-2">
              <Chip tone={a.level === 'red' ? 'bad' : 'warn'}>{a.label}</Chip>
              {a.plate && (
                <span className="font-mono text-lg font-black">{formatPlate(a.plate)}</span>
              )}
              {a.tripNo && <span className="text-muted">{a.tripNo}</span>}
              <span className="text-sm text-muted">{dateTimeOf(a.raisedAt)}</span>
              {a.detail && (
                <span className="text-sm text-muted">
                  {Object.entries(a.detail)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(' · ')}
                </span>
              )}
              {clearing === a.id ? (
                <div className="w-full">
                  <ReasonForm
                    label="Clear"
                    onCancel={() => setClearing(null)}
                    onSubmit={async (reason) => {
                      try {
                        await api.post(`/api/alerts/${a.id}/clear`, { reason });
                        setClearing(null);
                        await onChanged();
                      } catch (e) {
                        setError(e instanceof ApiError ? e.code : 'ERROR');
                      }
                    }}
                  />
                </div>
              ) : (
                <Button className="ml-auto" onClick={() => setClearing(a.id)}>
                  Clear
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
