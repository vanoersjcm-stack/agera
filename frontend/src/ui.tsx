import { cloneElement, isValidElement, type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';

/** Loads data on mount and whenever `deps` change; `reload` re-runs the loader. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const loader = useRef(load);
  loader.current = load;
  useEffect(() => {
    let cancelled = false;
    setError(null);
    loader.current().then(
      (result) => !cancelled && setData(result),
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, reload, setData };
}

/** Wraps an async action with a busy flag and error message. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await action();
    } catch (e) {
      setError((e as Error).message);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, setError };
}

export function Loading({ error }: { error?: string | null }) {
  return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Loading…</p>;
}

export function ErrorText({ error }: { error: string | null }) {
  return error ? <p className="error" role="alert">{error}</p> : null;
}

const TONES: Record<string, string> = {
  PENDING: 'neutral',
  PLANNED: 'neutral',
  draft: 'neutral',
  pending_approval: 'warn',
  IN_PROGRESS: 'info',
  COMPLETED: 'good',
  approved: 'good',
  active: 'good',
  accepted: 'good',
  compliant: 'good',
  CANCELLED: 'muted',
  archived: 'muted',
  expired: 'muted',
  rejected: 'bad',
  not_compliant: 'bad',
  needs_follow_up: 'warn',
};

export function StatusBadge({ status, label }: { status: string; label: string }) {
  return <span className={`badge tone-${TONES[status] ?? 'neutral'}`}>{label}</span>;
}

export interface Chip {
  value: string;
  label: string;
  count?: number;
}

/** Filter chips bound to a value (typically a URL query parameter). */
export function FilterChips({ chips, value, onChange }: { chips: Chip[]; value: string; onChange: (value: string) => void }) {
  return (
    <div className="chips" role="group" aria-label="Filter">
      {chips.map((c) => (
        <button key={c.value} className={`chip${c.value === value ? ' selected' : ''}`} aria-pressed={c.value === value} onClick={() => onChange(c.value)}>
          {c.label}
          {c.count !== undefined && <span className="chip-count">{c.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <input className="list-search" type="search" value={value} placeholder={placeholder} aria-label={placeholder} onChange={(e) => onChange(e.target.value)} />
  );
}

/** Side panel used for every create form. */
export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header className="drawer-header">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const control = isValidElement<{ id?: string; 'aria-describedby'?: string }>(children)
    ? cloneElement(children, { id, 'aria-describedby': hint ? hintId : undefined })
    : children;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{label}</label>
      {control}
      {hint && <span className="field-hint" id={hintId}>{hint}</span>}
    </div>
  );
}

export function FormActions({ busy, submitLabel, onCancel }: { busy: boolean; submitLabel: string; onCancel: () => void }) {
  return (
    <div className="form-actions">
      <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
    </div>
  );
}

export function Tabs({ tabs, active, onChange }: { tabs: { id: string; label: string }[]; active: string; onChange: (id: string) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={t.id === active} className={t.id === active ? 'tab active' : 'tab'} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Horizontal progress indicator for lifecycle workflows. */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="stepper">
      {steps.map((s, i) => (
        <li key={s} className={i < current ? 'done' : i === current ? 'current' : undefined} aria-current={i === current ? 'step' : undefined}>
          <span className="step-index">{i + 1}</span>
          {s}
        </li>
      ))}
    </ol>
  );
}

export function DetailList({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="details">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function includesText(haystack: (string | null | undefined)[], needle: string): boolean {
  const n = needle.trim().toLowerCase();
  return !n || haystack.some((h) => h?.toLowerCase().includes(n));
}
