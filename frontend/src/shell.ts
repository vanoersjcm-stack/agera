import { createContext, useContext } from 'react';

export type NewKind =
  | 'doc_text'
  | 'doc_sheet'
  | 'doc_mail'
  | 'automation'
  | 'user_invite'
  | 'survey'
  | 'price_list'
  | 'document_template'
  | 'exception'
  | 'product'
  | 'planogram'
  | 'field_order'
  | 'audit_round'
  | 'work_order'
  | 'deal'
  | 'invoice'
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
