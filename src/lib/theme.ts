export type Theme = 'dark' | 'light' | 'system';

const COLORS = { dark: '#17120e', light: '#f5efe6' };

function resolve(t: Theme): 'dark' | 'light' {
  if (t === 'system') return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  return t;
}

let current: Theme = 'dark';
let mql: MediaQueryList | null = null;

export function applyTheme(t: Theme): void {
  current = t;
  const r = resolve(t);
  document.documentElement.dataset.theme = r;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COLORS[r]);
  try { localStorage.setItem('brew-theme', t); } catch { /* ignore */ }
  if (!mql) {
    mql = matchMedia('(prefers-color-scheme: light)');
    mql.addEventListener('change', () => { if (current === 'system') applyTheme('system'); });
  }
}
