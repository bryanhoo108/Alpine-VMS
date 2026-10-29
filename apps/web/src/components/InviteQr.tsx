/**
 * An invite's QR code, with the two ways to send it (decision V2):
 * "Share on WhatsApp" opens the sender's own WhatsApp (no Business API), and
 * "Copy QR" puts the image on the clipboard to paste anywhere. Both work from
 * the office PC or a phone; the gate itself never needs the internet.
 */
import { Copy, Download, MessageCircle } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import type { Invite } from '../api';

const SITE_NAME = 'Alpine Pipe Manufacturing, Shah Alam';

/** "DEMV2345" → "DEMV 2345": easier to read out over the phone. */
export const spacedCode = (code: string) => `${code.slice(0, 4)} ${code.slice(4)}`;

const dateText = (inv: Invite) =>
  inv.validFrom === inv.validTo ? inv.validFrom : `${inv.validFrom} to ${inv.validTo}`;

export function inviteMessage(inv: Invite): string {
  return [
    `Hello ${inv.name}, you are invited to ${SITE_NAME} on ${dateText(inv)}` +
      (inv.untilTime ? ` (until ${inv.untilTime})` : '') +
      '.',
    inv.host
      ? `Host: ${inv.host.name}${inv.host.department ? `, ${inv.host.department}` : ''}.`
      : '',
    inv.groupSize > 1 ? `Group of ${inv.groupSize} people; one person registers for all.` : '',
    `At the gate, show the QR code or give the guard the code ${spacedCode(inv.code)}.`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Malaysian mobile "012-345 6789" → "60123456789" for wa.me; '' when unknown. */
export function whatsappNumber(phone: string | null): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.startsWith('60')) return digits;
  if (digits.startsWith('0')) return `6${digits}`;
  return digits;
}

async function pngBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob();
}

function download(dataUrl: string, name: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = name;
  a.click();
}

export function InviteQr({ invite }: { invite: Invite }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const fileName = `invite-${invite.code}.png`;

  useEffect(() => {
    let live = true;
    QRCode.toDataURL(invite.qrText, { width: 480, margin: 2, errorCorrectionLevel: 'M' }).then(
      (url) => live && setDataUrl(url),
    );
    return () => {
      live = false;
    };
  }, [invite.qrText]);

  const share = async () => {
    setNote(null);
    const text = inviteMessage(invite);
    // Phones: share the QR image and text straight into WhatsApp.
    if (dataUrl && 'canShare' in navigator) {
      const file = new File([await pngBlob(dataUrl)], fileName, { type: 'image/png' });
      if (navigator.canShare({ files: [file], text })) {
        try {
          await navigator.share({ files: [file], text });
          return;
        } catch {
          // Cancelled or refused: fall back to the WhatsApp link.
        }
      }
    }
    const to = whatsappNumber(invite.phone);
    window.open(`https://wa.me/${to}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    setNote(
      'WhatsApp opened with the message. Paste the QR with "Copy QR" if you want the image too.',
    );
  };

  const copy = async () => {
    if (!dataUrl) return;
    setNote(null);
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob(dataUrl) })]);
      setNote('QR copied. Paste it into WhatsApp, email or a document.');
    } catch {
      // Clipboard images need HTTPS and a recent browser: save the file instead.
      download(dataUrl, fileName);
      setNote(`This browser cannot copy images, so the QR was saved as ${fileName}.`);
    }
  };

  return (
    <div className="flex flex-wrap items-start gap-4" data-testid="invite-qr">
      <div className="flex flex-col items-center gap-1">
        {dataUrl ? (
          <img
            src={dataUrl}
            alt={`QR code for invite ${invite.code}`}
            className="size-44 rounded-lg border-2 border-slate-200 bg-white"
          />
        ) : (
          <div className="size-44 rounded-lg bg-slate-100" />
        )}
        <span className="font-mono text-xl font-black tracking-widest" aria-label="Invite code">
          {spacedCode(invite.code)}
        </span>
      </div>
      <div className="flex min-w-64 flex-1 flex-col gap-2">
        <pre className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-2 font-sans text-sm text-muted">
          {inviteMessage(invite)}
        </pre>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void share()}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-ok px-4 font-bold text-white"
          >
            <MessageCircle className="size-5" /> Share on WhatsApp
          </button>
          <button
            type="button"
            onClick={() => void copy()}
            disabled={!dataUrl}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border-2 border-slate-300 bg-panel px-4 font-bold"
          >
            <Copy className="size-5" /> Copy QR
          </button>
          <button
            type="button"
            onClick={() => dataUrl && download(dataUrl, fileName)}
            disabled={!dataUrl}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border-2 border-slate-300 bg-panel px-4 font-bold"
          >
            <Download className="size-5" /> Save QR
          </button>
        </div>
        {note && (
          <p className="text-sm font-semibold text-blue-800" role="status">
            {note}
          </p>
        )}
      </div>
    </div>
  );
}
