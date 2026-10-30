import { useEffect, useState } from 'react';
import { api, type FinancialModel, type UserSummary } from './api';

export interface ClientRef {
  clientId: string;
  name: string;
}

/**
 * Clients have no table of their own yet (audit gap B1): their id and company name are kept in the
 * metadata of financial plans. This collects them so pickers and lists can show names.
 */
export function clientsFromPlans(models: FinancialModel[]): ClientRef[] {
  const byId = new Map<string, string>();
  for (const m of models) {
    const id = m.metadata.clientId;
    const name = m.metadata.companyName;
    if (typeof id === 'string' && !byId.has(id)) byId.set(id, typeof name === 'string' && name ? name : m.modelName);
  }
  return [...byId].map(([clientId, name]) => ({ clientId, name })).sort((a, b) => a.name.localeCompare(b.name));
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

/** Client names come from financial plans, which only internal users can read. */
export function useClients(enabled = true): ClientRef[] {
  const [clients, setClients] = useState<ClientRef[]>([]);
  useEffect(() => {
    if (!enabled) return;
    clientsCache ??= api.models().then(clientsFromPlans, () => []);
    void clientsCache.then(setClients);
  }, [enabled]);
  return clients;
}

export function userName(users: UserSummary[], id: string | null | undefined, fallback = '—'): string {
  if (!id) return fallback;
  return users.find((u) => u.id === id)?.name ?? 'Unknown user';
}

export function clientName(clients: ClientRef[], id: string): string {
  return clients.find((c) => c.clientId === id)?.name ?? 'Unnamed client';
}
