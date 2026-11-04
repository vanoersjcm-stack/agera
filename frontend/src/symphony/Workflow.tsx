import { matchesClient, useClientFilter } from '../clientFilter';
import { type FormEvent, useEffect, useState } from 'react';
import { api, type ApprovalEntity, type AppNotification, type ExceptionRecord, type ExceptionSeverity, type ExceptionStatus } from '../api';
import { useUsers, userName } from '../directory';
import { formatDate, formatDateTime } from '../labels';
import { EmptyState, ViewFrame } from '../Layout';
import { navigate, type Route, withParams } from '../router';
import { type NewDefaults, useShell } from '../shell';
import { DetailList, Drawer, ErrorText, Field, FilterChips, FormActions, Loading, StatusBadge, useAction, useLoad } from '../ui';
import { t as tr } from '../i18n';

const APPROVAL_STATUS: Record<string, string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', cancelled: 'Withdrawn' };
const SEVERITY: Record<ExceptionSeverity, string> = { low: 'Low', medium: 'Medium', high: 'High' };
const EXC_STATUS: Record<ExceptionStatus, string> = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved' };
const ENTITY: Record<ApprovalEntity, string> = { financial_plan: 'Financial plan', agreement: 'Agreement' };

function useMe() {
  return useLoad(() => api.me(), []).data?.id ?? null;
}

/* ---------- Approvals ---------- */

function RequestApprovalDrawer({ entityType, entityId, onClose, onDone }: { entityType: ApprovalEntity; entityId: string; onClose: () => void; onDone: () => void }) {
  const users = useUsers();
  const [chain, setChain] = useState<string[]>([]);
  const [adding, setAdding] = useState('');
  const [note, setNote] = useState('');
  const { busy, error, run } = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(() => api.requestApproval({ entityType, entityId, approverIds: chain, note: note.trim() || null })).then((r) => r && onDone());
  };
  return (
    <Drawer title={tr("Send for approval")} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="muted">{tr("Approvers decide one after another. The last approval")} {entityType === 'agreement' ? tr("activates the agreement") : tr("approves the plan")}  {tr("automatically.")}</p>
        <Field label={`Approval chain (${chain.length} of max. 5)`}>
          <ol className="chain">
            {chain.map((id, i) => (
              <li key={id}>
                {userName(users, id)}{' '}
                <button type="button" className="link-button" disabled={i === 0} onClick={() => setChain(chain.map((x, j) => (j === i - 1 ? id : j === i ? chain[i - 1] : x)))}>↑</button>{' '}
                <button type="button" className="link-button danger" onClick={() => setChain(chain.filter((x) => x !== id))}>{tr("Remove")}</button>
              </li>
            ))}
          </ol>
          <div className="line-row">
            <select value={adding} onChange={(e) => setAdding(e.target.value)} aria-label={tr("Add approver")}>
              <option value="">{tr("Add an approver…")}</option>
              {users.filter((u) => !chain.includes(u.id)).map((u) => <option key={u.id} value={u.id}>{userName(users, u.id)}</option>)}
            </select>
            <button type="button" className="secondary small" disabled={!adding || chain.length >= 5} onClick={() => (setChain([...chain, adding]), setAdding(''))}>{tr("Add")}</button>
          </div>
        </Field>
        <Field label={tr("Note for the approvers")}><textarea rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <ErrorText error={error} />
        <FormActions busy={busy || chain.length === 0} submitLabel={tr("Send for approval")} onCancel={onClose} />
      </form>
    </Drawer>
  );
}

/** Approval status on a plan or agreement page, with "Send for approval". */
export function ApprovalPanel({ entityType, entityId, canRequest, onChanged }: { entityType: ApprovalEntity; entityId: string; canRequest: boolean; onChanged?: () => void }) {
  const { notify } = useShell();
  const list = useLoad(() => api.approvals({ entityId }), [entityId]);
  const [open, setOpen] = useState(false);
  const latest = list.data?.[0];
  const pending = latest?.status === 'pending';
  if (!latest && !canRequest) return null;
  return (
    <div className="card-panel approval-panel">
      <div className="panel-head">
        <h2>{tr("Approval")}</h2>
        {canRequest && !pending && <button className="secondary" onClick={() => setOpen(true)}>{tr("Send for approval…")}</button>}
      </div>
      {!latest ? (
        <p className="muted">{tr("No approval requested yet. You can still approve directly, or send it through an approval chain.")}</p>
      ) : (
        <>
          <p>
            <StatusBadge status={latest.status === 'approved' ? 'active' : latest.status === 'pending' ? 'pending_approval' : 'archived'} label={APPROVAL_STATUS[latest.status]} />  {tr("requested by")} {latest.requestedByName ?? '—'}  {tr("on")} {formatDate(latest.createdAt)} ·{' '}
            <a href={`#/symphony/approvals/${latest.id}`}>{tr("open request")}</a>
          </p>
          <ol className="chain">{latest.steps.map((s) => <li key={s.id} className={`step-${s.decision}`}>{s.approverName}: {s.decision === 'pending' ? (latest.currentApproverId === s.approverId ? tr("to decide") : 'waiting') : s.decision}{s.comment ? ` – “${s.comment}”` : ''}</li>)}</ol>
        </>
      )}
      {open && <RequestApprovalDrawer entityType={entityType} entityId={entityId} onClose={() => setOpen(false)} onDone={() => (setOpen(false), notify(tr("Sent for approval")), list.reload(), onChanged?.())} />}
    </div>
  );
}

export function ApprovalsView({ route }: { route: Route }) {
  const show = route.params.get('show') ?? 'mine';
  const list = useLoad(() => api.approvals(show === 'mine' ? { mine: true } : show === 'pending' ? { status: 'pending' } : {}), [show]);
  return (
    <ViewFrame title={tr("Approvals")} subtitle={tr("Plans and agreements going through an approval chain")} crumbs={[{ label: tr("Symphony"), href: '#/symphony' }, { label: tr("Approvals") }]}>
      <div className="list-toolbar">
        <FilterChips value={show} onChange={(v) => navigate(withParams(route, { show: v === 'mine' ? null : v }))} chips={[{ value: 'mine', label: tr("Waiting for me") }, { value: 'pending', label: tr("All pending") }, { value: 'all', label: tr("All") }]} />
      </div>
      {!list.data && <Loading error={list.error} />}
      {list.data?.length === 0 && <EmptyState title={show === 'mine' ? tr("Nothing waiting for you") : tr("No approval requests")}>{tr("Use “Send for approval” on a draft financial plan or an agreement awaiting approval.")}</EmptyState>}
      {list.data && list.data.length > 0 && (
        <table className="grid clickable">
          <thead><tr><th>{tr("Record")}</th><th>{tr("Type")}</th><th>{tr("Requested")}</th><th>{tr("Next approver")}</th><th>{tr("Status")}</th></tr></thead>
          <tbody>
            {list.data.map((a) => (
              <tr key={a.id} onClick={() => navigate(`/symphony/approvals/${a.id}`)}>
                <td><a href={`#/symphony/approvals/${a.id}`}>{a.entityLabel}</a></td>
                <td>{ENTITY[a.entityType]}</td>
                <td>{formatDate(a.createdAt)}<div className="muted small">{a.requestedByName ?? '—'}</div></td>
                <td>{a.steps.find((s) => s.approverId === a.currentApproverId)?.approverName ?? '—'}</td>
                <td><StatusBadge status={a.status === 'approved' ? 'active' : a.status === 'pending' ? 'pending_approval' : 'archived'} label={APPROVAL_STATUS[a.status]} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ViewFrame>
  );
}

export function ApprovalDossier({ id }: { id: string }) {
  const { notify } = useShell();
  const me = useMe();
  const a = useLoad(() => api.approval(id), [id]);
  const [comment, setComment] = useState('');
  const action = useAction();
  const crumbs = [{ label: tr("Symphony"), href: '#/symphony' }, { label: tr("Approvals"), href: '#/symphony/approvals' }];
  if (!a.data) return <ViewFrame title={tr("Approval")} crumbs={[...crumbs, { label: tr("Loading…") }]}><Loading error={a.error} /></ViewFrame>;
  const r = a.data;
  const link = r.entityType === 'agreement' ? `#/nexus/agreements/${r.entityId}` : `#/nexus/financial-plans/${r.entityId}`;
  const decide = (d: 'approved' | 'rejected') => void action.run(() => api.decideApproval(id, d, comment.trim())).then((x) => x && (notify(d === 'approved' ? tr("Approved") : tr("Rejected")), setComment(''), a.reload()));
  const myTurn = r.status === 'pending' && r.currentApproverId === me;
  return (
    <ViewFrame
      title={r.entityLabel}
      subtitle={<StatusBadge status={r.status === 'approved' ? 'active' : r.status === 'pending' ? 'pending_approval' : 'archived'} label={APPROVAL_STATUS[r.status]} />}
      crumbs={[...crumbs, { label: r.entityLabel }]}
      actions={r.status === 'pending' && r.requestedById === me && <button className="secondary" disabled={action.busy} onClick={() => void action.run(() => api.cancelApproval(id)).then((x) => x && a.reload())}>{tr("Withdraw request")}</button>}
    >
      <ErrorText error={action.error} />
      <DetailList items={[['Record', <a href={link}>{ENTITY[r.entityType]}: {r.entityLabel}</a>], ['Requested by', `${r.requestedByName ?? '—'} · ${formatDateTime(r.createdAt)}`], ['Note', r.note || '—'], ['Decided', r.decidedAt ? formatDateTime(r.decidedAt) : '—']]} />
      <div className="card-panel">
        <h2>{tr("Approval chain")}</h2>
        <ol className="chain">
          {r.steps.map((s) => (
            <li key={s.id} className={`step-${s.decision}`}>
              <strong>{s.approverName}</strong> – {s.decision === 'pending' ? (r.currentApproverId === s.approverId ? tr("to decide now") : 'waiting') : `${s.decision} on ${formatDateTime(s.decidedAt!)}`}
              {s.comment && <div className="muted">“{s.comment}”</div>}
            </li>
          ))}
        </ol>
        {myTurn && (
          <>
            <Field label={tr("Comment")} hint={tr("Required when rejecting")}><textarea rows={3} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
            <div className="form-actions start">
              <button className="primary" disabled={action.busy} onClick={() => decide('approved')}>{tr("Approve")}</button>
              <button className="secondary danger" disabled={action.busy || !comment.trim()} onClick={() => decide('rejected')}>{tr("Reject")}</button>
            </div>
          </>
        )}
      </div>
    </ViewFrame>
  );
}

/* ---------- Exceptions ---------- */

export function NewExceptionForm({ defaults, onDone, onCancel }: { defaults: NewDefaults; onDone: (route?: string, message?: string) => void; onCancel: () => void }) {
  const users = useUsers();
  const stores = useLoad(() => api.stores(), []);
  const clients = useLoad(() => api.clients(), []);
  const [title, setTitle] = useState(defaults.title ?? '');
  const [description, setDescription] = useState(defaults.description ?? '');
  const [severity, setSeverity] = useState<ExceptionSeverity>('medium');
  const [ownerId, setOwnerId] = useState('');
  const [storeId, setStoreId] = useState(defaults.storeId ?? '');
  const [clientId, setClientId] = useState(defaults.clientId ?? '');
  const { busy, error, run } = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(() => api.createException({ title: title.trim(), description: description.trim() || null, severity, ownerId: ownerId || null, storeId: storeId || null, clientId: clientId || null, source: defaults.source || null })).then(
      (r) => r && onDone(`/nexus/exceptions/${r.id}`, 'Exception logged'),
    );
  };
  return (
    <form onSubmit={submit}>
      <Field label={tr("What went wrong?")}><input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus /></Field>
      <Field label={tr("Details")}><textarea rows={3} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <Field label={tr("Severity")}>
        <select value={severity} onChange={(e) => setSeverity(e.target.value as ExceptionSeverity)}>{Object.entries(SEVERITY).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </Field>
      <Field label={tr("Owner")} hint={tr("The owner gets a notification")}>
        <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}><option value="">{tr("Unassigned")}</option>{users.map((u) => <option key={u.id} value={u.id}>{userName(users, u.id)}</option>)}</select>
      </Field>
      <Field label={tr("Store")}><select value={storeId} onChange={(e) => setStoreId(e.target.value)}><option value="">—</option>{stores.data?.items.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      <Field label={tr("Client")}><select value={clientId} onChange={(e) => setClientId(e.target.value)}><option value="">—</option>{clients.data?.filter((c) => c.status === 'active').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <ErrorText error={error} />
      <FormActions busy={busy} submitLabel={tr("Log exception")} onCancel={onCancel} />
    </form>
  );
}

export function ExceptionsView({ route }: { route: Route }) {
  const { openNew } = useShell();
  const status = route.params.get('status') ?? 'unresolved';
  const list = useLoad(() => api.exceptions(status === 'all' ? undefined : status), [status]);
  const clientFilter = useClientFilter();
  return (
    <ViewFrame title={tr("Exceptions")} subtitle={tr("Issues that need an owner and a resolution")} crumbs={[{ label: tr("Nexus"), href: '#/nexus' }, { label: tr("Exceptions") }]} actions={<button className="primary" onClick={() => openNew('exception')}>{tr("+ New exception")}</button>}>
      <div className="list-toolbar">
        <FilterChips value={status} onChange={(v) => navigate(withParams(route, { status: v === 'unresolved' ? null : v }))} chips={[{ value: 'unresolved', label: tr("Unresolved") }, { value: 'open', label: tr("Open") }, { value: 'in_progress', label: tr("In progress") }, { value: 'resolved', label: tr("Resolved") }, { value: 'all', label: tr("All") }]} />
      </div>
      {!list.data && <Loading error={list.error} />}
      {list.data?.length === 0 && <EmptyState title={tr("No exceptions")}>{tr("Log one with “+ New exception”, or from an alert.")}</EmptyState>}
      {list.data && list.data.length > 0 && (
        <table className="grid clickable">
          <thead><tr><th>{tr("Exception")}</th><th>{tr("Severity")}</th><th>{tr("Owner")}</th><th>{tr("Store / client")}</th><th>{tr("Status")}</th></tr></thead>
          <tbody>
            {list.data.filter((e) => matchesClient(clientFilter, e.clientId)).map((e) => (
              <tr key={e.id} onClick={() => navigate(`/nexus/exceptions/${e.id}`)}>
                <td><a href={`#/nexus/exceptions/${e.id}`}>{e.title}</a><div className="muted small">{formatDate(e.createdAt)}</div></td>
                <td><StatusBadge status={e.severity === 'high' ? 'not_compliant' : e.severity === 'medium' ? 'needs_follow_up' : 'compliant'} label={SEVERITY[e.severity]} /></td>
                <td>{e.ownerName ?? tr("Unassigned")}</td>
                <td>{[e.storeName, e.clientName].filter(Boolean).join(' · ') || '—'}</td>
                <td><StatusBadge status={e.status === 'resolved' ? 'active' : 'pending_approval'} label={EXC_STATUS[e.status]} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ViewFrame>
  );
}

export function ExceptionDossier({ id }: { id: string }) {
  const { notify } = useShell();
  const users = useUsers();
  const ex = useLoad(() => api.exception(id), [id]);
  const [resolution, setResolution] = useState('');
  const action = useAction();
  const crumbs = [{ label: tr("Nexus"), href: '#/nexus' }, { label: tr("Exceptions"), href: '#/nexus/exceptions' }];
  if (!ex.data) return <ViewFrame title={tr("Exception")} crumbs={[...crumbs, { label: tr("Loading…") }]}><Loading error={ex.error} /></ViewFrame>;
  const e: ExceptionRecord = ex.data;
  const save = (body: Parameters<typeof api.updateException>[1], msg: string) => void action.run(() => api.updateException(id, body)).then((r) => r && (notify(msg), ex.reload()));
  return (
    <ViewFrame title={e.title} subtitle={<StatusBadge status={e.status === 'resolved' ? 'active' : 'pending_approval'} label={EXC_STATUS[e.status]} />} crumbs={[...crumbs, { label: e.title }]}
      actions={e.status === 'open' && <button className="secondary" onClick={() => save({ status: 'in_progress' }, 'Marked in progress')}>{tr("Start working on it")}</button>}>
      <ErrorText error={action.error} />
      <DetailList
        items={[
          ['Severity', SEVERITY[e.severity]],
          ['Owner', <select value={e.ownerId ?? ''} disabled={e.status === 'resolved'} onChange={(x) => save({ ownerId: x.target.value || null }, 'Owner changed')}><option value="">{tr("Unassigned")}</option>{users.map((u) => <option key={u.id} value={u.id}>{userName(users, u.id)}</option>)}</select>],
          ['Store', e.storeId ? <a href={`#/retailpower/stores/${e.storeId}`}>{e.storeName}</a> : '—'],
          ['Client', e.clientId ? <a href={`#/nexus/clients/${e.clientId}`}>{e.clientName}</a> : '—'],
          ['Source', e.source || 'Logged manually'],
          ['Details', e.description || '—'],
          ['Logged', `${e.createdByName ?? '—'} · ${formatDateTime(e.createdAt)}`],
          ['Resolution', e.resolution ? `${e.resolution} (${formatDateTime(e.resolvedAt!)})` : '—'],
        ]}
      />
      {e.status !== 'resolved' ? (
        <div className="card-panel">
          <h2>{tr("Resolve")}</h2>
          <Field label={tr("How was it resolved?")}><textarea rows={3} maxLength={4000} value={resolution} onChange={(x) => setResolution(x.target.value)} /></Field>
          <button className="primary" disabled={action.busy || !resolution.trim()} onClick={() => save({ status: 'resolved', resolution: resolution.trim() }, 'Exception resolved')}>{tr("Mark resolved")}</button>
        </div>
      ) : (
        <button className="secondary" onClick={() => save({ status: 'open' }, 'Exception reopened')}>{tr("Reopen")}</button>
      )}
    </ViewFrame>
  );
}

/* ---------- Notifications ---------- */

export function NotificationBell() {
  const [data, setData] = useState<{ unread: number; items: AppNotification[] } | null>(null);
  const [open, setOpen] = useState(false);
  const load = () => void api.notifications().then(setData, () => setData(null));
  useEffect(() => {
    load();
    const t = window.setInterval(load, 60000);
    return () => window.clearInterval(t);
  }, []);
  if (!data) return null;
  const go = (n: AppNotification) => {
    setOpen(false);
    void api.readNotifications(n.id).then(load);
    if (n.link) navigate(n.link);
  };
  return (
    <div className="bell">
      <button className="bell-button" aria-label={`Notifications (${data.unread} unread)`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
        {data.unread > 0 && <span className="bell-count">{data.unread > 9 ? '9+' : data.unread}</span>}
      </button>
      {open && (
        <div className="menu bell-menu" role="menu">
          <div className="bell-head"><strong>{tr("Notifications")}</strong>{data.unread > 0 && <button className="link-button" onClick={() => void api.readNotifications().then(load)}>{tr("Mark all read")}</button>}</div>
          {data.items.length === 0 && <p className="muted">{tr("Nothing yet.")}</p>}
          {data.items.map((n) => (
            <button key={n.id} role="menuitem" className={n.readAt ? 'read' : 'unread'} onClick={() => go(n)}>
              <strong>{n.title}</strong>
              {n.body && <span>{n.body}</span>}
              <small>{formatDateTime(n.createdAt)}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Health ---------- */

const BAND: Record<string, string> = { healthy: 'Healthy', watch: 'Watch', at_risk: 'At risk' };
const BAND_STATUS: Record<string, string> = { healthy: 'compliant', watch: 'needs_follow_up', at_risk: 'not_compliant' };

export function HealthBadge({ clientId }: { clientId: string }) {
  const h = useLoad(() => api.clientsHealth(), []).data?.find((x) => x.clientId === clientId);
  if (!h) return null;
  return <span title={h.factors.join(' · ') || tr("No risk factors")}><StatusBadge status={BAND_STATUS[h.band]} label={`Health ${h.score} · ${BAND[h.band]}`} /></span>;
}

export function HealthView() {
  const list = useLoad(() => api.clientsHealth(), []);
  const clientFilter = useClientFilter();
  const rows = (list.data ?? []).filter((r) => matchesClient(clientFilter, r.clientId)).sort((a, b) => a.score - b.score);
  return (
    <ViewFrame title={tr("Account health")} subtitle={tr("Score 0–100 per client from credit, overdue invoices, churn risk, open exceptions and client activity")} crumbs={[{ label: tr("Symphony"), href: '#/symphony' }, { label: tr("Account health") }]}>
      {!list.data && <Loading error={list.error} />}
      {list.data && (
        <>
          <div className="kpi-grid">
            <div className="kpi kpi-emerald"><span>{tr("Healthy")}</span><strong>{rows.filter((r) => r.band === 'healthy').length}</strong></div>
            <div className="kpi kpi-blue"><span>{tr("Watch")}</span><strong>{rows.filter((r) => r.band === 'watch').length}</strong></div>
            <div className="kpi kpi-purple"><span>{tr("At risk")}</span><strong>{rows.filter((r) => r.band === 'at_risk').length}</strong></div>
          </div>
          <table className="grid">
            <thead><tr><th>{tr("Client")}</th><th className="num">{tr("Health")}</th><th>{tr("Band")}</th><th className="num">{tr("Engagement (30 days)")}</th><th>{tr("Why")}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.clientId}>
                  <td><a href={`#/nexus/clients/${r.clientId}`}>{r.name}</a></td>
                  <td className="num"><strong>{r.score}</strong></td>
                  <td><StatusBadge status={BAND_STATUS[r.band]} label={BAND[r.band]} /></td>
                  <td className="num">{r.engagementScore}</td>
                  <td className="small">{r.factors.join(' · ') || tr("No risk factors")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">{tr("Score: 100 minus 40 for a credit lock (15 under review), 10 per overdue invoice (max 30), 15 for churn risk on an active agreement, 10 per open exception (max 20), 15 when active rooms had no client activity in 30 days. Engagement: opened 5, viewed 3, download 10, comment 10, terms accepted 30 points (max 100).")}</p>
        </>
      )}
    </ViewFrame>
  );
}
