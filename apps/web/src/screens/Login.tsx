import { ArrowLeft, ClipboardCheck, KeyRound, Shield } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, ApiError, type Me, type Person } from '../api';
import { BigButton } from '../components/BigButton';
import { PinPad } from '../components/PinPad';

/** Guards and checkers: tap your name, enter PIN. Office staff: username and password. */
export function Login({ onLogin }: { onLogin: (me: Me) => void }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [who, setWho] = useState<Person | null>(null);
  const [office, setOffice] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    api
      .get<Person[]>('/api/auth/people')
      .then(setPeople)
      .catch(() => setPeople([]));
  }, []);

  const login = async (username: string, secret: string) => {
    try {
      onLogin(await api.post<Me>('/api/auth/login', { username, secret }));
    } catch (err) {
      setError(err instanceof ApiError);
    }
  };

  if (office) return <OfficeLogin onBack={() => setOffice(false)} onSubmit={login} error={error} />;

  return (
    <div className="flex h-dvh flex-col gap-3 overflow-hidden p-4 landscape:flex-row">
      <section className="flex min-h-0 flex-1 flex-col gap-3">
        <h1 className="text-3xl font-extrabold">Alpine VMS</h1>
        <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-2 gap-3">
          {people.map((p) => (
            <BigButton
              key={p.username}
              size="md"
              icon={p.role === 'guard' ? Shield : ClipboardCheck}
              label={p.displayName}
              tone={who?.username === p.username ? 'action' : 'plain'}
              onClick={() => {
                setWho(p);
                setError(false);
              }}
            />
          ))}
        </div>
        <BigButton
          size="sm"
          tone="plain"
          icon={KeyRound}
          label="Office login"
          onClick={() => setOffice(true)}
        />
      </section>
      <section className="flex min-h-0 flex-1 flex-col">
        {who ? (
          <PinPad error={error} onSubmit={(pin) => login(who.username, pin)} />
        ) : (
          <div className="flex flex-1 items-center justify-center rounded-2xl bg-panel text-2xl font-bold text-muted">
            Tap your name
          </div>
        )}
      </section>
    </div>
  );
}

function OfficeLogin({
  onBack,
  onSubmit,
  error,
}: {
  onBack: () => void;
  onSubmit: (u: string, p: string) => void;
  error: boolean;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  return (
    <div className="flex h-dvh items-center justify-center p-4">
      <form
        className="flex w-full max-w-md flex-col gap-3 rounded-2xl bg-panel p-6 shadow"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(username, password);
        }}
      >
        <h1 className="text-2xl font-extrabold">Office login</h1>
        <label className="flex flex-col gap-1 text-lg">
          Username
          <input
            autoFocus
            className="rounded-lg border-2 border-slate-300 px-3 py-2"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
        </label>
        <label className="flex flex-col gap-1 text-lg">
          Password
          <input
            type="password"
            className="rounded-lg border-2 border-slate-300 px-3 py-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error && <p className="font-semibold text-bad">Wrong username or password.</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1 rounded-lg border-2 border-slate-300 px-4 py-2 font-semibold"
          >
            <ArrowLeft className="size-5" /> Back
          </button>
          <button
            type="submit"
            className="flex-1 rounded-lg bg-action px-4 py-2 text-lg font-bold text-white"
          >
            Sign in
          </button>
        </div>
      </form>
    </div>
  );
}
