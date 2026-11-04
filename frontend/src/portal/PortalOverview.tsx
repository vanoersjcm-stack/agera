import { api } from '../api';
import { AGREEMENT_STATUS } from '../labels';
import { EmptyState, ViewFrame } from '../Layout';
import { Loading, StatusBadge, useLoad } from '../ui';
import { t } from '../i18n';

export function PortalOverview() {
  const rooms = useLoad(() => api.rooms());
  const agreements = useLoad(() => api.agreements());
  if (!rooms.data || !agreements.data) {
    return (
      <ViewFrame title={t("Overview")} crumbs={[{ label: t("Client portal") }]}>
        <Loading error={rooms.error ?? agreements.error} />
      </ViewFrame>
    );
  }
  const empty = rooms.data.length === 0 && agreements.data.length === 0;
  return (
    <ViewFrame title={t("Overview")} crumbs={[{ label: t("Client portal") }]}>
      {empty ? (
        <EmptyState title={t("Nothing shared with you yet")}>{t("As soon as Agera opens a client room or shares an agreement with your organisation, it appears here.")}</EmptyState>
      ) : (
        <>
          <div className="tiles">
            <a className="tile" href="#/portal/rooms">
              <strong>{rooms.data.length}</strong>
              <span>{t("Client rooms")}</span>
            </a>
            <a className="tile" href="#/portal/agreements">
              <strong>{agreements.data.length}</strong>
              <span>{t("Agreements")}</span>
            </a>
          </div>
          <h2 className="section-title">{t("Your client rooms")}</h2>
          <ul className="link-list">
            {rooms.data.map((r) => (
              <li key={r.id}><a href={`#/portal/rooms/${r.id}`}>{r.roomName}</a></li>
            ))}
          </ul>
          <h2 className="section-title">{t("Your agreements")}</h2>
          <ul className="link-list">
            {agreements.data.map((a) => (
              <li key={a.id}>
                <a href={`#/portal/agreements/${a.id}`}>{a.title}</a> <StatusBadge status={a.status} label={AGREEMENT_STATUS[a.status]} />
              </li>
            ))}
          </ul>
        </>
      )}
    </ViewFrame>
  );
}
