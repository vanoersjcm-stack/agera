import { useEffect, useState } from 'react';

/** Hash routes such as `#/financials?period=2026-Q1`; the path part is the Nexus context route. */
export interface Route {
  path: string;
  params: URLSearchParams;
}

function current(): Route {
  const [path, query = ''] = window.location.hash.replace(/^#/, '').split('?');
  return { path: path || '/financials', params: new URLSearchParams(query) };
}

export function navigate(to: string): void {
  window.location.hash = to;
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
