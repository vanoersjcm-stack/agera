-- Agera Symphony - V8: agreements, Digital Sales Rooms, external-client row-level security and
-- the Nexus operational anomaly view.
--
-- Access scope: besides `app.current_tenant`, the backend sets two transaction-local settings:
--   app.access_scope   'internal' (tenant staff) or 'external' (Keycloak role External_Client)
--   app.current_client the external user's client_id claim (empty for internal users)
-- Internal users see all rows of their tenant. External users only read their own agreements,
-- their own active rooms and the activities in those rooms, and may only record activities in
-- those rooms. Any other value, or no value at all, matches no rows (fail closed).

BEGIN;

CREATE OR REPLACE FUNCTION app_access_scope()
RETURNS TEXT
LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('app.access_scope', true), '') $$;

CREATE OR REPLACE FUNCTION app_current_client()
RETURNS UUID
LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('app.current_client', true), '')::UUID $$;

CREATE OR REPLACE FUNCTION app_is_internal()
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$ SELECT COALESCE(app_access_scope() = 'internal', false) $$;

CREATE OR REPLACE FUNCTION app_is_external_client(row_client_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$ SELECT COALESCE(app_access_scope() = 'external' AND row_client_id = app_current_client(), false) $$;

-- Agreements -----------------------------------------------------------------------------------
-- client_id identifies the external client/retailer/brand partner (the client_id claim of its
-- Keycloak users); there is no client table, so it is not a foreign key.

CREATE TABLE agreements (
    id           UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID           NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    client_id    UUID           NOT NULL,
    title        VARCHAR(200)   NOT NULL,
    status       VARCHAR(30)    NOT NULL DEFAULT 'pending_approval',
    document_url VARCHAR(500)   NOT NULL,
    created_at   TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_agreements_tenant_id_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_agreements_tenant_client_id UNIQUE (tenant_id, client_id, id),
    CONSTRAINT chk_agreements_status CHECK (status IN ('pending_approval', 'active', 'expired')),
    CONSTRAINT chk_agreements_title_not_blank CHECK (btrim(title) <> ''),
    CONSTRAINT chk_agreements_document_url_not_blank CHECK (btrim(document_url) <> '')
);

CREATE INDEX idx_agreements_tenant_client ON agreements (tenant_id, client_id, created_at);

CREATE TRIGGER trg_agreements_updated_at
    BEFORE UPDATE ON agreements
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Digital Sales Rooms ----------------------------------------------------------------------------
-- A room's agreement must belong to the same tenant and the same client.

CREATE TABLE digital_sales_rooms (
    id           UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID           NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    client_id    UUID           NOT NULL,
    agreement_id UUID,
    room_name    VARCHAR(150)   NOT NULL,
    status       VARCHAR(30)    NOT NULL DEFAULT 'active',
    created_at   TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_digital_sales_rooms_tenant_id_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_digital_sales_rooms_agreement FOREIGN KEY (tenant_id, client_id, agreement_id)
        REFERENCES agreements (tenant_id, client_id, id) ON DELETE SET NULL (agreement_id),
    CONSTRAINT chk_digital_sales_rooms_status CHECK (status IN ('active', 'archived')),
    CONSTRAINT chk_digital_sales_rooms_name_not_blank CHECK (btrim(room_name) <> '')
);

CREATE INDEX idx_digital_sales_rooms_tenant_client ON digital_sales_rooms (tenant_id, client_id, created_at);
CREATE INDEX idx_digital_sales_rooms_agreement ON digital_sales_rooms (tenant_id, client_id, agreement_id);

CREATE TRIGGER trg_digital_sales_rooms_updated_at
    BEFORE UPDATE ON digital_sales_rooms
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Row-level security -------------------------------------------------------------------------------
-- Permissive policies are OR-ed: internal staff get full tenant access, external clients get the
-- narrow read (and activity insert) policies below.

ALTER TABLE agreements          ENABLE ROW LEVEL SECURITY;
ALTER TABLE digital_sales_rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_agreements_policy ON agreements
    FOR ALL
    USING (tenant_id = app_current_tenant() AND app_is_internal())
    WITH CHECK (tenant_id = app_current_tenant() AND app_is_internal());

CREATE POLICY client_agreements_read_policy ON agreements
    FOR SELECT
    USING (tenant_id = app_current_tenant() AND app_is_external_client(client_id));

CREATE POLICY tenant_dsr_policy ON digital_sales_rooms
    FOR ALL
    USING (tenant_id = app_current_tenant() AND app_is_internal())
    WITH CHECK (tenant_id = app_current_tenant() AND app_is_internal());

CREATE POLICY client_dsr_read_policy ON digital_sales_rooms
    FOR SELECT
    USING (tenant_id = app_current_tenant() AND app_is_external_client(client_id) AND status = 'active');

-- V6 tables: financials and voice events become internal-only; DSR activities are additionally
-- readable/insertable by the external client that owns the (active) room.

DROP POLICY tenant_financial_models_policy ON financial_models;
CREATE POLICY tenant_financial_models_policy ON financial_models
    FOR ALL
    USING (tenant_id = app_current_tenant() AND app_is_internal())
    WITH CHECK (tenant_id = app_current_tenant() AND app_is_internal());

DROP POLICY tenant_financial_line_items_policy ON financial_line_items;
CREATE POLICY tenant_financial_line_items_policy ON financial_line_items
    FOR ALL
    USING (tenant_id = app_current_tenant() AND app_is_internal())
    WITH CHECK (tenant_id = app_current_tenant() AND app_is_internal());

DROP POLICY tenant_nexus_voice_events_policy ON nexus_voice_events;
CREATE POLICY tenant_nexus_voice_events_policy ON nexus_voice_events
    FOR ALL
    USING (tenant_id = app_current_tenant() AND app_is_internal())
    WITH CHECK (tenant_id = app_current_tenant() AND app_is_internal());

DROP POLICY tenant_dsr_activities_policy ON dsr_activities;
CREATE POLICY tenant_dsr_activities_policy ON dsr_activities
    FOR ALL
    USING (tenant_id = app_current_tenant() AND app_is_internal())
    WITH CHECK (tenant_id = app_current_tenant() AND app_is_internal());

CREATE POLICY client_dsr_activities_read_policy ON dsr_activities
    FOR SELECT
    USING (
        tenant_id = app_current_tenant()
        AND EXISTS (
            SELECT 1 FROM digital_sales_rooms d
             WHERE d.tenant_id = dsr_activities.tenant_id AND d.id = dsr_activities.dsr_id
               AND d.status = 'active' AND app_is_external_client(d.client_id)
        )
    );

CREATE POLICY client_dsr_activities_insert_policy ON dsr_activities
    FOR INSERT
    WITH CHECK (
        tenant_id = app_current_tenant()
        AND EXISTS (
            SELECT 1 FROM digital_sales_rooms d
             WHERE d.tenant_id = dsr_activities.tenant_id AND d.id = dsr_activities.dsr_id
               AND d.status = 'active' AND app_is_external_client(d.client_id)
        )
    );

-- Operational anomalies --------------------------------------------------------------------------
-- financial_variance: a line of an approved model whose actuals are unfavourable by more than 10%
--   of the projection (revenue/license_fee below projection, cogs/opex above projection).
-- dsr_stagnation: an active room without stakeholder interaction (opened, zone_viewed,
--   briefing_played) for more than 7 days; rooms without any interaction count from creation.
-- security_invoker makes the view apply the caller's row-level security, not the owner's.

CREATE VIEW nexus_operational_anomalies WITH (security_invoker = true) AS
SELECT li.tenant_id,
       'financial_variance'::VARCHAR(30) AS anomaly_type,
       li.id AS source_id,
       format('P&L variance exceeded 10%%: %s %s %s %s (%s%%)',
              li.category, li.period_code, li.variance, li.currency,
              round(li.variance * 100 / li.projected_amount, 1)) AS description,
       li.updated_at AS observed_at,
       jsonb_build_object(
           'modelId', li.model_id,
           'modelName', m.model_name,
           'category', li.category,
           'periodCode', li.period_code,
           'currency', li.currency,
           'projectedAmount', li.projected_amount::text,
           'actualAmount', li.actual_amount::text,
           'variance', li.variance::text,
           'variancePercent', round(li.variance * 100 / li.projected_amount, 2)
       ) AS details,
       li.created_at
  FROM financial_line_items li
  JOIN financial_models m ON m.tenant_id = li.tenant_id AND m.id = li.model_id
 WHERE m.status = 'approved'
   AND li.actual_amount IS NOT NULL
   AND li.projected_amount > 0
   AND (
        (li.category IN ('revenue', 'license_fee') AND li.variance < -0.10 * li.projected_amount)
     OR (li.category IN ('cogs', 'opex') AND li.variance > 0.10 * li.projected_amount)
   )

UNION ALL

SELECT d.tenant_id,
       'dsr_stagnation'::VARCHAR(30) AS anomaly_type,
       d.id AS source_id,
       format('DSR inactive for > 7 days: %s', d.room_name) AS description,
       COALESCE(last.at, d.created_at) AS observed_at,
       jsonb_build_object(
           'roomName', d.room_name,
           'clientId', d.client_id,
           'agreementId', d.agreement_id,
           'lastInteractionAt', last.at,
           'daysInactive', floor(EXTRACT(EPOCH FROM NOW() - COALESCE(last.at, d.created_at)) / 86400)::int
       ) AS details,
       d.created_at
  FROM digital_sales_rooms d
  LEFT JOIN LATERAL (
        SELECT MAX(a.created_at) AS at
          FROM dsr_activities a
         WHERE a.tenant_id = d.tenant_id AND a.dsr_id = d.id
           AND a.activity_type IN ('opened', 'zone_viewed', 'briefing_played')
       ) last ON true
 WHERE d.status = 'active'
   AND COALESCE(last.at, d.created_at) < NOW() - INTERVAL '7 days';

COMMIT;
