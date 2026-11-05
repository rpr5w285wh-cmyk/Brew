import { useEffect } from 'preact/hooks';
import { useRoute } from './router';
import { useToday } from './lib/store';
import { requestPersistence } from './lib/store';
import { TodayScreen } from './screens/Today';
import { SessionScreen } from './screens/Session';
import { UpScreen } from './screens/Up';
import { WindDownScreen } from './screens/WindDown';
import { SettingsScreen } from './screens/Settings';

export function App() {
  const route = useRoute();
  const today = useToday();

  useEffect(() => { requestPersistence(); }, []);

  if (!today.ready) return <main class="screen"><p class="muted">Brewing…</p></main>;

  switch (route) {
    case 'session': return <SessionScreen t={today} />;
    case 'up': return <UpScreen t={today} />;
    case 'winddown': return <WindDownScreen t={today} />;
    case 'settings': return <SettingsScreen t={today} />;
    default: return <TodayScreen t={today} />;
  }
}
