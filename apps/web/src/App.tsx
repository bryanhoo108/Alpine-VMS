import { useEffect, useState } from 'react';
import { api, type Me } from './api';
import { DevPanel } from './components/DevPanel';
import { Shell } from './components/Shell';
import { Checker } from './screens/Checker';
import { GateIn } from './screens/GateIn';
import { GateOut } from './screens/GateOut';
import { Login } from './screens/Login';
import { Office } from './screens/office/Office';
import { Overview } from './screens/Overview';
import { Placeholder } from './screens/Placeholder';

type View = 'gate-in' | 'gate-out' | 'office' | 'checker' | 'overview';

/** Which screens each role may open; the first is the default. */
const VIEWS: Record<Me['role'], View[]> = {
  guard: ['gate-in', 'gate-out'],
  clerk: ['office', 'overview'],
  checker: ['checker'],
  supervisor: ['overview', 'office', 'gate-in', 'gate-out', 'checker'],
  admin: ['overview', 'office', 'gate-in', 'gate-out', 'checker'],
};

const TITLES: Record<View, string> = {
  'gate-in': 'Gate In',
  'gate-out': 'Gate Out',
  office: 'Office',
  checker: 'Check',
  overview: 'Live overview',
};
/** Short labels so five fit in the title bar on a phone. */
const NAV: Record<View, string> = {
  'gate-in': 'In',
  'gate-out': 'Out',
  office: 'Office',
  checker: 'Check',
  overview: 'Live',
};

/** Each tablet remembers its post (entry or exit); a browser-only convenience. */
const VIEW_KEY = 'vms.view';
const savedView = (): View | null => {
  try {
    return localStorage.getItem(VIEW_KEY) as View | null;
  } catch {
    return null;
  }
};

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [mock, setMock] = useState(false);
  const [view, setView] = useState<View | null>(savedView);

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
    void api.post('/api/auth/logout').finally(() => setMe(null));
  };
  const choose = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Private mode: the choice just isn't remembered.
    }
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
      ? allowed.map((v) => ({ label: NAV[v], active: v === current, onClick: () => choose(v) }))
      : undefined;
  return (
    <Shell title={TITLES[current]} me={me} onLogout={logout} nav={nav}>
      {current === 'gate-in' && <GateIn mock={mock} />}
      {current === 'gate-out' && <GateOut mock={mock} />}
      {current === 'office' && <Office mock={mock} />}
      {current === 'checker' && <Checker />}
      {current === 'overview' && <Overview demoControls={mock && me.role !== 'clerk'} />}
      {mock && (current === 'gate-in' || current === 'gate-out') && (
        <DevPanel camera={current === 'gate-in' ? 'entry' : 'exit'} />
      )}
    </Shell>
  );
}
