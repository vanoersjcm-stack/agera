import { type FormEvent, useState } from 'react';
import { api } from '../api';
import type { UserContext } from '../context';
import { activeClients, invalidateDirectory, useClients } from '../directory';
import { formatDateTime } from '../labels';
import { EmptyState, ViewFrame } from '../Layout';
import { navigate, type Route, withParams } from '../router';
import { useShell } from '../shell';
import { Drawer, ErrorText, Field, FilterChips, FormActions, Loading, StatusBadge, useAction, useLoad } from '../ui';

export const CREDIT_HOLDS_CHANGED = 'agera:credit-holds-changed';

function LockDrawer({ defaultClientId, onClose, onSaved }: { defaultClientId: string; onClose: () => void; onSaved: () => void }) {
  const clients = useClients();
  const [clientId, setClientId] = useState(defaultClientId);
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (clientId === '' && !window.confirm('Lock credit for ALL clients? No agreement can be activated until you release the lock.')) return;
    void run(() => api.createCreditHold({ clientId: clientId || null, reason: reason.trim() })).then((r) => r && onSaved());
  };
  return (
    <Drawer title="Emergency credit lock" onClose={onClose}>
      <form onSubmit={submit}>
        <p className="muted">While a lock is active, agreements for the client (or for all clients) cannot be activated. Every lock and release is recorded in the activity log.</p>
        <Field label="Client">
          <select value={clientId} onChange={(e) => setClientId(e.target.value)} autoFocus>
            <option value="">All clients (organisation-wide)</option>
            {activeClients(clients).map((c) => <option key={c.clientId} value={c.clientId}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Reason" hint="Visible to colleagues, e.g. Payment overdue > 60 days">
          <textarea required rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <ErrorText error={error} />
        <FormActions busy={busy} submitLabel="Lock credit" onCancel={onClose} />
      </form>
    </Drawer>
  );
}

export function CreditControlView({ route, user }: { route: Route; user: UserContext }) {
  const { notify } = useShell();
  const show = route.params.get('show') ?? 'active';
  const lockFor = route.params.get('lock');
  const { data, error, reload } = useLoad(() => api.creditHolds(show === 'all'), [show]);
  const action = useAction();
  const canManage = user.role === 'admin' || user.isPlatformAdmin;
  const changed = (message: string) => {
    invalidateDirectory();
    window.dispatchEvent(new Event(CREDIT_HOLDS_CHANGED));
    notify(message);
    reload();
  };
  const release = (id: string, label: string) => {
    if (!window.confirm(`Release the credit lock for ${label}?`)) return;
    void action.run(() => api.releaseCreditHold(id)).then((r) => r && changed('Credit lock released'));
  };
  const holds = data ?? [];
  return (
    <ViewFrame
      title="Credit control"
      subtitle="Emergency credit locks block agreement activation until they are released"
      crumbs={[{ label: 'Symphony', href: '#/symphony' }, { label: 'Credit control' }]}
      actions={canManage && <button className="primary danger-fill" onClick={() => navigate(withParams(route, { lock: '' }))}>Lock credit…</button>}
    >
      <div className="list-toolbar">
        <FilterChips value={show} onChange={(v) => navigate(withParams(route, { show: v === 'active' ? null : v }))} chips={[{ value: 'active', label: 'Active locks' }, { value: 'all', label: 'Including released' }]} />
      </div>
      <ErrorText error={action.error} />
      {!data && <Loading error={error} />}
      {data && holds.length === 0 && <EmptyState title={show === 'all' ? 'No credit locks yet' : 'No active credit locks'}>Credit is open for all clients.</EmptyState>}
      {holds.length > 0 && (
        <table className="grid">
          <thead><tr><th>Applies to</th><th>Reason</th><th>Set</th><th>Status</th><th /></tr></thead>
          <tbody>
            {holds.map((h) => {
              const label = h.clientName ?? 'all clients';
              return (
                <tr key={h.id}>
                  <td>{h.clientId ? <a href={`#/symphony/clients/${h.clientId}`}>{h.clientName}</a> : <strong>All clients</strong>}</td>
                  <td>{h.reason}</td>
                  <td>{formatDateTime(h.createdAt)}<div className="muted small">{h.setByName ?? '—'}</div></td>
                  <td>
                    {h.active ? <StatusBadge status="not_compliant" label="Locked" /> : <StatusBadge status="archived" label="Released" />}
                    {h.releasedAt && <div className="muted small">{formatDateTime(h.releasedAt)} · {h.releasedByName ?? '—'}</div>}
                  </td>
                  <td>{h.active && canManage && <button className="link-button" disabled={action.busy} onClick={() => release(h.id, label)}>Release</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {lockFor !== null && canManage && (
        <LockDrawer defaultClientId={lockFor} onClose={() => navigate(withParams(route, { lock: null }))} onSaved={() => (navigate(withParams(route, { lock: null })), changed('Credit lock set'))} />
      )}
    </ViewFrame>
  );
}
