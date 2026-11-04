import { type DragEvent, type FormEvent, useState } from 'react';
import { api, type Deal, type DealPriority, type DealRecord, type DealStage } from '../api';
import { useUsers } from '../directory';
import { formatDate, formatDateTime } from '../labels';
import { EmptyState, ViewFrame } from '../Layout';
import { money } from '../nexus/Clients';
import { navigate, type Route, withParams } from '../router';
import { useShell } from '../shell';
import { DetailList, Drawer, ErrorText, Field, FilterChips, FormActions, includesText, Loading, SearchInput, useAction, useLoad } from '../ui';

export const STAGES: DealStage[] = ['lead_ingest', 'proposal_sent', 'contract_negotiation', 'ops_handoff'];
export const DEAL_STAGE: Record<DealStage, string> = {
  lead_ingest: 'New lead',
  proposal_sent: 'Proposal sent',
  contract_negotiation: 'Negotiation',
  ops_handoff: 'Handed to operations',
};
const PRIORITY: Record<DealPriority, string> = { low: 'Low', medium: 'Medium', high: 'High' };
const SUITE = { label: 'Nexus', href: '#/nexus' };

function Priority({ value }: { value: DealPriority }) {
  return <span className={`prio prio-${value}`}>{PRIORITY[value]}</span>;
}

export function PipelineBoard() {
  const { openNew, notify } = useShell();
  const { data, error, reload } = useLoad(() => api.deals());
  const [over, setOver] = useState<DealStage | null>(null);
  const action = useAction();
  const move = (deal: Deal, stage: DealStage) => {
    if (deal.stage === stage) return;
    void action.run(() => api.setDealStage(deal.id, stage)).then((r) => r && (notify(`“${deal.title}” moved to ${DEAL_STAGE[stage]}`), reload()));
  };
  const onDrop = (stage: DealStage) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const deal = data?.find((d) => d.id === e.dataTransfer.getData('text/deal'));
    if (deal) move(deal, stage);
  };
  const deals = data ?? [];
  const total = deals.filter((d) => d.stage !== 'ops_handoff').reduce((sum, d) => sum + Number(d.value), 0);
  return (
    <ViewFrame
      title="Deal pipeline"
      subtitle={data ? `${deals.length} deals · ${money(total)} open pipeline value` : undefined}
      crumbs={[SUITE, { label: 'Pipeline' }]}
      actions={<button className="primary" onClick={() => openNew('deal')}>+ New deal</button>}
    >
      <ErrorText error={action.error} />
      {!data && <Loading error={error} />}
      {data && deals.length === 0 && (
        <EmptyState title="No deals yet" action={<button className="primary" onClick={() => openNew('deal')}>+ New deal</button>}>
          Add a deal for a client, then drag it (or use the arrows) through the stages.
        </EmptyState>
      )}
      {deals.length > 0 && (
        <div className="board">
          {STAGES.map((stage, i) => {
            const column = deals.filter((d) => d.stage === stage);
            return (
              <section
                key={stage}
                className={`board-column${over === stage ? ' drop' : ''}`}
                aria-label={DEAL_STAGE[stage]}
                onDragOver={(e) => (e.preventDefault(), setOver(stage))}
                onDragLeave={() => setOver((s) => (s === stage ? null : s))}
                onDrop={onDrop(stage)}
              >
                <div className="board-head">
                  {DEAL_STAGE[stage]} <span>{column.length} · {money(column.reduce((s, d) => s + Number(d.value), 0))}</span>
                </div>
                {column.map((d) => (
                  <article key={d.id} className="deal-card" draggable onDragStart={(e) => e.dataTransfer.setData('text/deal', d.id)}>
                    <a href={`#/nexus/deals/${d.id}`}>{d.title}</a>
                    <span className="deal-meta">{d.clientName}{d.ownerName ? ` · ${d.ownerName}` : ''}{d.dueDate ? ` · due ${formatDate(d.dueDate)}` : ''}</span>
                    <div className="deal-foot">
                      <span className="deal-value">{money(d.value)}</span>
                      <Priority value={d.priority} />
                      <span className="deal-moves">
                        <button aria-label={`Move ${d.title} back`} disabled={i === 0 || action.busy} onClick={() => move(d, STAGES[i - 1])}>←</button>
                        <button aria-label={`Move ${d.title} forward`} disabled={i === STAGES.length - 1 || action.busy} onClick={() => move(d, STAGES[i + 1])}>→</button>
                      </span>
                    </div>
                  </article>
                ))}
              </section>
            );
          })}
        </div>
      )}
    </ViewFrame>
  );
}

export function DealsView({ route }: { route: Route }) {
  const { openNew } = useShell();
  const stage = route.params.get('stage') ?? 'all';
  const q = route.params.get('q') ?? '';
  const { data, error } = useLoad(() => api.deals());
  const items = data ?? [];
  const filtered = items.filter((d) => (stage === 'all' || d.stage === stage) && includesText([d.title, d.clientName, d.ownerName], q));
  return (
    <ViewFrame title="All deals" crumbs={[SUITE, { label: 'All deals' }]} actions={<button className="primary" onClick={() => openNew('deal')}>+ New deal</button>}>
      <div className="list-toolbar">
        <FilterChips
          value={stage}
          onChange={(v) => navigate(withParams(route, { stage: v === 'all' ? null : v }))}
          chips={[{ value: 'all', label: 'All', count: items.length }, ...STAGES.map((s) => ({ value: s, label: DEAL_STAGE[s], count: items.filter((d) => d.stage === s).length }))]}
        />
        <SearchInput value={q} onChange={(v) => navigate(withParams(route, { q: v }))} placeholder="Filter by deal, client or owner" />
      </div>
      {!data && <Loading error={error} />}
      {data && filtered.length === 0 && <EmptyState title={items.length === 0 ? 'No deals yet' : 'No deals match this filter'} />}
      {filtered.length > 0 && (
        <table className="grid clickable">
          <thead><tr><th>Deal</th><th>Client</th><th>Stage</th><th>Owner</th><th>Priority</th><th>Expected close</th><th className="num">Value</th></tr></thead>
          <tbody>
            {filtered.map((d) => (
              <tr key={d.id} onClick={() => navigate(`/nexus/deals/${d.id}`)}>
                <td><a href={`#/nexus/deals/${d.id}`}>{d.title}</a></td>
                <td>{d.clientName}</td>
                <td>{DEAL_STAGE[d.stage]}</td>
                <td>{d.ownerName ?? <span className="muted">Not assigned</span>}</td>
                <td><Priority value={d.priority} /></td>
                <td>{d.dueDate ? formatDate(d.dueDate) : '—'}</td>
                <td className="num">{money(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ViewFrame>
  );
}

function EditDealDrawer({ deal, onClose, onSaved }: { deal: DealRecord; onClose: () => void; onSaved: () => void }) {
  const users = useUsers();
  const rooms = useLoad(() => api.rooms());
  const [form, setForm] = useState({
    title: deal.title,
    value: deal.value,
    priority: deal.priority,
    ownerId: deal.ownerId ?? '',
    dueDate: deal.dueDate ?? '',
    clientRoomId: deal.clientRoomId ?? '',
    notes: deal.notes ?? '',
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const { busy, error, run } = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(() =>
      api.updateDeal(deal.id, {
        title: form.title.trim(),
        value: form.value || '0',
        priority: form.priority,
        ownerId: form.ownerId || null,
        dueDate: form.dueDate || null,
        clientRoomId: form.clientRoomId || null,
        notes: form.notes.trim() || null,
      }),
    ).then((r) => r && onSaved());
  };
  return (
    <Drawer title="Edit deal" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Deal name"><input required maxLength={200} value={form.title} onChange={set('title')} autoFocus /></Field>
        <div className="field-row">
          <Field label="Value (EUR)"><input type="number" min={0} step="0.01" value={form.value} onChange={set('value')} /></Field>
          <Field label="Priority">
            <select value={form.priority} onChange={set('priority')}>
              {(Object.keys(PRIORITY) as DealPriority[]).map((p) => <option key={p} value={p}>{PRIORITY[p]}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Owner">
          <select value={form.ownerId} onChange={set('ownerId')}>
            <option value="">Not assigned</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        <Field label="Expected close date"><input type="date" value={form.dueDate} onChange={set('dueDate')} /></Field>
        <Field label="Client room" hint="Link the room where the client follows this deal">
          <select value={form.clientRoomId} onChange={set('clientRoomId')}>
            <option value="">None</option>
            {(rooms.data ?? []).filter((r) => r.clientId === deal.clientId).map((r) => <option key={r.id} value={r.id}>{r.roomName}</option>)}
          </select>
        </Field>
        <Field label="Notes"><textarea rows={4} value={form.notes} onChange={set('notes')} /></Field>
        <ErrorText error={error} />
        <FormActions busy={busy} submitLabel="Save changes" onCancel={onClose} />
      </form>
    </Drawer>
  );
}

export function DealDossier({ id }: { id: string }) {
  const { notify } = useShell();
  const { data, error, reload } = useLoad(() => api.deal(id), [id]);
  const [editing, setEditing] = useState(false);
  const action = useAction();
  if (!data) {
    return (
      <ViewFrame title="Deal" crumbs={[SUITE, { label: 'All deals', href: '#/nexus/deals' }, { label: 'Loading…' }]}>
        <Loading error={error} />
      </ViewFrame>
    );
  }
  const d = data;
  const remove = () => {
    if (!window.confirm(`Delete the deal “${d.title}”? This cannot be undone.`)) return;
    void action.run(() => api.deleteDeal(id)).then((r) => r !== undefined && (notify('Deal deleted'), navigate('/nexus/pipeline')));
  };
  return (
    <ViewFrame
      title={d.title}
      subtitle={`${d.clientName} · ${DEAL_STAGE[d.stage]}`}
      crumbs={[SUITE, { label: 'All deals', href: '#/nexus/deals' }, { label: d.title }]}
      actions={
        <>
          <label className="inline-select">
            Stage{' '}
            <select aria-label="Stage" value={d.stage} disabled={action.busy} onChange={(e) => void action.run(() => api.setDealStage(id, e.target.value as DealStage)).then((r) => r && (notify('Stage updated'), reload()))}>
              {STAGES.map((s) => <option key={s} value={s}>{DEAL_STAGE[s]}</option>)}
            </select>
          </label>
          <button className="secondary" onClick={() => setEditing(true)}>Edit</button>
          <button className="secondary danger" disabled={action.busy} onClick={remove}>Delete</button>
        </>
      }
    >
      <ErrorText error={action.error} />
      <DetailList
        items={[
          ['Client', <a key="c" href={`#/nexus/clients/${d.clientId}`}>{d.clientName}</a>],
          ['Value', money(d.value)],
          ['Priority', <Priority key="p" value={d.priority} />],
          ['Owner', d.ownerName ?? 'Not assigned'],
          ['Expected close', d.dueDate ? formatDate(d.dueDate) : '—'],
          ['Client room', d.clientRoomId ? <a key="r" href={`#/nexus/client-rooms/${d.clientRoomId}`}>{d.clientRoomName}</a> : 'None linked'],
          ['Notes', d.notes ?? '—'],
          ['Created', formatDate(d.createdAt)],
        ]}
      />
      <div className="card-panel">
        <h2>Stage history</h2>
        <ul className="timeline">
          {d.history.map((h) => (
            <li key={h.id}>
              <strong>{h.fromStage ? `${DEAL_STAGE[h.fromStage]} → ${DEAL_STAGE[h.toStage]}` : `Created in ${DEAL_STAGE[h.toStage]}`}</strong>
              <span className="muted"> · {h.changedByName ?? 'Unknown'} · {formatDateTime(h.changedAt)}</span>
            </li>
          ))}
        </ul>
      </div>
      {editing && <EditDealDrawer deal={d} onClose={() => setEditing(false)} onSaved={() => (setEditing(false), notify('Deal updated'), reload())} />}
    </ViewFrame>
  );
}
