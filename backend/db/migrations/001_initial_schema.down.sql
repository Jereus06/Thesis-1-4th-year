BEGIN;

DROP TABLE IF EXISTS reorder_recommendations;
DROP TABLE IF EXISTS forecast_metrics;
DROP TABLE IF EXISTS forecast_predictions;
DROP TABLE IF EXISTS forecast_runs;
DROP TABLE IF EXISTS business_settings;
DROP TABLE IF EXISTS inventory_movements;
DROP TABLE IF EXISTS sales;
DROP TABLE IF EXISTS data_imports;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS businesses;

DROP FUNCTION IF EXISTS set_updated_at();

DROP TYPE IF EXISTS recommendation_status;
DROP TYPE IF EXISTS forecast_run_status;
DROP TYPE IF EXISTS prediction_split;
DROP TYPE IF EXISTS forecast_split;
DROP TYPE IF EXISTS forecast_method;
DROP TYPE IF EXISTS inventory_movement_type;
DROP TYPE IF EXISTS sale_source;
DROP TYPE IF EXISTS import_status;
DROP TYPE IF EXISTS import_source;
DROP TYPE IF EXISTS user_role;
DROP TYPE IF EXISTS data_origin;

COMMIT;
