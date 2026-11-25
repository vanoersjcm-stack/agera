import { matchesClient, useClientFilter } from '../clientFilter';
import { type DragEvent, type FormEvent, useState } from 'react';
import { api, type Deal, type DealPriority, type DealRecord, type DealStage } from '../api';
import { useUsers } from '../directory';
import { formatDate, formatDateTime } from '../labels';
import { EmptyState, ViewFrame } from '../Layout';
import { money } from '../nexus/Clients';
import { navigate, type Route, withParams } from '../router';
import { useShell } from '../shell';
import { DetailList, Drawer, ErrorText, Field, FilterChips, FormActions, includesText, Loading, SearchInput, useAction, useLoad } from '../ui';
import { t, tf, live } from '../i18n';

export const STAGES: DealStage[] = ['lead_ingest', 'proposal_sent', 'contract_negotiation', 'ops_handoff'];
export const DEAL_STAGE: Record<DealStage, string> = {
  lead_ingest: 'New lead',
  proposal_sent: 'Proposal sent',
  contract_negotiation: 'Negotiation',
  ops_handoff: 'Handed to operations',
};
const PRIORITY: Record<DealPriority, string> = { low: 'Low', medium: 'Medium', high: 'High' };
const SUITE = live(() => ({ label: t("Nexus"), href: '#/nexus' }));

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
    void action.run(() => api.setDealStage(deal.id, stage)).then((r) => r && (notify(tf("“{title}” moved to {stage}", { title: deal.title, stage: DEAL_STAGE[stage] })), reload()));
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
      title={t("Deal pipeline")}
      subtitle={data ? tf("{n} deals · {value} open pipeline value", { n: deals.length, value: money(total) }) : undefined}
      crumbs={[SUITE, { label: t("Pipeline") }]}
      actions={<button className="primary" onClick={() => openNew('deal')}>{t("+ New deal")}</button>}
    >
      <ErrorText error={action.error} />
      {!data && <Loading error={error} />}
      {data && deals.length === 0 && (
        <EmptyState title={t("No deals yet")} action={<button className="primary" onClick={() => openNew('deal')}>{t("+ New deal")}</button>}>
          {t("Add a deal for a client, then drag it (or use the arrows) through the stages.")}</EmptyState>
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
                <div className="board-cards">
                {column.map((d) => (
                  <article key={d.id} className="deal-card" draggable onDragStart={(e) => e.dataTransfer.setData('text/deal', d.id)}>
                    <a href={`#/nexus/deals/${d.id}`}>{d.title}</a>
                    <span className="deal-meta">{d.clientName}{d.ownerName ? ` · ${d.ownerName}` : ''}{d.dueDate ? ` · due ${formatDate(d.dueDate)}` : ''}</span>
                    <div className="deal-foot">
                      <span className="deal-value">{money(d.value)}</span>
                      <Priority value={d.priority} />
                      <span className="deal-moves">
                        <button aria-label={tf("Move {title} back", { title: d.title })} disabled={i === 0 || action.busy} onClick={() => move(d, STAGES[i - 1])}>←</button>
                        <button aria-label={tf("Move {title} forward", { title: d.title })} disabled={i === STAGES.length - 1 || action.busy} onClick={() => move(d, STAGES[i + 1])}>→</button>
                      </span>
                    </div>
                  </article>
                ))}
                </div>
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
  const clientFilter = useClientFilter();
  const filtered = items.filter((x) => matchesClient(clientFilter, x.clientId)).filter((d) => (stage === 'all' || d.stage === stage) && includesText([d.title, d.clientName, d.ownerName], q));
  return (
    <ViewFrame title={t("All deals")} crumbs={[SUITE, { label: t("All deals") }]} actions={<button className="primary" onClick={() => openNew('deal')}>{t("+ New deal")}</button>}>
      <div className="list-toolbar">
        <FilterChips
          value={stage}
          onChange={(v) => navigate(withParams(route, { stage: v === 'all' ? null : v }))}
          chips={[{ value: 'all', label: t("All"), count: items.length }, ...STAGES.map((s) => ({ value: s, label: DEAL_STAGE[s], count: items.filter((d) => d.stage === s).length }))]}
        />
        <SearchInput value={q} onChange={(v) => navigate(withParams(route, { q: v }))} placeholder={t("Filter by deal, client or owner")} />
      </div>
      {!data && <Loading error={error} />}
      {data && filtered.length === 0 && <EmptyState title={items.length === 0 ? t("No deals yet") : t("No deals match this filter")} />}
      {filtered.length > 0 && (
        <table className="grid clickable">
          <thead><tr><th>{t("Deal")}</th><th>{t("Client")}</th><th>{t("Stage")}</th><th>{t("Owner")}</th><th>{t("Priority")}</th><th>{t("Expected close")}</th><th className="num">{t("Value")}</th></tr></thead>
          <tbody>
            {filtered.map((d) => (
              <tr key={d.id} onClick={() => navigate(`/nexus/deals/${d.id}`)}>
                <td><a href={`#/nexus/deals/${d.id}`}>{d.title}</a></td>
                <td>{d.clientName}</td>
                <td>{DEAL_STAGE[d.stage]}</td>
                <td>{d.ownerName ?? <span className="muted">{t("Not assigned")}</span>}</td>
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
    <Drawer title={t("Edit deal")} onClose={onClose}>
      <form onSubmit={submit}>
        <Field label={t("Deal name")}><input required maxLength={200} value={form.title} onChange={set('title')} autoFocus /></Field>
        <div className="field-row">
          <Field label={t("Value (EUR)")}><input type="number" min={0} step="0.01" value={form.value} onChange={set('value')} /></Field>
          <Field label={t("Priority")}>
            <select value={form.priority} onChange={set('priority')}>
              {(Object.keys(PRIORITY) as DealPriority[]).map((p) => <option key={p} value={p}>{PRIORITY[p]}</option>)}
            </select>
          </Field>
        </div>
        <Field label={t("Owner")}>
          <select value={form.ownerId} onChange={set('ownerId')}>
            <option value="">{t("Not assigned")}</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        <Field label={t("Expected close date")}><input type="date" value={form.dueDate} onChange={set('dueDate')} /></Field>
        <Field label={t("Client room")} hint={t("Link the room where the client follows this deal")}>
          <select value={form.clientRoomId} onChange={set('clientRoomId')}>
            <option value="">{t("None")}</option>
            {(rooms.data ?? []).filter((r) => r.clientId === deal.clientId).map((r) => <option key={r.id} value={r.id}>{r.roomName}</option>)}
          </select>
        </Field>
        <Field label={t("Notes")}><textarea rows={4} value={form.notes} onChange={set('notes')} /></Field>
        <ErrorText error={error} />
        <FormActions busy={busy} submitLabel={t("Save changes")} onCancel={onClose} />
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
      <ViewFrame title={t("Deal")} crumbs={[SUITE, { label: t("All deals"), href: '#/nexus/deals' }, { label: t("Loading…") }]}>
        <Loading error={error} />
      </ViewFrame>
    );
  }
  const d = data;
  const remove = () => {
    if (!window.confirm(tf("Delete the deal “{title}”? This cannot be undone.", { title: d.title }))) return;
    void action.run(() => api.deleteDeal(id)).then((r) => r !== undefined && (notify(t("Deal deleted")), navigate('/nexus/pipeline')));
  };
  return (
    <ViewFrame
      title={d.title}
      subtitle={`${d.clientName} · ${DEAL_STAGE[d.stage]}`}
      crumbs={[SUITE, { label: t("All deals"), href: '#/nexus/deals' }, { label: d.title }]}
      actions={
        <>
          <label className="inline-select">
            {t("Stage")}{' '}
            <select aria-label={t("Stage")} value={d.stage} disabled={action.busy} onChange={(e) => void action.run(() => api.setDealStage(id, e.target.value as DealStage)).then((r) => r && (notify(t("Stage updated")), reload()))}>
              {STAGES.map((s) => <option key={s} value={s}>{DEAL_STAGE[s]}</option>)}
            </select>
          </label>
          <button className="secondary" onClick={() => setEditing(true)}>{t("Edit")}</button>
          <button className="secondary danger" disabled={action.busy} onClick={remove}>{t("Delete")}</button>
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
      <DealProposal deal={d} onSaved={reload} />
      <DealNegotiation deal={d} onSaved={reload} />
      <DealHandover deal={d} onSaved={reload} />
      <div className="card-panel">
        <h2>{t("Stage history")}</h2>
        <ul className="timeline">
          {d.history.map((h) => (
            <li key={h.id}>
              <strong>{h.fromStage ? `${DEAL_STAGE[h.fromStage]} → ${DEAL_STAGE[h.toStage]}` : tf("Created in {stage}", { stage: DEAL_STAGE[h.toStage] })}</strong>
              <span className="muted"> · {h.changedByName ?? t("Unknown")} · {formatDateTime(h.changedAt)}</span>
            </li>
          ))}
        </ul>
      </div>
      {editing && <EditDealDrawer deal={d} onClose={() => setEditing(false)} onSaved={() => (setEditing(false), notify(t("Deal updated")), reload())} />}
    </ViewFrame>
  );
}

function DealProposal({ deal, onSaved }: { deal: DealRecord; onSaved: () => void }) {
  const { notify } = useShell();
  const action = useAction();
  const rooms = useLoad(() => api.rooms(), []);
  const [roomId, setRoomId] = useState(deal.clientRoomId ?? '');
  const docs = useLoad(() => (roomId ? api.roomDocuments(roomId) : Promise.resolve([])), [roomId]);
  const [docId, setDocId] = useState(deal.proposalDocumentId ?? '');
  const clientRooms = (rooms.data ?? []).filter((r) => r.clientId === deal.clientId);
  const send = () => void action.run(() => api.dealProposalSent(deal.id, docId || null)).then((r) => r && (notify(t("Proposal marked as sent")), onSaved()));
  return (
    <div className="card-panel">
      <h2>{t("Proposal")}</h2>
      {deal.proposalSentAt && (
        <p>{tf("Sent on {date}", { date: formatDateTime(deal.proposalSentAt) })}{deal.proposalDocumentTitle ? ` · ${deal.proposalDocumentTitle}` : ''}</p>
      )}
      <p className="muted">{t("Link the Agera.text or Agera.email proposal from the client room. The deal then moves to Proposal sent.")}</p>
      <div className="deal-form">
        <label>{t("Client room")}{' '}
          <select value={roomId} onChange={(e) => (setRoomId(e.target.value), setDocId(''))}>
            <option value="">{t("Choose a client room…")}</option>
            {clientRooms.map((r) => <option key={r.id} value={r.id}>{r.roomName}</option>)}
          </select>
        </label>
        <label>{t("Proposal document")}{' '}
          <select value={docId} onChange={(e) => setDocId(e.target.value)} disabled={!roomId}>
            <option value="">{t("No document")}</option>
            {(docs.data ?? []).map((doc) => <option key={doc.id} value={doc.id}>{doc.title}</option>)}
          </select>
        </label>
        <button type="button" className="primary" disabled={action.busy} onClick={send}>{t("Mark proposal sent")}</button>
      </div>
      <ErrorText error={action.error} />
    </div>
  );
}

const NOTE_KIND: Record<DealRecord['negotiation'][number]['kind'], string> = live(() => ({ note: t("Note"), counter_offer: t("Counter-offer from client"), our_offer: t("Our offer") }));

function DealNegotiation({ deal, onSaved }: { deal: DealRecord; onSaved: () => void }) {
  const action = useAction();
  const [kind, setKind] = useState<DealRecord['negotiation'][number]['kind']>('note');
  const [body, setBody] = useState('');
  const [amountText, setAmount] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void action.run(() => api.addDealNote(deal.id, { kind, body, amount: kind === 'note' ? null : amountText || null })).then((r) => r && (setBody(''), setAmount(''), onSaved()));
  };
  return (
    <div className="card-panel">
      <h2>{t("Negotiation")}</h2>
      <p>{t("Contract value (annual)")}: <strong>{money(deal.value)}</strong></p>
      <form className="deal-form" onSubmit={submit}>
        <select aria-label={t("Type")} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          {(Object.keys(NOTE_KIND) as (typeof kind)[]).map((k) => <option key={k} value={k}>{NOTE_KIND[k]}</option>)}
        </select>
        {kind !== 'note' && <input aria-label={t("Amount (excl. VAT)")} placeholder={t("Amount (excl. VAT)")} inputMode="decimal" value={amountText} onChange={(e) => setAmount(e.target.value)} />}
        <input aria-label={t("Note")} placeholder={t("What was discussed or offered?")} required value={body} onChange={(e) => setBody(e.target.value)} />
        <button type="submit" className="primary" disabled={action.busy}>{t("Add to log")}</button>
      </form>
      <ErrorText error={action.error} />
      {deal.negotiation.length === 0 ? <p className="muted">{t("No negotiation notes yet.")}</p> : (
        <ul className="timeline">
          {deal.negotiation.map((n) => (
            <li key={n.id}>
              <strong>{NOTE_KIND[n.kind]}{n.amount ? ` · ${money(n.amount)}` : ''}</strong> {n.body}
              <span className="muted"> · {n.createdByName ?? t("Unknown")} · {formatDateTime(n.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const DEFAULT_STEPS = live(() => [t("Confirm scope and store list with the client"), t("Plan the first store visits"), t("Brief the field team"), t("Set up price list and invoicing"), t("Kick-off meeting with the client")]);

function DealHandover({ deal, onSaved }: { deal: DealRecord; onSaved: () => void }) {
  const { notify } = useShell();
  const action = useAction();
  const [open, setOpen] = useState(false);
  const users = useUsers();
  const client = useLoad(() => (open ? api.client(deal.clientId) : Promise.resolve(null)), [open, deal.clientId]);
  const [coordinatorId, setCoordinatorId] = useState('');
  const [steps, setSteps] = useState('');
  const coordinators = users.filter((u) => u.jobRole === 'HQ_ADMIN');
  const start = () => (setSteps(DEFAULT_STEPS.join('\n')), setOpen(true));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const items = steps.split('\n').map((s) => s.trim()).filter(Boolean);
    void action.run(() => api.dealHandover(deal.id, { coordinatorId, items })).then((r) => r && (setOpen(false), notify(t("Handed over to operations")), onSaved()));
  };
  const c = client.data;
  return (
    <div className="card-panel">
      <h2>{t("Handover to operations")}</h2>
      {deal.handedOverAt ? (
        <p>{tf("Handed over on {date} to {name}", { date: formatDateTime(deal.handedOverAt), name: deal.opsCoordinatorName ?? '—' })}</p>
      ) : <p className="muted">{t("When the deal is won, hand it to an operations coordinator with the signed agreement, the approved financial plan and the stores.")}</p>}
      {deal.onboarding.length > 0 && (
        <ul className="checklist">
          {deal.onboarding.map((i) => (
            <li key={i.id}>
              <label className="inline-label">
                <input type="checkbox" checked={!!i.doneAt} disabled={action.busy} onChange={(e) => void action.run(() => api.dealOnboarding(deal.id, i.id, e.target.checked)).then((r) => r && onSaved())} /> {i.title}
              </label>
              {i.doneAt && <span className="muted"> · {i.doneByName ?? ''} · {formatDateTime(i.doneAt)}</span>}
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="secondary" onClick={start}>{deal.handedOverAt ? t("Hand over again") : t("Hand over to operations")}</button>
      {open && (
        <Drawer title={t("Handover to operations")} onClose={() => setOpen(false)}>
          <form onSubmit={submit}>
            {!c ? <Loading error={client.error} /> : (
              <>
                <h3>{t("Signed agreements")}</h3>
                {c.agreements.length === 0 ? <p className="muted">{t("None")}</p> : <ul>{c.agreements.map((a) => <li key={a.id}><a href={`#/nexus/agreements/${a.id}`}>{a.title}</a> <span className="muted">· {a.status}</span></li>)}</ul>}
                <h3>{t("Financial plans")}</h3>
                {c.plans.length === 0 ? <p className="muted">{t("None")}</p> : <ul>{c.plans.map((p) => <li key={p.id}>{p.modelName} {p.fiscalYear} <span className="muted">· {p.status}</span></li>)}</ul>}
                <h3>{tf("Stores ({count})", { count: c.stores.length })}</h3>
                {c.stores.length === 0 ? <p className="muted">{t("None")}</p> : <ul>{c.stores.slice(0, 20).map((s) => <li key={s.id}>{s.storeCode} · {s.name}{s.city ? `, ${s.city}` : ''}</li>)}</ul>}
              </>
            )}
            <Field label={t("Operations coordinator")}>
              <select required value={coordinatorId} onChange={(e) => setCoordinatorId(e.target.value)}>
                <option value="">{t("Choose a coordinator…")}</option>
                {coordinators.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
            <Field label={t("Onboarding checklist (one step per line)")}>
              <textarea rows={6} value={steps} onChange={(e) => setSteps(e.target.value)} />
            </Field>
            <ErrorText error={action.error} />
            <FormActions busy={action.busy} submitLabel={t("Hand over")} onCancel={() => setOpen(false)} />
          </form>
        </Drawer>
      )}
    </div>
  );
}
