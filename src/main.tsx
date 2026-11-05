import { render } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app';
import './styles.css';

// New versions are applied only when the app goes to the background (or on the
// next cold start), never under the user's thumb at 06:31.
let applyUpdate: ((reload?: boolean) => Promise<void>) | null = null;
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() { applyUpdate = updateSW; },
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && applyUpdate) { const f = applyUpdate; applyUpdate = null; f(true); }
});

render(<App />, document.getElementById('app')!);
