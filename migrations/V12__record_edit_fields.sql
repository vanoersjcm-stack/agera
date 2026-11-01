-- Agera Symphony - V12: fields needed to edit records in the web app (audit gap B2).
-- Work orders get a priority; stores get an operational status so closed stores can be kept for history.

ALTER TABLE work_orders ADD COLUMN priority VARCHAR(10) NOT NULL DEFAULT 'normal';
ALTER TABLE work_orders ADD CONSTRAINT chk_work_orders_priority CHECK (priority IN ('low', 'normal', 'high', 'urgent'));

ALTER TABLE stores ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE stores ADD CONSTRAINT chk_stores_status CHECK (status IN ('active', 'closed'));
