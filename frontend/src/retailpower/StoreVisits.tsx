import { useEffect, useRef, useState } from 'react';
import { api, type VisitMedia, type VisitStatus, type VisitSummary } from '../api';
import { useUsers, userName } from '../directory';
import { EditVisitDrawer } from '../EditForms';
import { COMPLIANCE, formatDate, formatDateTime, VISIT_STATUS } from '../labels';
import { EmptyState, ViewFrame } from '../Layout';
import { navigate, type Route, withParams } from '../router';
import { useShell } from '../shell';
import { DetailList, ErrorText, FilterChips, includesText, Loading, SearchInput, StatusBadge, Stepper, useAction, useLoad } from '../ui';

const SUITE_CRUMB = { label: 'RetailPower', href: '#/retailpower' };
const LIST_CRUMB = { label: 'Store visits', href: '#/retailpower/store-visits' };

export function StoreVisitsView({ route }: { route: Route }) {
  const { openNew } = useShell();
  const users = useUsers();
  const status = route.params.get('status') ?? 'upcoming';
  const q = route.params.get('q') ?? '';
  const visits = useLoad(() => api.visits());
  const stores = useLoad(() => api.stores());
  const storeName = (id: string) => stores.data?.items.find((s) => s.id === id)?.name ?? '…';
  const items = visits.data?.items ?? [];
  const count = (s: VisitStatus) => items.filter((v) => v.status === s).length;
  const filtered = items
    .filter(
      (v) =>
        (status === 'all' || (status === 'upcoming' ? v.status === 'PLANNED' || v.status === 'IN_PROGRESS' : v.status === status)) &&
        includesText([storeName(v.storeId), userName(users, v.fieldRepId, ''), v.notes], q),
    )
    .sort((a, b) => (status === 'upcoming' ? a.visitDate.localeCompare(b.visitDate) : b.visitDate.localeCompare(a.visitDate)));
  return (
    <ViewFrame title="Store visits" crumbs={[SUITE_CRUMB, { label: 'Store visits' }]} actions={<button className="primary" onClick={() => openNew('store_visit')}>+ New store visit</button>}>
      <div className="list-toolbar">
        <FilterChips
          value={status}
          onChange={(v) => navigate(withParams(route, { status: v === 'upcoming' ? null : v }))}
          chips={[
            { value: 'upcoming', label: 'Upcoming & ongoing', count: count('PLANNED') + count('IN_PROGRESS') },
            { value: 'PLANNED', label: 'Planned', count: count('PLANNED') },
            { value: 'IN_PROGRESS', label: 'In progress', count: count('IN_PROGRESS') },
            { value: 'COMPLETED', label: 'Completed', count: count('COMPLETED') },
            { value: 'CANCELLED', label: 'Cancelled', count: count('CANCELLED') },
            { value: 'all', label: 'All', count: items.length },
          ]}
        />
        <SearchInput value={q} onChange={(v) => navigate(withParams(route, { q: v }))} placeholder="Filter by store or field representative" />
      </div>
      {!visits.data && <Loading error={visits.error} />}
      {visits.data && filtered.length === 0 && (
        <EmptyState title={items.length === 0 ? 'No store visits yet' : 'No visits match this filter'} action={<button className="primary" onClick={() => openNew('store_visit')}>+ New store visit</button>}>
          {items.length === 0 ? 'Plan a visit to a store; the field representative then writes the report with photos.' : 'Try another status.'}
        </EmptyState>
      )}
      {filtered.length > 0 && (
        <table className="grid clickable">
          <thead>
            <tr>
              <th>Store</th>
              <th>Date</th>
              <th>Status</th>
              <th>Field representative</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((v) => (
              <tr key={v.id} onClick={() => navigate(`/retailpower/store-visits/${v.id}`)}>
                <td><a href={`#/retailpower/store-visits/${v.id}`}>{storeName(v.storeId)}</a></td>
                <td>{formatDateTime(v.visitDate)}</td>
                <td><StatusBadge status={v.status} label={VISIT_STATUS[v.status]} /></td>
                <td>{userName(users, v.fieldRepId)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ViewFrame>
  );
}

function Photo({ media, onDelete }: { media: VisitMedia; onDelete?: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    api.photoBlob(media.url).then((blob) => {
      url = URL.createObjectURL(blob);
      setSrc(url);
    }, () => setSrc(null));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [media.url]);
  return (
    <figure className="photo">
      {src ? <a href={src} target="_blank" rel="noreferrer"><img src={src} alt="Visit photo" /></a> : <div className="photo-placeholder">Loading…</div>}
      <figcaption>
        {formatDateTime(media.createdAt)}
        {onDelete && <button className="link-button danger" onClick={onDelete}>Delete</button>}
      </figcaption>
    </figure>
  );
}

const CHECKLIST = [
  { key: 'shelfStocked', label: 'Shelf fully stocked' },
  { key: 'pricingCorrect', label: 'Price labels correct' },
  { key: 'promoPlaced', label: 'Promotion material placed' },
  { key: 'planogramFollowed', label: 'Shelf layout (planogram) followed' },
] as const;

const COMPLIANCE_CHOICES = [
  { value: 'compliant', label: 'Compliant' },
  { value: 'needs_follow_up', label: 'Needs follow-up' },
  { value: 'not_compliant', label: 'Not compliant' },
];

function ReportStep({ summary, editable, onSaved }: { summary: VisitSummary; editable: boolean; onSaved: () => void }) {
  const { notify } = useShell();
  const report = summary.report;
  const audit = report?.auditData ?? {};
  const savedChecklist = (audit.checklist ?? {}) as Record<string, boolean>;
  const [text, setText] = useState(report?.summary ?? '');
  const [checklist, setChecklist] = useState<Record<string, boolean>>(savedChecklist);
  const [compliance, setCompliance] = useState(typeof audit.complianceStatus === 'string' ? audit.complianceStatus : '');
  const save = useAction();
  const photos = useAction();
  const fileInput = useRef<HTMLInputElement>(null);
  const visitId = summary.visit.id;

  const saveReport = () =>
    void save
      .run(() => api.saveVisitReport(visitId, { summary: text.trim(), auditData: { ...audit, checklist, complianceStatus: compliance } }))
      .then((r) => r && (notify('Visit report saved'), onSaved()));

  const upload = (files: FileList | null) => {
    if (!files?.length) return;
    void photos
      .run(async () => {
        for (const file of Array.from(files)) await api.uploadVisitPhoto(visitId, file);
        return true;
      })
      .then((ok) => {
        if (fileInput.current) fileInput.current.value = '';
        if (ok) (notify(files.length > 1 ? `${files.length} photos added` : 'Photo added'), onSaved());
      });
  };

  const remove = (mediaId: string) =>
    window.confirm('Delete this photo?') && void photos.run(() => api.deleteVisitPhoto(visitId, mediaId)).then((r) => r !== undefined && onSaved());

  return (
    <div className="card-panel">
      <h2>Visit report</h2>
      <fieldset disabled={!editable || save.busy}>
        <label className="field">
          <span className="field-label">Summary</span>
          <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="What did you find in the store?" />
        </label>
        <div className="field">
          <span className="field-label">Checklist</span>
          {CHECKLIST.map((c) => (
            <label key={c.key} className="check-row">
              <input type="checkbox" checked={!!checklist[c.key]} onChange={(e) => setChecklist({ ...checklist, [c.key]: e.target.checked })} />
              {c.label}
            </label>
          ))}
        </div>
        <div className="field" role="radiogroup" aria-label="Compliance result">
          <span className="field-label">Compliance result</span>
          <div className="radio-row">
            {COMPLIANCE_CHOICES.map((c) => (
              <label key={c.value} className={`radio-pill${compliance === c.value ? ' selected' : ''}`}>
                <input type="radio" name="compliance" value={c.value} checked={compliance === c.value} onChange={() => setCompliance(c.value)} />
                {c.label}
              </label>
            ))}
          </div>
          {typeof audit.complianceStatus === 'string' && !COMPLIANCE_CHOICES.some((c) => c.value === audit.complianceStatus) && (
            <span className="field-hint">Imported result: {COMPLIANCE[audit.complianceStatus] ?? audit.complianceStatus}</span>
          )}
          <span className="field-hint">“Not compliant” or “Needs follow-up” raises a store alert in Nexus › Alerts.</span>
        </div>
        {editable && (
          <div className="form-actions start">
            <button className="primary" onClick={saveReport} disabled={!compliance}>{save.busy ? 'Saving…' : report ? 'Update report' : 'Save report'}</button>
            {!compliance && <span className="muted">Choose a compliance result to save.</span>}
          </div>
        )}
      </fieldset>
      <ErrorText error={save.error} />
      <h3>Photos ({summary.media.length})</h3>
      <div className="photos">
        {summary.media.map((m) => (
          <Photo key={m.id} media={m} onDelete={editable ? () => remove(m.id) : undefined} />
        ))}
        {editable && (
          <label className="photo-add">
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => upload(e.target.files)} hidden />
            {photos.busy ? 'Uploading…' : '＋ Add photo'}
          </label>
        )}
      </div>
      <p className="field-hint">JPEG, PNG or WebP, up to 10 MB per photo.</p>
      <ErrorText error={photos.error} />
    </div>
  );
}

export function VisitDossier({ id }: { id: string }) {
  const { notify } = useShell();
  const users = useUsers();
  const summary = useLoad(() => api.visitSummary(id), [id]);
  const [editing, setEditing] = useState(false);
  const stores = useLoad(() => api.stores(), []);
  const workOrder = useLoad(() => (summary.data?.visit.workOrderId ? api.workOrder(summary.data.visit.workOrderId) : Promise.resolve(null)), [summary.data?.visit.workOrderId]);
  const action = useAction();
  const s = summary.data;
  if (!s) {
    return (
      <ViewFrame title="Store visit" crumbs={[SUITE_CRUMB, LIST_CRUMB, { label: 'Loading…' }]}>
        <Loading error={summary.error} />
      </ViewFrame>
    );
  }
  const v = s.visit;
  const store = stores.data?.items.find((x) => x.id === v.storeId);
  const title = `${store?.name ?? 'Store visit'} · ${formatDate(v.visitDate)}`;
  const hasReport = !!s.report && typeof s.report.auditData.complianceStatus === 'string';
  const step = v.status === 'PLANNED' ? 0 : v.status === 'IN_PROGRESS' ? (hasReport ? 2 : 1) : 3;
  const setStatus = (status: VisitStatus, message: string) =>
    void action.run(() => api.setVisitStatus(id, status)).then((r) => r && (notify(message), summary.reload()));
  const cancel = () => window.confirm('Cancel this store visit?') && setStatus('CANCELLED', 'Store visit cancelled');

  return (
    <ViewFrame
      title={title}
      subtitle={<StatusBadge status={v.status} label={VISIT_STATUS[v.status]} />}
      crumbs={[SUITE_CRUMB, LIST_CRUMB, { label: title }]}
      actions={
        (v.status === 'PLANNED' || v.status === 'IN_PROGRESS') && (
          <>
            <button className="secondary" onClick={() => setEditing(true)}>Edit</button>
            <button className="secondary danger" disabled={action.busy} onClick={cancel}>Cancel visit</button>
          </>
        )
      }
    >
      {v.status === 'CANCELLED' ? (
        <p className="callout">This visit was cancelled.</p>
      ) : (
        <Stepper steps={['Planned', 'In progress', 'Visit report', 'Completed']} current={step} />
      )}
      <ErrorText error={action.error} />
      <DetailList
        items={[
          ['Store', store ? <a href={`#/retailpower/stores/${store.id}`}>{store.name} ({store.storeCode})</a> : '…'],
          ['Date and time', formatDateTime(v.visitDate)],
          ['Field representative', userName(users, v.fieldRepId)],
          ['Linked work order', workOrder.data ? <a href={`#/retailpower/work-orders/${workOrder.data.id}`}>{workOrder.data.title}</a> : 'None'],
          ['Notes', v.notes || '—'],
        ]}
      />
      {v.status === 'PLANNED' && (
        <div className="next-step">
          <p>When you arrive at the store, start the visit to write the report and add photos.</p>
          <button className="primary" disabled={action.busy} onClick={() => setStatus('IN_PROGRESS', 'Visit started')}>Start visit</button>
        </div>
      )}
      {v.status !== 'PLANNED' && v.status !== 'CANCELLED' && (
        <ReportStep key={s.report?.updatedAt ?? 'new'} summary={s} editable={v.status === 'IN_PROGRESS'} onSaved={summary.reload} />
      )}
      {v.status === 'IN_PROGRESS' && (
        <div className="next-step">
          <p>{hasReport ? 'The report is saved. Complete the visit when you are done.' : 'Save the report with a compliance result before completing the visit.'}</p>
          <button className="primary" disabled={action.busy || !hasReport} onClick={() => setStatus('COMPLETED', 'Visit completed')}>Complete visit</button>
        </div>
      )}
      {editing && (
        <EditVisitDrawer record={v} onClose={() => setEditing(false)} onSaved={() => (setEditing(false), notify('Store visit updated'), summary.reload())} />
      )}
    </ViewFrame>
  );
}
