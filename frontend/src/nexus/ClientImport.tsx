import { useState } from 'react';
import { api, type ClientImportResult, type ImportAction } from '../api';
import { t as tr, tf } from '../i18n';
import { Drawer, ErrorText, Field, StatusBadge, useAction } from '../ui';

const ACTION_LABEL: Record<ImportAction, () => string> = {
  create: () => tr("New client"),
  add_contact: () => tr("Contact added to existing client"),
  skip: () => tr("Skipped (duplicate)"),
  error: () => tr("Error"),
};
const ACTION_STATUS: Record<ImportAction, string> = { create: 'active', add_contact: 'active', skip: 'paused', error: 'rejected' };
const TEMPLATE = 'name;kvkNumber;erpId;vatNumber;sector;address;city;country;paymentTerms;accountManagerEmail;contactFirstName;contactLastName;contactEmail;contactPhone;contactRole\n';

/** Nexus › Clients › Import: upload CSV/XLSX, check the dry-run preview, then confirm. */
export function ClientImportDrawer({ onClose, onImported }: { onClose: () => void; onImported: (message: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ClientImportResult | null>(null);
  const { busy, error, run } = useAction();
  const check = (f: File) => {
    setFile(f);
    setPreview(null);
    void run(() => api.importClients(f, true)).then((r) => r && setPreview(r));
  };
  const confirm = () => {
    if (!file) return;
    void run(() => api.importClients(file, false)).then((r) => r && onImported(tf("Imported {clients} clients and {contacts} contacts", { clients: String(r.summary.clientsCreated), contacts: String(r.summary.contactsAdded) })));
  };
  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`;
  return (
    <Drawer title={tr("Import clients and contacts")} onClose={onClose}>
      <p className="muted">{tr("Upload a CSV or Excel (.xlsx) file with one row per client, optionally with one contact per row. Agera first checks every row; nothing is saved until you confirm.")}</p>
      <p><a href={templateHref} download="agera-client-import.csv">{tr("Download the column template (CSV)")}</a></p>
      <Field label={tr("File")} hint={tr("Duplicates are detected by KvK number, ERP ID and contact e-mail.")}>
        <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => e.target.files?.[0] && check(e.target.files[0])} />
      </Field>
      {busy && <p className="muted">{tr("Checking…")}</p>}
      <ErrorText error={error} />
      {preview && (
        <>
          <p className="callout">
            {tf("{total} rows: {valid} valid, {skipped} skipped, {errors} with errors. This creates {clients} clients and {contacts} contacts.", {
              total: String(preview.summary.total), valid: String(preview.summary.valid), skipped: String(preview.summary.skipped), errors: String(preview.summary.errors),
              clients: String(preview.summary.clientsCreated), contacts: String(preview.summary.contactsAdded),
            })}
          </p>
          {preview.ignoredColumns.length > 0 && <p className="muted small">{tr("Ignored columns")}: {preview.ignoredColumns.join(', ')}</p>}
          <table className="grid">
            <thead><tr><th>{tr("Row")}</th><th>{tr("Result")}</th><th>{tr("Client")}</th><th>{tr("KvK")}</th><th>{tr("ERP ID")}</th><th>{tr("Contact e-mail")}</th><th>{tr("Notes")}</th></tr></thead>
            <tbody>
              {preview.rows.map((r) => (
                <tr key={r.row} className={r.action === 'error' ? 'row-error' : undefined}>
                  <td>{r.row}</td>
                  <td><StatusBadge status={ACTION_STATUS[r.action]} label={ACTION_LABEL[r.action]()} /></td>
                  <td>{r.name ?? '—'}</td><td>{r.kvkNumber ?? '—'}</td><td>{r.erpId ?? '—'}</td><td>{r.contactEmail ?? '—'}</td>
                  <td className="small">{r.messages.join('; ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <div className="form-actions">
        <button type="button" className="secondary" onClick={onClose}>{tr("Cancel")}</button>
        <button type="button" className="primary" disabled={busy || !preview || preview.summary.valid === 0} onClick={confirm}>{tr("Confirm import")}</button>
      </div>
    </Drawer>
  );
}
