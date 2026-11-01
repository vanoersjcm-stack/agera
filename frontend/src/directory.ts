import { useEffect, useState } from 'react';
import { api, type ClientStatus, type UserSummary } from './api';

export interface ClientRef {
  clientId: string;
  name: string;
  status: ClientStatus;
}

let usersCache: Promise<UserSummary[]> | null = null;
let clientsCache: Promise<ClientRef[]> | null = null;

/** Drops cached pickers after something was created, so new entries show up. */
export function invalidateDirectory(): void {
  usersCache = null;
  clientsCache = null;
}

export function useUsers(): UserSummary[] {
  const [users, setUsers] = useState<UserSummary[]>([]);
  useEffect(() => {
    usersCache ??= api.users().catch(() => []);
    void usersCache.then(setUsers);
  }, []);
  return users;
}

/** All clients (incl. archived, for names); pickers should offer only active ones. Internal users only. */
export function useClients(enabled = true): ClientRef[] {
  const [clients, setClients] = useState<ClientRef[]>([]);
  useEffect(() => {
    if (!enabled) return;
    clientsCache ??= api.clients().then(
      (list) => list.map((c) => ({ clientId: c.id, name: c.name, status: c.status })),
      () => [],
    );
    void clientsCache.then(setClients);
  }, [enabled]);
  return clients;
}

export function activeClients(clients: ClientRef[]): ClientRef[] {
  return clients.filter((c) => c.status === 'active');
}

export function userName(users: UserSummary[], id: string | null | undefined, fallback = '—'): string {
  if (!id) return fallback;
  return users.find((u) => u.id === id)?.name ?? 'Unknown user';
}

export function clientName(clients: ClientRef[], id: string): string {
  return clients.find((c) => c.clientId === id)?.name ?? 'Unnamed client';
}
