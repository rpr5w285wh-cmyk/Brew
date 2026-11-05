import { useEffect, useState } from 'preact/hooks';

export type Route = 'today' | 'session' | 'up' | 'winddown' | 'settings';

function parse(): Route {
  const h = location.hash.replace(/^#\/?/, '').split('?')[0];
  if (h === 'session' || h === 'up' || h === 'winddown' || h === 'settings') return h;
  return 'today';
}

export function query(): URLSearchParams {
  const i = location.hash.indexOf('?');
  return new URLSearchParams(i >= 0 ? location.hash.slice(i + 1) : '');
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parse());
  useEffect(() => {
    const on = () => setRoute(parse());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function go(r: Route, q?: Record<string, string>): void {
  const qs = q ? '?' + new URLSearchParams(q).toString() : '';
  location.hash = r === 'today' ? '' : `/${r}${qs}`;
  scrollTo(0, 0);
}
