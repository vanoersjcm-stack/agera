-- Agera Symphony - V23: customer survey & feedback engine.
-- Vanguard: max 3 active surveys, NPS / CSAT / open text only, one client or all clients.
-- Symphony: unlimited, all question types with branching, cohort targeting.
-- Clients answer in the client portal; survey_dispatch_clients snapshots who a dispatch targeted.

CREATE TABLE surveys (
    id           UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID           NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    title        VARCHAR(200)   NOT NULL,
    description  TEXT,
    status       VARCHAR(20)    NOT NULL DEFAULT 'draft',
    questions    JSONB          NOT NULL DEFAULT '[]'::jsonb,
    created_by   UUID           REFERENCES users (id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_surveys_tenant_id_id UNIQUE (tenant_id, id),
    CONSTRAINT chk_surveys_status CHECK (status IN ('draft', 'active', 'closed', 'archived')),
    CONSTRAINT chk_surveys_title_not_blank CHECK (btrim(title) <> ''),
    CONSTRAINT chk_surveys_questions CHECK (jsonb_typeof(questions) = 'array')
);
CREATE INDEX idx_surveys_tenant_status ON surveys (tenant_id, status);
CREATE TRIGGER trg_surveys_updated_at BEFORE UPDATE ON surveys FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE survey_dispatches (
    id              UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID           NOT NULL,
    survey_id       UUID           NOT NULL,
    target_type     VARCHAR(20)    NOT NULL,
    client_id       UUID,
    client_room_id  UUID,
    filter_criteria JSONB,
    dispatched_by   UUID           REFERENCES users (id) ON DELETE SET NULL,
    total_targeted  INT            NOT NULL DEFAULT 0,
    total_contacts  INT            NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_survey_dispatches_tenant_id_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_survey_dispatches_survey FOREIGN KEY (tenant_id, survey_id) REFERENCES surveys (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_survey_dispatches_client FOREIGN KEY (tenant_id, client_id) REFERENCES clients (tenant_id, id) ON DELETE SET NULL (client_id),
    CONSTRAINT chk_survey_dispatches_target CHECK (target_type IN ('single_client', 'client_cohort', 'client_room'))
);
CREATE INDEX idx_survey_dispatches_survey ON survey_dispatches (survey_id, created_at DESC);

CREATE TABLE survey_dispatch_clients (
    tenant_id    UUID NOT NULL,
    dispatch_id  UUID NOT NULL,
    survey_id    UUID NOT NULL,
    client_id    UUID NOT NULL,
    client_room_id UUID,
    PRIMARY KEY (dispatch_id, client_id),
    CONSTRAINT fk_survey_dispatch_clients_dispatch FOREIGN KEY (tenant_id, dispatch_id) REFERENCES survey_dispatches (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_survey_dispatch_clients_client FOREIGN KEY (tenant_id, client_id) REFERENCES clients (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_survey_dispatch_clients_client ON survey_dispatch_clients (tenant_id, client_id, survey_id);

CREATE TABLE survey_responses (
    id               UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID           NOT NULL,
    survey_id        UUID           NOT NULL,
    dispatch_id      UUID,
    client_id        UUID,
    contact_id       UUID,
    respondent_email VARCHAR(255),
    answers          JSONB          NOT NULL DEFAULT '{}'::jsonb,
    nps_score        INT,
    submitted_at     TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_survey_responses_survey FOREIGN KEY (tenant_id, survey_id) REFERENCES surveys (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_survey_responses_dispatch FOREIGN KEY (tenant_id, dispatch_id) REFERENCES survey_dispatches (tenant_id, id) ON DELETE SET NULL (dispatch_id),
    CONSTRAINT fk_survey_responses_client FOREIGN KEY (tenant_id, client_id) REFERENCES clients (tenant_id, id) ON DELETE SET NULL (client_id),
    CONSTRAINT fk_survey_responses_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE SET NULL,
    CONSTRAINT chk_survey_responses_nps CHECK (nps_score BETWEEN 0 AND 10),
    CONSTRAINT chk_survey_responses_answers CHECK (jsonb_typeof(answers) = 'object')
);
CREATE UNIQUE INDEX uq_survey_responses_respondent ON survey_responses (survey_id, lower(respondent_email)) WHERE respondent_email IS NOT NULL;
CREATE INDEX idx_survey_responses_survey ON survey_responses (survey_id, submitted_at DESC);
CREATE INDEX idx_survey_responses_client ON survey_responses (tenant_id, client_id, submitted_at DESC);

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['surveys', 'survey_dispatches', 'survey_dispatch_clients', 'survey_responses'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY tenant_%s_policy ON %I FOR ALL USING (tenant_id = app_current_tenant() AND app_is_internal()) WITH CHECK (tenant_id = app_current_tenant() AND app_is_internal())',
            t, t);
    END LOOP;
END $$;

-- Client contacts see which surveys were sent to their own company ...
CREATE POLICY client_survey_dispatch_clients_read_policy ON survey_dispatch_clients
    FOR SELECT USING (tenant_id = app_current_tenant() AND app_is_external_client(client_id));

-- ... read those surveys while they are active ...
CREATE POLICY client_surveys_read_policy ON surveys
    FOR SELECT USING (
        tenant_id = app_current_tenant() AND status = 'active'
        AND EXISTS (SELECT 1 FROM survey_dispatch_clients r WHERE r.tenant_id = surveys.tenant_id AND r.survey_id = surveys.id AND app_is_external_client(r.client_id))
    );

-- ... and submit / read their own company's responses.
CREATE POLICY client_survey_responses_read_policy ON survey_responses
    FOR SELECT USING (tenant_id = app_current_tenant() AND app_is_external_client(client_id));

CREATE POLICY client_survey_responses_insert_policy ON survey_responses
    FOR INSERT WITH CHECK (
        tenant_id = app_current_tenant() AND app_is_external_client(client_id)
        AND EXISTS (SELECT 1 FROM survey_dispatch_clients r WHERE r.tenant_id = survey_responses.tenant_id AND r.survey_id = survey_responses.survey_id AND r.client_id = survey_responses.client_id)
    );
