-- Agera Symphony - V24: client-bound office documents edited in Collabora Online (LibreOffice) via WOPI.
-- Documents now always belong to a client (client_id, like digital_sales_rooms.client_id, has no foreign key:
-- rooms may name a client id that predates the clients table); a client room becomes optional, so a document can live in the
-- client dossier only. Contact and deal links are optional. Editing locks follow the WOPI protocol.

-- migrate.sh runs each file without a wrapping transaction; keep this update all-or-nothing.
BEGIN;

ALTER TABLE room_documents
    ALTER COLUMN client_room_id DROP NOT NULL,
    ADD COLUMN client_id        UUID,
    ADD COLUMN contact_id       UUID REFERENCES contacts (id) ON DELETE SET NULL,
    ADD COLUMN deal_id          UUID,
    ADD COLUMN file_format      VARCHAR(10),
    ADD COLUMN last_modified_by UUID REFERENCES users (id) ON DELETE SET NULL,
    ADD COLUMN lock_token       VARCHAR(1024),
    ADD COLUMN lock_expires_at  TIMESTAMPTZ(3);

UPDATE room_documents d
   SET client_id = r.client_id
  FROM digital_sales_rooms r
 WHERE r.tenant_id = d.tenant_id AND r.id = d.client_room_id;

UPDATE room_documents d
   SET file_format = lower(substring(v.file_name from '\.([A-Za-z0-9]+)$'))
  FROM room_document_versions v
 WHERE v.document_id = d.id AND v.version = d.current_version;

ALTER TABLE room_documents
    ALTER COLUMN client_id SET NOT NULL,
    ADD CONSTRAINT fk_room_documents_deal FOREIGN KEY (tenant_id, deal_id)
        REFERENCES deals (tenant_id, id) ON DELETE SET NULL (deal_id),
    ADD CONSTRAINT chk_room_documents_lock CHECK ((lock_token IS NULL) = (lock_expires_at IS NULL));

CREATE INDEX idx_room_documents_client ON room_documents (tenant_id, client_id, updated_at DESC);
CREATE INDEX idx_room_documents_contact ON room_documents (tenant_id, contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX idx_room_documents_format ON room_documents (tenant_id, file_format);

COMMIT;
