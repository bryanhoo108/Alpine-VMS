import type { LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';

type Tone = 'action' | 'ok' | 'warn' | 'bad' | 'plain';

const TONES: Record<Tone, string> = {
  action: 'bg-action text-white active:bg-blue-900',
  ok: 'bg-ok text-white active:bg-green-900',
  warn: 'bg-warn text-white active:bg-amber-900',
  bad: 'bg-bad text-white active:bg-red-900',
  plain: 'bg-panel text-ink border-2 border-slate-300 active:bg-slate-100',
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  /** 1 to 3 words. */
  label: string;
  tone?: Tone;
  size?: 'lg' | 'md' | 'sm';
}

/** Touch button: icon + 1-3 words, at least 64px tall. */
export function BigButton({
  icon: Icon,
  label,
  tone = 'action',
  size = 'lg',
  className = '',
  ...rest
}: Props) {
  const sizes = {
    lg: 'min-h-28 portrait:min-h-20 text-3xl gap-3 px-6 [&_svg]:size-12',
    md: 'min-h-20 text-2xl gap-3 px-5 [&_svg]:size-9',
    sm: 'min-h-16 text-xl gap-2 px-4 [&_svg]:size-7',
  }[size];
  return (
    <button
      type="button"
      className={`flex items-center justify-center rounded-2xl font-bold shadow-sm transition-transform active:scale-[0.98] disabled:opacity-40 ${sizes} ${TONES[tone]} ${className}`}
      {...rest}
    >
      <Icon aria-hidden strokeWidth={2.5} />
      <span>{label}</span>
    </button>
  );
}
