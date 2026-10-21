import { Check, Delete } from 'lucide-react';
import { useState } from 'react';

/** Number pad for PIN sign-in. */
export function PinPad({ onSubmit, error }: { onSubmit: (pin: string) => void; error: boolean }) {
  const [pin, setPin] = useState('');
  const key = 'flex items-center justify-center rounded-xl text-4xl font-bold shadow-sm';
  const digit = `${key} bg-panel active:bg-slate-200`;
  const press = (d: string) => setPin((p) => (p + d).slice(0, 8));
  return (
    <div className="flex h-full flex-col gap-3">
      <div
        data-testid="pin-dots"
        className={`flex h-16 items-center justify-center gap-3 rounded-xl text-4xl ${error ? 'bg-bad-soft text-bad' : 'bg-slate-100'}`}
      >
        {pin.length > 0 ? (
          '●'.repeat(pin.length)
        ) : (
          <span className={`text-2xl ${error ? 'font-bold' : 'text-muted'}`}>
            {error ? 'Wrong PIN' : 'PIN'}
          </span>
        )}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" className={digit} onClick={() => press(d)}>
            {d}
          </button>
        ))}
        <button
          type="button"
          aria-label="Delete"
          className={`${key} bg-slate-300 active:bg-slate-400`}
          onClick={() => setPin((p) => p.slice(0, -1))}
        >
          <Delete className="size-9" />
        </button>
        <button type="button" className={digit} onClick={() => press('0')}>
          0
        </button>
        <button
          type="button"
          aria-label="OK"
          disabled={pin.length < 4}
          className={`${key} bg-ok text-white active:bg-green-900 disabled:opacity-40`}
          onClick={() => {
            onSubmit(pin);
            setPin('');
          }}
        >
          <Check className="size-10" />
        </button>
      </div>
    </div>
  );
}
