import { Camera, Pencil } from 'lucide-react';
import { photoUrl } from '../api';
import { formatPlate } from '../plate';

interface Props {
  plate: string;
  photoId: string | null;
  /** Camera confidence 0..1; low reads are marked for the guard to look at. */
  confidence: number | null;
  onEdit?: () => void;
}

/** Camera photo beside the plate text, so the guard can compare at a glance. */
export function PlateCard({ plate, photoId, confidence, onEdit }: Props) {
  const low = confidence !== null && confidence < 0.8;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 rounded-2xl bg-panel p-3 shadow-sm">
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-slate-700">
        {photoId ? (
          <img
            src={photoUrl(photoId)}
            alt="Camera photo"
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-slate-300">
            <Camera className="size-16" />
          </div>
        )}
      </div>
      <div className="flex items-center gap-3">
        <div
          data-testid="plate-text"
          className={`min-w-0 flex-1 whitespace-nowrap rounded-xl border-4 bg-ink px-3 py-2 text-center font-mono text-5xl font-black tracking-wider text-white portrait:text-4xl ${low ? 'border-warn' : 'border-slate-300'}`}
        >
          {formatPlate(plate)}
        </div>
        {onEdit && (
          <button
            type="button"
            aria-label="Change plate"
            onClick={onEdit}
            className="flex size-20 shrink-0 items-center justify-center rounded-xl border-2 border-slate-300 bg-panel active:bg-slate-100"
          >
            <Pencil className="size-9" />
          </button>
        )}
      </div>
    </div>
  );
}
