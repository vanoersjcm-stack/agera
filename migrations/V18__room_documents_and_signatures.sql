-- Agera Symphony - V18: versioned documents per client room (audit G15/G30/B6) and simple electronic signatures on agreements (G32).

CREATE TABLE room_documents (
    id              UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID           NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    client_room_id  UUID           NOT NULL,
    title           VARCHAR(200)   NOT NULL,
    current_version INT            NOT NULL DEFAULT 1,
    created_by      UUID           REFERENCES users (id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_room_documents_tenant_id_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_room_documents_room FOREIGN KEY (tenant_id, client_room_id)
        REFERENCES digital_sales_rooms (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT chk_room_documents_title_not_blank CHECK (btrim(title) <> ''),
    CONSTRAINT chk_room_documents_version CHECK (current_version >= 1)
);

CREATE INDEX idx_room_documents_room ON room_documents (tenant_id, client_room_id, updated_at DESC);

CREATE TRIGGER trg_room_documents_updated_at
    BEFORE UPDATE ON room_documents
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE room_document_versions (
    id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID           NOT NULL,
    document_id UUID           NOT NULL,
    version     INT            NOT NULL,
    file_name   VARCHAR(255)   NOT NULL,
    mime_type   VARCHAR(150)   NOT NULL,
    size_bytes  INT            NOT NULL,
    sha256      CHAR(64)       NOT NULL,
    storage_key VARCHAR(500)   NOT NULL,
    uploaded_by UUID           REFERENCES users (id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_room_document_versions_document FOREIGN KEY (tenant_id, document_id)
        REFERENCES room_documents (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT uq_room_document_versions UNIQUE (document_id, version),
    CONSTRAINT chk_room_document_versions_size CHECK (size_bytes > 0)
);

CREATE TABLE agreement_signatures (
    id              UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID           NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    agreement_id    UUID           NOT NULL REFERENCES agreements (id) ON DELETE CASCADE,
    client_room_id  UUID           REFERENCES digital_sales_rooms (id) ON DELETE SET NULL,
    signer_name     VARCHAR(200)   NOT NULL,
    signer_email    VARCHAR(255)   NOT NULL,
    image_key       VARCHAR(500)   NOT NULL,
    content_sha256  CHAR(64)       NOT NULL,
    signed_at       TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_agreement_signatures_name_not_blank CHECK (btrim(signer_name) <> '')
);

CREATE INDEX idx_agreement_signatures_agreement ON agreement_signatures (tenant_id, agreement_id, signed_at);

ALTER TABLE room_documents         ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agreement_signatures   ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_room_documents_policy ON room_documents
    FOR ALL
    USING (tenant_id = app_current_tenant() AND app_is_internal())
    WITH CHECK (tenant_id = app_current_tenant() AND app_is_internal());

CREATE POLICY tenant_room_document_versions_policy ON room_document_versions
    FOR ALL
    USING (tenant_id = app_current_tenant() AND app_is_internal())
    WITH CHECK (tenant_id = app_current_tenant() AND app_is_internal());

CREATE POLICY tenant_agreement_signatures_policy ON agreement_signatures
    FOR ALL
    USING (tenant_id = app_current_tenant() AND app_is_internal())
    WITH CHECK (tenant_id = app_current_tenant() AND app_is_internal());

-- Client contacts read the documents of their own active rooms.
CREATE POLICY client_room_documents_read_policy ON room_documents
    FOR SELECT
    USING (
        tenant_id = app_current_tenant()
        AND EXISTS (
            SELECT 1 FROM digital_sales_rooms d
             WHERE d.tenant_id = room_documents.tenant_id AND d.id = room_documents.client_room_id
               AND d.status = 'active' AND app_is_external_client(d.client_id)
        )
    );

CREATE POLICY client_room_document_versions_read_policy ON room_document_versions
    FOR SELECT
    USING (
        tenant_id = app_current_tenant()
        AND EXISTS (
            SELECT 1 FROM room_documents r JOIN digital_sales_rooms d ON d.tenant_id = r.tenant_id AND d.id = r.client_room_id
             WHERE r.tenant_id = room_document_versions.tenant_id AND r.id = room_document_versions.document_id
               AND d.status = 'active' AND app_is_external_client(d.client_id)
        )
    );

-- Client contacts sign and read signatures on their own organisation's agreements.
CREATE POLICY client_agreement_signatures_read_policy ON agreement_signatures
    FOR SELECT
    USING (
        tenant_id = app_current_tenant()
        AND EXISTS (SELECT 1 FROM agreements a WHERE a.id = agreement_signatures.agreement_id AND app_is_external_client(a.client_id))
    );

CREATE POLICY client_agreement_signatures_insert_policy ON agreement_signatures
    FOR INSERT
    WITH CHECK (
        tenant_id = app_current_tenant()
        AND EXISTS (SELECT 1 FROM agreements a WHERE a.id = agreement_signatures.agreement_id AND app_is_external_client(a.client_id))
    );
