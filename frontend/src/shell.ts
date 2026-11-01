import { createContext, useContext } from 'react';

export type NewKind =
  | 'work_order'
  | 'store_visit'
  | 'store'
  | 'agreement'
  | 'client_room'
  | 'client'
  | 'contact'
  | 'financial_plan'
  | 'organisation'
  | 'integration_key';

/** Optional pre-filled values, e.g. the work order when planning a visit from its record. */
export type NewDefaults = Record<string, string>;

export interface ShellApi {
  openNew: (kind: NewKind, defaults?: NewDefaults) => void;
  notify: (message: string) => void;
}

export const ShellContext = createContext<ShellApi>({ openNew: () => undefined, notify: () => undefined });

export const useShell = () => useContext(ShellContext);
