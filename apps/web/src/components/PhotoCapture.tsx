import { Camera, Loader2, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export interface PhotoBadge {
  icon: LucideIcon;
  count: number;
  testId: string;
}

interface Props {
  /** What the next shot is for, e.g. "IC", "Documents", "Load". */
  label: string;
  icon: LucideIcon;
  badges: PhotoBadge[];
  onPhoto: (blob: Blob) => void;
  /** Show a card-shaped outline: the IC read works best when the card fills it. */
  cardGuide?: boolean;
}

/**
 * One camera session: the live view stays open and each shutter tap takes
 * one photo. Falls back to the device camera app when live view is not
 * available. The shutter waits until frames arrive so no tap is lost.
 */
export function PhotoCapture({ label, icon: Icon, badges, onPhoto, cardGuide = false }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [live, setLive] = useState<'starting' | 'on' | 'off'>('starting');
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    if (!navigator.mediaDevices) {
      setLive('off');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1600 } }, audio: false })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        const v = video.current;
        if (!v) return;
        v.onplaying = () => setLive('on');
        v.srcObject = s;
        void v.play().catch(() => setLive('off'));
      })
      .catch(() => setLive('off'));
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
    canvas.toBlob((blob) => blob && onPhoto(blob), 'image/jpeg', 0.85);
    setFlash(true);
    setTimeout(() => setFlash(false), 150);
  };

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
        {cardGuide && live === 'on' && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2">
            <div
              data-testid="card-guide"
              className="aspect-[85.6/54] max-h-[75%] w-4/5 max-w-full rounded-2xl border-4 border-dashed border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]"
            />
            <div className="rounded-lg bg-ink/70 px-3 py-1 text-xl font-bold text-white">
              IC in box
            </div>
          </div>
        )}
        {flash && <div className="absolute inset-0 bg-white/70" />}
        <div className="absolute left-3 top-3 flex items-center gap-2 rounded-xl bg-ink/80 px-4 py-2 text-2xl font-bold text-white">
          <Icon className="size-8" /> {label}
        </div>
        <div className="absolute right-3 top-3 flex gap-2 text-xl font-bold">
          {badges.map((b) => (
            <span
              key={b.testId}
              data-testid={b.testId}
              className={`flex items-center gap-1 rounded-lg px-3 py-1 ${b.count ? 'bg-ok text-white' : 'bg-white/80'}`}
            >
              <b.icon className="size-6" /> {b.count}
            </span>
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={shoot}
        disabled={live === 'starting'}
        className="flex min-h-24 items-center justify-center gap-3 rounded-2xl bg-action text-3xl font-bold text-white active:bg-blue-900 disabled:opacity-50 portrait:min-h-20"
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
          if (file) onPhoto(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}
