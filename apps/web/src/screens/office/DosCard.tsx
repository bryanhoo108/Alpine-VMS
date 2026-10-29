import { FlaskConical, Link2, Unlink } from 'lucide-react';
import { api, type TripDetail } from '../../api';
import { dateTimeOf } from '../../format';
import { Button, Card, Chip } from './ui';

const REASON = {
  before_gate_in: 'Made before this truck came in',
  other_truck: 'On another truck',
  unlinked: 'Unlinked by clerk',
  needs_clerk: 'Fits more than one truck: pick',
} as const;

const linesText = (lines: TripDetail['dos']['linked'][number]['lines']) =>
  lines.map((l) => `SDO ${l.sdoNo ?? '–'} · ${l.itemCode} × ${l.pieces}`).join(' | ');

/** The truck's DOs from SAP ("Copy To" from its SDOs), and their SAP update status. */
export function DosCard({
  trip,
  mock,
  readOnly = false,
  act,
}: {
  trip: TripDetail;
  mock: boolean;
  /** Truck has left: show, do not change. */
  readOnly?: boolean;
  act: (fn: () => Promise<unknown>) => void;
}) {
  const { dos } = trip;
  const sdoNos = trip.sdos.map((s) => s.sdoNo);
  return (
    <Card
      title={`DOs (${dos.linked.length})`}
      actions={
        mock &&
        sdoNos.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-purple-50 p-1">
            <FlaskConical className="size-5 text-purple-700" />
            <Button onClick={() => act(() => api.post('/api/dev/sap/create-do', { sdoNos }))}>
              Test DO
            </Button>
            <Button
              onClick={() => act(() => api.post('/api/dev/sap/create-do', { sdoNos, half: true }))}
            >
              Test part DO
            </Button>
          </div>
        )
      }
    >
      {dos.sdosWithoutDo.length > 0 && (
        <p className="mb-2 flex flex-wrap items-center gap-2 font-semibold text-warn">
          <Chip tone="warn">No DO yet</Chip> SDO {dos.sdosWithoutDo.join(', ')}
        </p>
      )}
      {dos.unlinkedSdosOnDos.length > 0 && (
        <p className="mb-2 font-semibold text-blue-800">
          A DO here also carries SDO {dos.unlinkedSdosOnDos.join(', ')}. Link that SDO too?
        </p>
      )}
      <ul className="space-y-2" aria-label="Linked DOs">
        {dos.linked.map((d) => (
          <li
            key={d.doNo}
            className="rounded-xl border-2 border-slate-200 p-3"
            data-testid={`do-${d.doNo}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-black">DO {d.doNo}</span>
              <Chip tone="off">
                {d.source === 'auto' ? 'Found automatically' : 'Linked by clerk'}
              </Chip>
              <SapStatus sap={d.sap} />
              {!readOnly && (
                <Button
                  tone="danger"
                  className="ml-auto"
                  aria-label={`Unlink DO ${d.doNo}`}
                  onClick={() => act(() => api.del(`/api/clerk/trips/${trip.id}/dos/${d.doNo}`))}
                >
                  <Unlink className="size-5" /> Unlink
                </Button>
              )}
            </div>
            <div className="mt-1 text-sm text-muted">
              {dateTimeOf(d.createdAt)} · {linesText(d.lines)}
            </div>
          </li>
        ))}
      </ul>
      {dos.candidates.length > 0 && (
        <>
          <h4 className="mb-1 mt-3 font-bold text-muted">Other DOs for these SDOs</h4>
          <ul className="divide-y divide-slate-200" aria-label="Other DOs">
            {dos.candidates.map((d) => (
              <li key={d.doNo} className="flex flex-wrap items-center gap-2 py-2">
                <span className="font-black">DO {d.doNo}</span>
                <Chip tone={d.reason === 'needs_clerk' ? 'warn' : 'off'}>
                  {REASON[d.reason]}
                  {d.otherTripNo ? ` (${d.otherTripNo})` : ''}
                </Chip>
                <span className="text-sm text-muted">{dateTimeOf(d.createdAt)}</span>
                {!readOnly && (
                  <Button
                    className="ml-auto"
                    disabled={d.reason === 'other_truck'}
                    onClick={() =>
                      act(() => api.post(`/api/clerk/trips/${trip.id}/dos`, { doNo: d.doNo }))
                    }
                  >
                    <Link2 className="size-5" /> Link
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function SapStatus({ sap }: { sap: TripDetail['dos']['linked'][number]['sap'] }) {
  if (!sap) return <Chip tone="off">SAP: nothing to send</Chip>;
  if (sap.status === 'done') return <Chip tone="ok">In SAP</Chip>;
  if (sap.attempts === 0) return <Chip tone="info">SAP: sending</Chip>;
  return (
    <Chip tone="warn">
      SAP: retrying ({sap.attempts}){sap.lastError ? ` · ${sap.lastError}` : ''}
    </Chip>
  );
}
