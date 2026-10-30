import { useEffect, useState } from 'react';

/** Hash routes such as `#/retailpower/work-orders/<id>?status=PENDING`. */
export interface Route {
  path: string;
  /** Path split on `/`, e.g. `['retailpower', 'work-orders', '<id>']`. */
  segments: string[];
  params: URLSearchParams;
}

function current(): Route {
  const [path, query = ''] = window.location.hash.replace(/^#/, '').split('?');
  const clean = path || '/';
  return { path: clean, segments: clean.split('/').filter(Boolean), params: new URLSearchParams(query) };
}

export function navigate(to: string): void {
  window.location.hash = to;
}

/** Same path with some query parameters changed (empty values are removed). */
export function withParams(route: Route, changes: Record<string, string | null>): string {
  const params = new URLSearchParams(route.params);
  for (const [key, value] of Object.entries(changes)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  return `${route.path}${params.size ? `?${params}` : ''}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(current);
  useEffect(() => {
    const onChange = () => setRoute(current());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
