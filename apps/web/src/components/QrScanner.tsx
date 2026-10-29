import jsQR from 'jsqr';
import { Camera, QrCode } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (opts: { formats: string[] }) => BarcodeDetectorLike;
  }
}

/**
 * Live camera that reads QR codes, offline: the browser's own barcode reader
 * where there is one (Chrome on Android), else the bundled jsQR decoder.
 * Calls onCode once per new code; the parent decides what it means.
 */
export function QrScanner({ onCode }: { onCode: (text: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [live, setLive] = useState<'starting' | 'on' | 'off'>('starting');
  const last = useRef<string | null>(null);
  const handler = useRef(onCode);
  handler.current = onCode;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const detector = window.BarcodeDetector
      ? new window.BarcodeDetector({ formats: ['qr_code'] })
      : null;
    const canvas = document.createElement('canvas');

    const scan = async () => {
      const v = video.current;
      if (stopped || !v) return;
      if (v.videoWidth > 0) {
        let text: string | null = null;
        try {
          if (detector) {
            text = (await detector.detect(v))[0]?.rawValue ?? null;
          } else {
            // Scale down: QR codes held up to the tablet are large in the frame.
            const scale = Math.min(1, 640 / v.videoWidth);
            canvas.width = Math.round(v.videoWidth * scale);
            canvas.height = Math.round(v.videoHeight * scale);
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx?.drawImage(v, 0, 0, canvas.width, canvas.height);
            const img = ctx?.getImageData(0, 0, canvas.width, canvas.height);
            text = img ? (jsQR(img.data, img.width, img.height)?.data ?? null) : null;
          }
        } catch {
          text = null;
        }
        if (text && text !== last.current) {
          last.current = text;
          handler.current(text);
        }
      }
      timer = setTimeout(() => void scan(), 250);
    };

    if (!navigator.mediaDevices) {
      setLive('off');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        const v = video.current;
        if (!v) return;
        v.onplaying = () => {
          setLive('on');
          void scan();
        };
        v.srcObject = s;
        void v.play().catch(() => setLive('off'));
      })
      .catch(() => setLive('off'));
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="relative h-full min-h-0 overflow-hidden rounded-2xl bg-slate-800">
      <video
        ref={video}
        muted
        playsInline
        className={`h-full w-full object-cover ${live === 'on' ? '' : 'invisible absolute'}`}
      />
      {live !== 'on' && (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-300">
          <Camera className="size-20" />
          {live === 'off' && <span className="text-2xl font-bold">No camera</span>}
        </div>
      )}
      {/* Aiming square */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="aspect-square h-3/5 rounded-3xl border-8 border-white/80" />
      </div>
      <div className="absolute left-3 top-3 flex items-center gap-2 rounded-xl bg-ink/80 px-4 py-2 text-2xl font-bold text-white">
        <QrCode className="size-8" /> Show QR
      </div>
    </div>
  );
}
