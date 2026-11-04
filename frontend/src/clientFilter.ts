import { useEffect, useState } from 'react';

const KEY = 'agera.clientFilter';
const EVENT = 'agera:client-filter';

export interface ClientFilter { id: string; name: string }

export function getClientFilter(): ClientFilter | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null') as ClientFilter | null;
  } catch {
    return null;
  }
}

export function setClientFilter(value: ClientFilter | null): void {
  if (value) localStorage.setItem(KEY, JSON.stringify(value));
  else localStorage.removeItem(KEY);
  window.dispatchEvent(new Event(EVENT));
}

/** The global client filter chosen in the client pill; lists with a client column show only that client's rows. */
export function useClientFilter(): ClientFilter | null {
  const [value, setValue] = useState(getClientFilter);
  useEffect(() => {
    const sync = () => setValue(getClientFilter());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => (window.removeEventListener(EVENT, sync), window.removeEventListener('storage', sync));
  }, []);
  return value;
}

export function matchesClient(filter: ClientFilter | null, clientId: string | null | undefined): boolean {
  return !filter || clientId === filter.id;
}
