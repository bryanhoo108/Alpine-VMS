import { Camera, FileText, IdCard, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export type PhotoStep = 'ic' | 'document';

interface Props {
  step: PhotoStep;
  count: { ic: number; document: number };
  onPhoto: (kind: PhotoStep, blob: Blob) => void;
}

/**
 * One camera session for all photos: the live view stays open, each shutter
 * tap takes one photo. First shot is the IC, then documents.
 * Falls back to the device camera app when live view is not available.
 */
export function PhotoCapture({ step, count, onPhoto }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [live, setLive] = useState<'starting' | 'on' | 'off'>('starting');
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1600 } }, audio: false })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        const v = video.current;
        if (!v) return;
        // Ready only once frames arrive; a shutter tap before that would be lost.
        v.onplaying = () => setLive('on');
        v.srcObject = s;
        void v.play().catch(() => setLive('off'));
      })
      .catch(() => setLive('off'));
    if (!navigator.mediaDevices) setLive('off');
    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const shoot = () => {
    if (live === 'starting') return;
    if (live === 'off') return fileInput.current?.click();
    const v = video.current;
    if (!v || v.videoWidth === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d')?.drawImage(v, 0, 0);
    canvas.toBlob((blob) => blob && onPhoto(step, blob), 'image/jpeg', 0.85);
    setFlash(true);
    setTimeout(() => setFlash(false), 150);
  };

  const StepIcon = step === 'ic' ? IdCard : FileText;
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl bg-slate-800">
        <video
          ref={video}
          muted
          playsInline
          className={`h-full w-full object-cover ${live === 'on' ? '' : 'invisible absolute'}`}
        />
        {live !== 'on' && (
          <div className="flex h-full items-center justify-center text-slate-300">
            <Camera className="size-20" />
          </div>
        )}
        {flash && <div className="absolute inset-0 bg-white/70" />}
        <div className="absolute left-3 top-3 flex items-center gap-2 rounded-xl bg-ink/80 px-4 py-2 text-2xl font-bold text-white">
          <StepIcon className="size-8" /> {step === 'ic' ? 'IC' : 'Documents'}
        </div>
        <div className="absolute right-3 top-3 flex gap-2 text-xl font-bold">
          <span
            data-testid="count-ic"
            className={`flex items-center gap-1 rounded-lg px-3 py-1 ${count.ic ? 'bg-ok text-white' : 'bg-white/80'}`}
          >
            <IdCard className="size-6" /> {count.ic}
          </span>
          <span
            data-testid="count-doc"
            className={`flex items-center gap-1 rounded-lg px-3 py-1 ${count.document ? 'bg-ok text-white' : 'bg-white/80'}`}
          >
            <FileText className="size-6" /> {count.document}
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={shoot}
        disabled={live === 'starting'}
        className="flex min-h-24 items-center justify-center gap-3 rounded-2xl bg-action text-3xl font-bold text-white active:bg-blue-900 disabled:opacity-50"
      >
        {live === 'starting' ? (
          <Loader2 className="size-12 animate-spin" strokeWidth={2.5} />
        ) : (
          <Camera className="size-12" strokeWidth={2.5} />
        )}
        Photo
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPhoto(step, file);
          e.target.value = '';
        }}
      />
    </div>
  );
}
