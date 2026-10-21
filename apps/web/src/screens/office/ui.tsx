import type { ButtonHTMLAttributes, ReactNode } from 'react';

/** Small building blocks for the office (PC) screens. */
export function Card({
  title,
  actions,
  children,
}: {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-panel p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-xl font-extrabold">{title}</h3>
        <div className="ml-auto flex flex-wrap gap-2">{actions}</div>
      </div>
      {children}
    </section>
  );
}

const CHIP = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
  info: 'bg-blue-100 text-blue-800',
  off: 'bg-slate-100 text-slate-500',
} as const;

export function Chip({ tone, children }: { tone: keyof typeof CHIP; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-sm font-bold ${CHIP[tone]}`}
    >
      {children}
    </span>
  );
}

export function Button({
  children,
  tone = 'plain',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'plain' | 'action' | 'danger' }) {
  const tones = {
    plain: 'border-2 border-slate-300 bg-panel active:bg-slate-100',
    action: 'bg-action text-white active:bg-blue-900',
    danger: 'border-2 border-bad text-bad bg-panel active:bg-bad-soft',
  };
  return (
    <button
      type="button"
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 font-bold disabled:opacity-40 ${tones[tone]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export const inputClass = 'min-h-11 rounded-lg border-2 border-slate-300 bg-white px-3 text-lg';

/** Ask for a reason before an action (clear alert, clear pre-registration). */
export function ReasonForm({
  label,
  onSubmit,
  onCancel,
}: {
  label: string;
  onSubmit: (reason: string) => void;
  onCancel: () => void;
}) {
  return (
    <form
      className="flex flex-wrap gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const reason = String(new FormData(e.currentTarget).get('reason') ?? '').trim();
        if (reason.length >= 2) onSubmit(reason);
      }}
    >
      <input
        name="reason"
        autoFocus
        required
        minLength={2}
        placeholder="Reason"
        aria-label="Reason"
        className={`${inputClass} min-w-0 flex-1`}
      />
      <Button type="submit" tone="action">
        {label}
      </Button>
      <Button onClick={onCancel}>Cancel</Button>
    </form>
  );
}
