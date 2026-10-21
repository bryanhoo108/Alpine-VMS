import { LogOut } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { Me } from '../api';

interface NavItem {
  label: string;
  active: boolean;
  onClick: () => void;
}

/** Full-screen frame: title bar with who is signed in, the clock and sign out. No page scroll. */
export function Shell({
  title,
  me,
  onLogout,
  nav,
  children,
}: {
  title: string;
  me: Me;
  onLogout: () => void;
  /** Screen switcher for roles that use more than one screen (supervisor). */
  nav?: NavItem[];
  children: ReactNode;
}) {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center gap-3 bg-ink px-4 text-white">
        <h1 className="text-2xl font-extrabold">{title}</h1>
        {nav && (
          <div className="flex gap-1">
            {nav.map((n) => (
              <button
                key={n.label}
                type="button"
                onClick={n.onClick}
                aria-pressed={n.active}
                className={`min-h-11 rounded-lg px-3 font-bold ${n.active ? 'bg-white text-ink' : 'text-white/80 active:bg-slate-700'}`}
              >
                {n.label}
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto truncate text-lg">{me.displayName}</div>
        <div className="font-mono text-lg tabular-nums max-sm:hidden">
          {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
        <button
          type="button"
          aria-label="Sign out"
          onClick={onLogout}
          className="flex size-11 items-center justify-center rounded-lg active:bg-slate-700"
        >
          <LogOut className="size-7" />
        </button>
      </header>
      <main className="min-h-0 flex-1 p-3">{children}</main>
    </div>
  );
}
