import { useEffect, useState } from 'react';
import { api } from './api';

/**
 * Offline queue for store visit reports and photos (RetailPower field work in low-connectivity stores).
 * Entries live in IndexedDB, photos as Blobs, and are sent to the normal endpoints once the browser is back online.
 */
type Entry =
  | { id?: number; kind: 'report'; visitId: string; storeId: string; body: { summary: string; auditData: Record<string, unknown> } }
  | { id?: number; kind: 'photo'; visitId: string; storeId: string; blob: Blob; name: string; type: string };

const DB = 'agera-offline';
const STORE = 'visit-queue';
const EVENT = 'agera:offline-queue';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = work(t.objectStore(STORE));
    t.oncomplete = () => (db.close(), resolve(req ? req.result : undefined));
    t.onerror = () => (db.close(), reject(t.error));
  });
}

const all = async () => (await tx<Entry[]>('readonly', (s) => s.getAll() as IDBRequest<Entry[]>)) ?? [];
const changed = () => window.dispatchEvent(new Event(EVENT));

/** True when a request failed because there is no connection (rather than a server-side refusal). */
export function isOffline(error?: unknown): boolean {
  return !navigator.onLine || error instanceof TypeError;
}

/** Queues a report; a newer report for the same visit replaces the queued one. */
export async function queueReport(visitId: string, storeId: string, body: { summary: string; auditData: Record<string, unknown> }) {
  const stale = (await all()).filter((e) => e.kind === 'report' && e.visitId === visitId);
  await tx('readwrite', (s) => {
    for (const e of stale) s.delete(e.id!);
    s.add({ kind: 'report', visitId, storeId, body } satisfies Entry);
  });
  changed();
}

export async function queuePhoto(visitId: string, storeId: string, file: File) {
  await tx('readwrite', (s) => void s.add({ kind: 'photo', visitId, storeId, blob: file, name: file.name, type: file.type } satisfies Entry));
  changed();
}

/** Number of visits with something queued. */
export async function queuedVisits(): Promise<number> {
  return new Set((await all()).map((e) => e.visitId)).size;
}

let flushing: Promise<number> | null = null;

/** Sends queued entries in order; failed entries stay queued for the next attempt. Returns the number sent. */
export function flushQueue(): Promise<number> {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    for (const e of await all()) {
      if (!navigator.onLine) break;
      try {
        if (e.kind === 'report') await api.saveVisitReport(e.visitId, e.body);
        else await api.uploadVisitPhoto(e.visitId, new File([e.blob], e.name, { type: e.type }));
        await tx('readwrite', (s) => void s.delete(e.id!));
        sent++;
      } catch (error) {
        if (isOffline(error)) break;
        // The server refused this entry (e.g. the visit was completed or cancelled meanwhile): keep it out of the way.
        console.warn('Offline visit entry rejected by the server; it is dropped', error);
        await tx('readwrite', (s) => void s.delete(e.id!));
      }
    }
    if (sent) changed();
    return sent;
  })().finally(() => (flushing = null));
  return flushing;
}

/** Auto-sync: flush on reconnect and once at start-up. */
export function startOfflineSync(onSynced?: (sent: number) => void): () => void {
  const run = () => void flushQueue().then((n) => n > 0 && onSynced?.(n), () => undefined);
  window.addEventListener('online', run);
  if (navigator.onLine) run();
  return () => window.removeEventListener('online', run);
}

/** Queued-visit count, kept current. */
export function useOfflineQueue(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const load = () => void queuedVisits().then(setCount, () => setCount(0));
    load();
    window.addEventListener(EVENT, load);
    window.addEventListener('online', load);
    window.addEventListener('offline', load);
    return () => (window.removeEventListener(EVENT, load), window.removeEventListener('online', load), window.removeEventListener('offline', load));
  }, []);
  return count;
}
