/**
 * QR gate passes (decision G1): stock count, and a sheet to print and laminate.
 * Each pass shows its QR and its number; the QR holds only the pass number.
 */
import { Printer, QrCode, X } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { passQrText } from '../../pass';
import { Button, Card } from './ui';

interface Pass {
  cardNo: string;
  status: 'free' | 'issued' | 'lost';
}

export function GatePassesCard() {
  const [passes, setPasses] = useState<Pass[]>([]);
  const [sheet, setSheet] = useState(false);
  useEffect(() => {
    void api.get<Pass[]>('/api/cards').then(setPasses);
  }, []);
  const count = (s: Pass['status']) => passes.filter((p) => p.status === s).length;

  return (
    <Card
      title="Gate passes"
      actions={
        <Button onClick={() => setSheet(true)} disabled={passes.length === 0}>
          <Printer className="size-5" /> Print sheet
        </Button>
      }
    >
      <p className="text-lg" data-testid="pass-stock">
        <b>{count('free')}</b> free · <b>{count('issued')}</b> in use · <b>{count('lost')}</b> lost
      </p>
      <p className="mt-1 text-sm text-muted">
        Print, laminate and keep at the guardhouse. The guard gives one to each truck or visitor
        group and scans it in and out.
      </p>
      {sheet && <PassSheet passes={passes} onClose={() => setSheet(false)} />}
    </Card>
  );
}

/** Printable sheet: credit-card size passes, 10 to an A4 page. */
function PassSheet({ passes, onClose }: { passes: Pass[]; onClose: () => void }) {
  const [qrs, setQrs] = useState<Record<string, string>>({});
  const printable = passes.filter((p) => p.status !== 'lost');
  useEffect(() => {
    let live = true;
    void Promise.all(
      printable.map(
        async (p) =>
          [
            p.cardNo,
            await QRCode.toDataURL(passQrText(p.cardNo), { width: 240, margin: 1 }),
          ] as const,
      ),
    ).then((list) => live && setQrs(Object.fromEntries(list)));
    return () => {
      live = false;
    };
  }, [passes]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      className="fixed inset-0 z-50 overflow-auto bg-slate-200 print:static print:bg-white"
      role="dialog"
      aria-label="Gate pass sheet"
    >
      <style>
        {
          '@media print { body * { visibility: hidden } [data-print], [data-print] * { visibility: visible } [data-print] { position: absolute; inset: 0 } }'
        }
      </style>
      <div className="sticky top-0 flex items-center gap-3 bg-ink px-4 py-3 text-white print:hidden">
        <QrCode className="size-6" />
        <span className="text-lg font-bold">{printable.length} gate passes</span>
        <button
          type="button"
          onClick={() => window.print()}
          className="ml-auto flex min-h-11 items-center gap-2 rounded-lg bg-white px-4 font-bold text-ink"
        >
          <Printer className="size-5" /> Print
        </button>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="flex size-11 items-center justify-center rounded-lg active:bg-slate-700"
        >
          <X className="size-6" />
        </button>
      </div>
      <div
        data-print
        className="mx-auto grid max-w-[210mm] grid-cols-1 gap-[6mm] bg-white p-[6mm] sm:grid-cols-2 print:grid-cols-2 print:p-[8mm]"
      >
        {printable.map((p) => (
          <div
            key={p.cardNo}
            data-testid="gate-pass"
            className="flex h-[54mm] items-center gap-[4mm] rounded-[3mm] border-2 border-ink p-[3mm]"
          >
            {qrs[p.cardNo] ? (
              <img
                src={qrs[p.cardNo]}
                alt={`QR for gate pass ${p.cardNo}`}
                className="h-[44mm] w-[44mm]"
              />
            ) : (
              <div className="h-[44mm] w-[44mm] bg-slate-100" />
            )}
            <div className="flex min-w-0 flex-col gap-[2mm]">
              <span className="text-[3.2mm] font-bold uppercase tracking-wider text-muted">
                Alpine Pipe · Gate pass
              </span>
              <span className="font-mono text-[9mm] font-black leading-none">{p.cardNo}</span>
              <span className="text-[3mm] leading-snug">Return to the guard when you leave.</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
