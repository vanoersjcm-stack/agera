import { type FormEvent, useState } from 'react';
import { api, type AccountRole, type UserAccount } from '../api';
import type { UserContext } from '../context';
import { activeClients, useClients } from '../directory';
import { formatDate, ROLE } from '../labels';
import { EmptyState, ViewFrame } from '../Layout';
import { navigate, type Route, withParams } from '../router';
import { Drawer, ErrorText, Field, FilterChips, FormActions, Loading, SearchInput, StatusBadge, useAction, useLoad } from '../ui';

const ROLE_LABEL: Record<AccountRole, string> = { ...ROLE, External_Client: 'Client contact' };

function InviteDrawer({ canGrantPlatformAdmin, onClose, onInvited }: { canGrantPlatformAdmin: boolean; onClose: () => void; onInvited: (email: string, password: string) => void }) {
  const clients = activeClients(useClients(true));
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', role: 'user' as AccountRole, clientId: '' });
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const external = form.role === 'External_Client';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(() =>
      api.inviteUser({
        email: form.email.trim(),
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        role: form.role,
        ...(external ? { clientId: form.clientId } : {}),
      }),
    ).then((r) => r && onInvited(r.user.email, r.temporaryPassword));
  };
  const roles = (Object.keys(ROLE_LABEL) as AccountRole[]).filter((r) => r !== 'platform-admin' || canGrantPlatformAdmin);
  return (
    <Drawer title="Invite a person" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="First name"><input required maxLength={100} value={form.firstName} onChange={set('firstName')} autoFocus /></Field>
        <Field label="Last name"><input required maxLength={100} value={form.lastName} onChange={set('lastName')} /></Field>
        <Field label="E-mail" hint="This is also the sign-in name"><input type="email" required maxLength={255} value={form.email} onChange={set('email')} /></Field>
        <Field label="Role">
          <select value={form.role} onChange={set('role')}>
            {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </Field>
        {external && (
          <Field label="Client company" hint="Client contacts only see this client's rooms and agreements">
            <select required value={form.clientId} onChange={set('clientId')}>
              <option value="">Choose a client…</option>
              {clients.map((c) => <option key={c.clientId} value={c.clientId}>{c.name}</option>)}
            </select>
          </Field>
        )}
        <ErrorText error={error} />
        <FormActions busy={busy} submitLabel="Send invitation" onCancel={onClose} />
      </form>
    </Drawer>
  );
}

function AccountRow({ account, self, canGrantPlatformAdmin, onChanged }: { account: UserAccount; self: boolean; canGrantPlatformAdmin: boolean; onChanged: (message: string) => void }) {
  const { busy, error, run } = useAction();
  const locked = self || (account.role === 'platform-admin' && !canGrantPlatformAdmin);
  const external = account.role === 'External_Client';
  const roles = (external ? ['External_Client'] : ['platform-admin', 'admin', 'user']).filter((r) => r !== 'platform-admin' || canGrantPlatformAdmin || account.role === 'platform-admin') as AccountRole[];
  const changeRole = (role: AccountRole) => void run(() => api.setUserRole(account.id, role)).then((r) => r && onChanged(`${account.name} is now ${ROLE_LABEL[role]}`));
  const toggle = () => {
    if (account.isActive && !window.confirm(`Deactivate ${account.name}? They can no longer sign in.`)) return;
    void run(() => api.setUserStatus(account.id, !account.isActive)).then((r) => r && onChanged(account.isActive ? `${account.name} deactivated` : `${account.name} reactivated`));
  };
  return (
    <tr>
      <td>{account.name}{self && <span className="muted"> (you)</span>}<div className="muted small">{account.email}</div><ErrorText error={error} /></td>
      <td>
        <select aria-label={`Role of ${account.name}`} value={account.role} disabled={locked || busy || external} onChange={(e) => changeRole(e.target.value as AccountRole)}>
          {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
      </td>
      <td><StatusBadge status={account.isActive ? 'active' : 'archived'} label={account.isActive ? 'Active' : 'Deactivated'} /></td>
      <td>{formatDate(account.createdAt)}</td>
      <td>{!locked && <button className={account.isActive ? 'link-button danger' : 'link-button'} disabled={busy} onClick={toggle}>{account.isActive ? 'Deactivate' : 'Reactivate'}</button>}</td>
    </tr>
  );
}

export function PeopleView({ route, user }: { route: Route; user: UserContext }) {
  const q = route.params.get('q') ?? '';
  const role = route.params.get('role') ?? '';
  const status = route.params.get('status') ?? 'active';
  const page = Number(route.params.get('page') ?? '1') || 1;
  const { data, error, reload } = useLoad(() => api.userAccounts({ q, role, status: status === 'all' ? undefined : status, page, limit: 25 }), [q, role, status, page]);
  const me = useLoad(() => api.me(), []);
  const [inviting, setInviting] = useState(false);
  const [invited, setInvited] = useState<{ email: string; password: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const canGrant = user.isPlatformAdmin;
  const available = data?.managementAvailable !== false;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  return (
    <ViewFrame
      title="People & access"
      crumbs={[{ label: 'Symphony', href: '#/symphony' }, { label: 'People & access' }]}
      actions={<button className="primary" disabled={!available} onClick={() => setInviting(true)}>+ Invite person</button>}
    >
      {!available && <p className="callout bad">User management is not connected to the sign-in service yet. Ask your system administrator to run the latest update.</p>}
      {invited && (
        <div className="callout">
          <strong>Invitation created for {invited.email}.</strong> Share this one-time password with them securely; they choose their own password at first sign-in:
          <code className="secret">{invited.password}</code>
          <button className="link-button" onClick={() => setInvited(null)}>Done</button>
        </div>
      )}
      {message && <p className="callout">{message}</p>}
      <div className="list-toolbar">
        <FilterChips
          value={status}
          onChange={(v) => navigate(withParams(route, { status: v === 'active' ? null : v, page: null }))}
          chips={[
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Deactivated' },
            { value: 'all', label: 'All' },
          ]}
        />
        <select aria-label="Filter by role" value={role} onChange={(e) => navigate(withParams(route, { role: e.target.value || null, page: null }))}>
          <option value="">All roles</option>
          {(Object.keys(ROLE_LABEL) as AccountRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
        <SearchInput value={q} onChange={(v) => navigate(withParams(route, { q: v, page: null }))} placeholder="Search by name or e-mail" />
      </div>
      {!data && <Loading error={error} />}
      {data && data.items.length === 0 && <EmptyState title="Nobody matches this filter" />}
      {data && data.items.length > 0 && (
        <table className="grid">
          <thead><tr><th>Person</th><th>Role</th><th>Status</th><th>Added</th><th /></tr></thead>
          <tbody>
            {data.items.map((a) => (
              <AccountRow key={`${a.id}-${a.role}-${a.isActive}`} account={a} self={a.id === me.data?.id} canGrantPlatformAdmin={canGrant} onChanged={(m) => (setMessage(m), reload())} />
            ))}
          </tbody>
        </table>
      )}
      {pages > 1 && (
        <div className="pager">
          <button className="secondary" disabled={page <= 1} onClick={() => navigate(withParams(route, { page: String(page - 1) }))}>Previous</button>
          <span>Page {page} of {pages}</span>
          <button className="secondary" disabled={page >= pages} onClick={() => navigate(withParams(route, { page: String(page + 1) }))}>Next</button>
        </div>
      )}
      {inviting && <InviteDrawer canGrantPlatformAdmin={canGrant} onClose={() => setInviting(false)} onInvited={(email, password) => (setInviting(false), setInvited({ email, password }), reload())} />}
    </ViewFrame>
  );
}
