BEGIN;
ALTER TABLE forecast_runs DROP COLUMN IF EXISTS timing;
DROP TABLE IF EXISTS sales_day_quality_audit;
DROP TABLE IF EXISTS sales_day_quality;
DROP TYPE IF EXISTS sales_day_classification;
COMMIT;
