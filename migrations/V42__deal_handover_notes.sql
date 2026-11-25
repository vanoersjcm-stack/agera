-- Agera Suite - V42: deal pipeline mechanics. Proposal sent (with the document that was sent), a negotiation log of
-- notes and counter-offers, and the handover to operations (coordinator, onboarding checklist).

BEGIN;

ALTER TABLE deals
  ADD COLUMN proposal_document_id UUID REFERENCES room_documents (id) ON DELETE SET NULL,
  ADD COLUMN proposal_sent_at     TIMESTAMPTZ(3),
  ADD COLUMN ops_coordinator_id   UUID REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN handed_over_at       TIMESTAMPTZ(3);

CREATE TABLE deal_notes (
    id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID           NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    deal_id     UUID           NOT NULL REFERENCES deals (id) ON DELETE CASCADE,
    kind        VARCHAR(20)    NOT NULL DEFAULT 'note',
    body        TEXT           NOT NULL,
    amount      NUMERIC(14, 2),
    created_by  UUID           REFERENCES users (id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_deal_notes_kind CHECK (kind IN ('note', 'counter_offer', 'our_offer')),
    CONSTRAINT chk_deal_notes_body CHECK (btrim(body) <> '')
);
CREATE INDEX idx_deal_notes_deal ON deal_notes (tenant_id, deal_id, created_at);

CREATE TABLE deal_onboarding_items (
    id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID           NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    deal_id     UUID           NOT NULL REFERENCES deals (id) ON DELETE CASCADE,
    title       VARCHAR(200)   NOT NULL,
    position    INT            NOT NULL DEFAULT 0,
    done_at     TIMESTAMPTZ(3),
    done_by     UUID           REFERENCES users (id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_deal_onboarding_title CHECK (btrim(title) <> '')
);
CREATE INDEX idx_deal_onboarding_deal ON deal_onboarding_items (tenant_id, deal_id, position);

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['deal_notes', 'deal_onboarding_items'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY tenant_%s_policy ON %I FOR ALL USING (tenant_id = app_current_tenant() AND app_is_internal()) WITH CHECK (tenant_id = app_current_tenant() AND app_is_internal())',
            t, t);
    END LOOP;
END $$;

COMMIT;
