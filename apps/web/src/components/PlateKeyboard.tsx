import { Check, Delete, X } from 'lucide-react';
import { useState } from 'react';
import { formatPlate, normalizePlate } from '../plate';

const ROWS = ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
/** Phones are too narrow for 10 keys a row at touch size: use 6 rows of 6 instead. */
const GRID = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';

/** On-screen keyboard for correcting a plate: the only typing a guard does. */
export function PlateKeyboard({
  initial,
  onDone,
  onCancel,
}: {
  initial: string;
  onDone: (plate: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(normalizePlate(initial));
  // Background is set per key so colours never clash.
  const key =
    'flex h-full min-w-0 flex-1 items-center justify-center rounded-lg text-2xl font-bold shadow-sm';
  const letter = `${key} bg-panel active:bg-slate-200`;
  const control = `${key} bg-slate-300 active:bg-slate-400`;
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-2">
        <div
          data-testid="plate-input"
          className="min-h-16 flex-1 rounded-xl border-4 border-slate-300 bg-ink px-4 py-2 text-center font-mono text-4xl font-black text-white"
        >
          {formatPlate(value) || ' '}
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-6 gap-1.5 landscape:hidden">
        {[...GRID].map((c) => (
          <button
            key={c}
            type="button"
            className={letter}
            onClick={() => setValue((v) => (v + c).slice(0, 12))}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 portrait:flex-none">
        {ROWS.map((row) => (
          <div key={row} className="flex min-h-0 flex-1 gap-1.5 portrait:hidden">
            {[...row].map((c) => (
              <button
                key={c}
                type="button"
                className={letter}
                onClick={() => setValue((v) => (v + c).slice(0, 12))}
              >
                {c}
              </button>
            ))}
          </div>
        ))}
        <div className="flex min-h-0 flex-1 gap-1.5 portrait:min-h-16">
          <button type="button" aria-label="Cancel" className={control} onClick={onCancel}>
            <X className="size-8" />
          </button>
          <button
            type="button"
            aria-label="Delete"
            className={control}
            onClick={() => setValue((v) => v.slice(0, -1))}
          >
            <Delete className="size-8" />
          </button>
          <button
            type="button"
            aria-label="OK"
            disabled={value.length < 2}
            className={`${key} flex-[2] bg-ok text-white active:bg-green-900 disabled:opacity-40`}
            onClick={() => onDone(value)}
          >
            <Check className="size-9" />
          </button>
        </div>
      </div>
    </div>
  );
}
