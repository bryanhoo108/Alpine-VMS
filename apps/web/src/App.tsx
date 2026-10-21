import { useEffect, useState } from 'react';
import { api, type Me } from './api';
import { DevPanel } from './components/DevPanel';
import { Shell } from './components/Shell';
import { Checker } from './screens/Checker';
import { GateIn } from './screens/GateIn';
import { Login } from './screens/Login';
import { Office } from './screens/office/Office';
import { Placeholder } from './screens/Placeholder';

type View = 'gate-in' | 'office' | 'checker';

/** Which screens each role may open; the first is where they land. */
const VIEWS: Record<Me['role'], View[]> = {
  guard: ['gate-in'],
  clerk: ['office'],
  checker: ['checker'],
  supervisor: ['office', 'gate-in', 'checker'],
  admin: ['office', 'gate-in', 'checker'],
};

const TITLES: Record<View, string> = { 'gate-in': 'Gate In', office: 'Office', checker: 'Check' };

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [mock, setMock] = useState(false);
  const [view, setView] = useState<View | null>(null);

  useEffect(() => {
    api
      .get<Me>('/api/auth/me')
      .then(setMe)
      .catch(() => setMe(null));
    api
      .get('/api/dev')
      .then(() => setMock(true))
      .catch(() => setMock(false));
  }, []);

  if (me === undefined) return null;
  if (me === null) return <Login onLogin={setMe} />;

  const logout = () => {
    void api.post('/api/auth/logout').finally(() => {
      setMe(null);
      setView(null);
    });
  };

  const allowed = VIEWS[me.role];
  const current = view && allowed.includes(view) ? view : allowed[0];
  if (!current) {
    return (
      <Shell title="Alpine VMS" me={me} onLogout={logout}>
        <Placeholder text="No screen for this role" />
      </Shell>
    );
  }

  const nav =
    allowed.length > 1
      ? allowed.map((v) => ({ label: TITLES[v], active: v === current, onClick: () => setView(v) }))
      : undefined;
  return (
    <Shell title={TITLES[current]} me={me} onLogout={logout} nav={nav}>
      {current === 'gate-in' && <GateIn mock={mock} />}
      {current === 'office' && <Office mock={mock} />}
      {current === 'checker' && <Checker />}
      {mock && current === 'gate-in' && <DevPanel camera="entry" />}
    </Shell>
  );
}
