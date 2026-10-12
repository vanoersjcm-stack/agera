-- V9: store compliance anomalies.
-- Adds a third branch to nexus_operational_anomalies: the latest visit report of a store whose
-- audit_data.complianceStatus is set and is not 'compliant' (e.g. 'flagged_anomaly', 'variance_pending').
-- stores/visit_reports are not RLS tables, so that branch filters on the transaction-local tenant and
-- internal scope explicitly and stays fail-closed without a tenant context.

BEGIN;

DROP VIEW nexus_operational_anomalies;

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
   AND COALESCE(last.at, d.created_at) < NOW() - INTERVAL '7 days'

UNION ALL

SELECT latest.tenant_id,
       'store_compliance'::VARCHAR(30) AS anomaly_type,
       s.id AS source_id,
       format('Store compliance: %s (%s): %s', s.name, s.store_code,
              COALESCE(NULLIF(latest.summary, ''), latest.audit_data->>'complianceStatus')) AS description,
       latest.updated_at AS observed_at,
       jsonb_build_object(
           'storeId', s.id,
           'storeCode', s.store_code,
           'storeName', s.name,
           'city', s.city,
           'visitId', latest.visit_id,
           'complianceStatus', latest.audit_data->>'complianceStatus',
           'finding', latest.audit_data->>'finding'
       ) AS details,
       latest.created_at
  FROM (
        SELECT DISTINCT ON (v.tenant_id, v.store_id)
               v.tenant_id, v.store_id, v.id AS visit_id,
               r.summary, r.audit_data, r.created_at, r.updated_at
          FROM merchandising_visits v
          JOIN visit_reports r ON r.tenant_id = v.tenant_id AND r.visit_id = v.id
         WHERE v.tenant_id = app_current_tenant()
           AND app_is_internal()
           AND v.status <> 'CANCELLED'
         ORDER BY v.tenant_id, v.store_id, v.visit_date DESC, r.updated_at DESC
       ) latest
  JOIN stores s ON s.tenant_id = latest.tenant_id AND s.id = latest.store_id
 WHERE latest.audit_data ? 'complianceStatus'
   AND latest.audit_data->>'complianceStatus' <> 'compliant';

COMMIT;
