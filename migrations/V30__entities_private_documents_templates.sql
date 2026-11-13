-- Test 1a round 2: third-party directory (entity category, organisation type, size), private records
-- visible only to their creator, documents without a client, and standard EN/NL templates.

ALTER TABLE clients
    ADD COLUMN entity_category   VARCHAR(30) NOT NULL DEFAULT 'client',
    ADD COLUMN organization_type VARCHAR(30),
    ADD COLUMN company_size      VARCHAR(20),
    ADD COLUMN phone             VARCHAR(50),
    ADD COLUMN created_by        UUID REFERENCES users (id) ON DELETE SET NULL,
    ADD CONSTRAINT chk_clients_entity_category CHECK (entity_category IN (
        'client', 'vendor_client', 'vendor_non_client', 'vendor_prospect', 'accountant', 'notary', 'lawyer', 'consultant',
        'shareholder', 'bank', 'insurer', 'agent', 'distributor', 'landlord', 'tenant', 'office_outfitter', 'sister_company',
        'subsidiary', 'office_supplier', 'apparel_supplier', 'apparel_printer', 'taxi_company', 'telecom_domain_provider', 'private')),
    ADD CONSTRAINT chk_clients_organization_type CHECK (organization_type IS NULL OR organization_type IN (
        'commercial_enterprise', 'sole_proprietor', 'foundation_nonprofit', 'government', 'semi_government')),
    ADD CONSTRAINT chk_clients_company_size CHECK (company_size IS NULL OR (organization_type = 'commercial_enterprise'
        AND company_size IN ('SME', 'Mid-Market', 'Large', 'Enterprise'))),
    ADD CONSTRAINT chk_clients_private_owner CHECK (entity_category <> 'private' OR created_by IS NOT NULL);

CREATE INDEX idx_clients_tenant_category ON clients (tenant_id, entity_category);

-- The signed-in user: app.current_user (database id, e.g. Agera Office) or app.current_subject (Keycloak subject).
CREATE OR REPLACE FUNCTION app_current_user() RETURNS UUID
    LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
        NULLIF(current_setting('app.current_user', true), '')::uuid,
        (SELECT u.id FROM users u
          WHERE u.keycloak_id = NULLIF(current_setting('app.current_subject', true), '')
            AND u.tenant_id = app_current_tenant()))
$$;

-- Private third parties: only their creator sees or changes them, administrators included.
CREATE POLICY private_clients_owner_policy ON clients AS RESTRICTIVE
    FOR ALL
    USING (entity_category <> 'private' OR created_by = app_current_user())
    WITH CHECK (entity_category <> 'private' OR created_by = app_current_user());

-- Documents without a client (blank documents, memos) belong to their creator only.
ALTER TABLE room_documents ALTER COLUMN client_id DROP NOT NULL;

CREATE POLICY personal_room_documents_owner_policy ON room_documents AS RESTRICTIVE
    FOR ALL
    USING (client_id IS NOT NULL OR created_by = app_current_user())
    WITH CHECK (client_id IS NOT NULL OR created_by = app_current_user());

CREATE POLICY personal_room_document_versions_owner_policy ON room_document_versions AS RESTRICTIVE
    FOR ALL
    USING (EXISTS (SELECT 1 FROM room_documents d WHERE d.tenant_id = room_document_versions.tenant_id AND d.id = room_document_versions.document_id))
    WITH CHECK (EXISTS (SELECT 1 FROM room_documents d WHERE d.tenant_id = room_document_versions.tenant_id AND d.id = room_document_versions.document_id));

-- Standard commercial templates in English and Dutch, added once per organisation.
CREATE OR REPLACE FUNCTION seed_standard_templates(p_tenant UUID) RETURNS INTEGER
    LANGUAGE plpgsql AS $$
DECLARE
    added INTEGER := 0;
    tpl RECORD;
BEGIN
    FOR tpl IN SELECT * FROM (VALUES
        ('Proposal Cover Letter (EN)', 'letter', E'{{client.name}}\nAttn. {{contact.name}}\n{{client.address}}\n\n{{client.city}}, {{today}}\n\nSubject: Our proposal\n\nDear {{contact.name}},\n\nThank you for the opportunity to present our proposal to {{client.name}}. Enclosed you will find our approach, the scope of services and the commercial terms. Payment terms: {{client.paymentTerms}}.\n\nWe would be happy to walk you through the proposal in person.\n\nKind regards,\n{{user.name}}'),
        ('Begeleidende brief bij voorstel (NL)', 'letter', E'{{client.name}}\nT.a.v. {{contact.name}}\n{{client.address}}\n\n{{client.city}}, {{today}}\n\nBetreft: ons voorstel\n\nBeste {{contact.name}},\n\nDank voor de gelegenheid om {{client.name}} ons voorstel te presenteren. Bijgaand vindt u onze aanpak, de omvang van de dienstverlening en de commerciële voorwaarden. Betalingstermijn: {{client.paymentTerms}}.\n\nWe lichten het voorstel graag persoonlijk toe.\n\nMet vriendelijke groet,\n{{user.name}}'),
        ('Order Confirmation (EN)', 'mail', E'Dear {{contact.name}},\n\nThank you for your order. We hereby confirm the order for {{client.name}} as agreed on {{today}}. Payment terms: {{client.paymentTerms}}.\n\nWe will contact you to schedule the delivery or execution.\n\nKind regards,\n{{user.name}}'),
        ('Orderbevestiging (NL)', 'mail', E'Beste {{contact.name}},\n\nHartelijk dank voor uw opdracht. Hierbij bevestigen wij de order voor {{client.name}} zoals overeengekomen op {{today}}. Betalingstermijn: {{client.paymentTerms}}.\n\nWij nemen contact met u op om de levering of uitvoering in te plannen.\n\nMet vriendelijke groet,\n{{user.name}}'),
        ('QBR Invitation (EN)', 'mail', E'Dear {{contact.name}},\n\nWe would like to invite you to the Quarterly Business Review for {{client.name}}. We will review results, store execution and the plans for the coming quarter.\n\nWould one of the following moments suit you?\n- \n- \n\nKind regards,\n{{user.name}}'),
        ('Uitnodiging kwartaalreview (NL)', 'mail', E'Beste {{contact.name}},\n\nGraag nodigen wij u uit voor de kwartaalreview (QBR) van {{client.name}}. We bespreken de resultaten, de uitvoering in de winkels en de plannen voor het komende kwartaal.\n\nSchikt een van de volgende momenten?\n- \n- \n\nMet vriendelijke groet,\n{{user.name}}'),
        ('Price Adjustment Notice (EN)', 'letter', E'{{client.name}}\nAttn. {{contact.name}}\n{{client.address}}\n\n{{client.city}}, {{today}}\n\nSubject: Price adjustment\n\nDear {{contact.name}},\n\nWe hereby inform you that our rates will be adjusted as of [date]. The adjustment follows the indexation agreed in our agreement. The new price list is enclosed.\n\nPlease contact us if you have any questions.\n\nKind regards,\n{{user.name}}'),
        ('Aankondiging prijsaanpassing (NL)', 'letter', E'{{client.name}}\nT.a.v. {{contact.name}}\n{{client.address}}\n\n{{client.city}}, {{today}}\n\nBetreft: prijsaanpassing\n\nBeste {{contact.name}},\n\nHierbij laten wij u weten dat onze tarieven per [datum] worden aangepast. De aanpassing volgt de indexatie zoals afgesproken in onze overeenkomst. De nieuwe prijslijst vindt u als bijlage.\n\nNeem gerust contact met ons op bij vragen.\n\nMet vriendelijke groet,\n{{user.name}}'),
        ('Contract Renewal (EN)', 'letter', E'{{client.name}}\nAttn. {{contact.name}}\n{{client.address}}\n\n{{client.city}}, {{today}}\n\nSubject: Renewal of our agreement\n\nDear {{contact.name}},\n\nOur agreement with {{client.name}} expires soon. We would like to continue our cooperation and propose to renew the agreement under the enclosed terms.\n\nWe look forward to your response.\n\nKind regards,\n{{user.name}}'),
        ('Contractverlenging (NL)', 'letter', E'{{client.name}}\nT.a.v. {{contact.name}}\n{{client.address}}\n\n{{client.city}}, {{today}}\n\nBetreft: verlenging van onze overeenkomst\n\nBeste {{contact.name}},\n\nOnze overeenkomst met {{client.name}} loopt binnenkort af. Wij zetten de samenwerking graag voort en stellen voor de overeenkomst te verlengen onder de bijgevoegde voorwaarden.\n\nWij zien uw reactie met belangstelling tegemoet.\n\nMet vriendelijke groet,\n{{user.name}}'),
        ('Store Audit Summary (EN)', 'mail', E'Dear {{contact.name}},\n\nPlease find below the summary of the latest store audit round for {{client.name}} ({{today}}).\n\n- Stores visited: \n- Compliance: \n- Main findings: \n- Agreed actions: \n\nKind regards,\n{{user.name}}'),
        ('Samenvatting winkelaudit (NL)', 'mail', E'Beste {{contact.name}},\n\nHieronder vindt u de samenvatting van de laatste auditronde in de winkels van {{client.name}} ({{today}}).\n\n- Bezochte winkels: \n- Compliance: \n- Belangrijkste bevindingen: \n- Afgesproken acties: \n\nMet vriendelijke groet,\n{{user.name}}'),
        ('RMA Confirmation (EN)', 'mail', E'Dear {{contact.name}},\n\nWe confirm receipt of your return request (RMA) for {{client.name}}. RMA number: [number]. Please return the goods with the RMA number clearly visible on the package. We will handle the credit or replacement after inspection.\n\nKind regards,\n{{user.name}}'),
        ('RMA-bevestiging (NL)', 'mail', E'Beste {{contact.name}},\n\nWij bevestigen de ontvangst van uw retouraanvraag (RMA) voor {{client.name}}. RMA-nummer: [nummer]. Stuur de goederen retour met het RMA-nummer duidelijk zichtbaar op de verpakking. Na controle handelen wij de creditering of vervanging af.\n\nMet vriendelijke groet,\n{{user.name}}')
    ) AS v(name, kind, body)
    LOOP
        IF NOT EXISTS (SELECT 1 FROM document_templates WHERE tenant_id = p_tenant AND name = tpl.name) THEN
            INSERT INTO document_templates (tenant_id, name, kind, body, active) VALUES (p_tenant, tpl.name, tpl.kind, tpl.body, TRUE);
            added := added + 1;
        END IF;
    END LOOP;
    RETURN added;
END $$;

SELECT seed_standard_templates(id) FROM tenants;
