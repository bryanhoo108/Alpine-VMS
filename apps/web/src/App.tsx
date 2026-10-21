import { useEffect, useState } from 'react';
import { api, type Me } from './api';
import { DevPanel } from './components/DevPanel';
import { Shell } from './components/Shell';
import { GateIn } from './screens/GateIn';
import { Login } from './screens/Login';
import { Placeholder } from './screens/Placeholder';

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [mock, setMock] = useState(false);

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

  if (me.role === 'guard' || me.role === 'supervisor' || me.role === 'admin') {
    return (
      <Shell title="Gate In" me={me} onLogout={logout}>
        <GateIn mock={mock} />
        {mock && <DevPanel camera="entry" />}
      </Shell>
    );
  }
  return (
    <Shell title="Alpine VMS" me={me} onLogout={logout}>
      <Placeholder
        text={`${me.role === 'checker' ? 'Checker' : 'Clerk'} screen comes in a later step`}
      />
    </Shell>
  );
}
