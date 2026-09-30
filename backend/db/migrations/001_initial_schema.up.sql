BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE data_origin AS ENUM ('demo', 'partner');
CREATE TYPE user_role AS ENUM ('owner', 'staff');
CREATE TYPE import_source AS ENUM ('csv', 'pos_export', 'spreadsheet', 'migration');
CREATE TYPE import_status AS ENUM ('pending', 'processing', 'completed', 'failed');
CREATE TYPE sale_source AS ENUM ('demo', 'manual', 'csv_import', 'pos_import', 'migration');
CREATE TYPE inventory_movement_type AS ENUM ('opening_balance', 'sale', 'receipt', 'adjustment', 'return', 'write_off');
CREATE TYPE forecast_method AS ENUM ('moving_average', 'xgboost', 'ensemble', 'fallback', 'rule');
CREATE TYPE forecast_split AS ENUM ('train', 'validation', 'final_test');
CREATE TYPE prediction_split AS ENUM ('validation', 'final_test', 'future');
CREATE TYPE forecast_run_status AS ENUM ('queued', 'running', 'completed', 'failed');
CREATE TYPE recommendation_status AS ENUM ('stockout', 'reorder', 'watch', 'healthy');

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (btrim(name) <> ''),
  location text,
  data_origin data_origin NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, data_origin)
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(btrim(email)) AND email <> ''),
  display_name text NOT NULL CHECK (btrim(display_name) <> ''),
  role user_role NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, email),
  UNIQUE (business_id, id)
);

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  sku text NOT NULL CHECK (btrim(sku) <> ''),
  name text NOT NULL CHECK (btrim(name) <> ''),
  category text NOT NULL CHECK (btrim(category) <> ''),
  unit text NOT NULL CHECK (btrim(unit) <> ''),
  current_stock numeric(18, 3) NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
  lead_time_days integer NOT NULL DEFAULT 0 CHECK (lead_time_days >= 0),
  safety_stock numeric(18, 3) NOT NULL DEFAULT 0 CHECK (safety_stock >= 0),
  unit_cost numeric(18, 4) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, sku),
  UNIQUE (business_id, id)
);

CREATE TABLE data_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  source import_source NOT NULL,
  data_origin data_origin NOT NULL,
  original_filename text,
  content_sha256 text CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$'),
  status import_status NOT NULL DEFAULT 'pending',
  total_rows integer NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  accepted_rows integer NOT NULL DEFAULT 0 CHECK (accepted_rows >= 0),
  rejected_rows integer NOT NULL DEFAULT 0 CHECK (rejected_rows >= 0),
  error_summary jsonb NOT NULL DEFAULT '[]'::jsonb,
  imported_by uuid,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (accepted_rows + rejected_rows <= total_rows),
  CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at),
  FOREIGN KEY (business_id, data_origin) REFERENCES businesses(id, data_origin) ON DELETE CASCADE,
  FOREIGN KEY (business_id, imported_by) REFERENCES users(business_id, id) ON DELETE RESTRICT,
  UNIQUE (business_id, id)
);

CREATE TABLE sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  sale_date date NOT NULL,
  quantity numeric(18, 3) NOT NULL CHECK (quantity > 0),
  source sale_source NOT NULL,
  data_origin data_origin NOT NULL,
  import_id uuid,
  source_row_number integer CHECK (source_row_number IS NULL OR source_row_number > 0),
  source_record_key text,
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, product_id) REFERENCES products(business_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id, data_origin) REFERENCES businesses(id, data_origin) ON DELETE CASCADE,
  FOREIGN KEY (business_id, import_id) REFERENCES data_imports(business_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id, recorded_by) REFERENCES users(business_id, id) ON DELETE RESTRICT,
  CHECK (
    (source IN ('csv_import', 'pos_import', 'migration') AND import_id IS NOT NULL)
    OR (source IN ('demo', 'manual') AND import_id IS NULL)
  ),
  CHECK ((source = 'demo' AND data_origin = 'demo') OR source <> 'demo'),
  UNIQUE (business_id, id)
);

CREATE TABLE inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  movement_date date NOT NULL,
  movement_type inventory_movement_type NOT NULL,
  quantity_delta numeric(18, 3) NOT NULL CHECK (quantity_delta <> 0),
  balance_after numeric(18, 3) NOT NULL CHECK (balance_after >= 0),
  data_origin data_origin NOT NULL,
  sale_id uuid,
  import_id uuid,
  note text,
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, product_id) REFERENCES products(business_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id, data_origin) REFERENCES businesses(id, data_origin) ON DELETE CASCADE,
  FOREIGN KEY (business_id, sale_id) REFERENCES sales(business_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id, import_id) REFERENCES data_imports(business_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id, recorded_by) REFERENCES users(business_id, id) ON DELETE RESTRICT,
  CHECK ((movement_type = 'sale' AND sale_id IS NOT NULL AND quantity_delta < 0) OR movement_type <> 'sale'),
  CHECK ((movement_type = 'receipt' AND quantity_delta > 0) OR movement_type <> 'receipt')
);

CREATE TABLE business_settings (
  business_id uuid PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  moving_average_window integer NOT NULL DEFAULT 7 CHECK (moving_average_window > 0),
  forecast_horizon_days integer NOT NULL DEFAULT 14 CHECK (forecast_horizon_days > 0),
  target_cover_days integer NOT NULL DEFAULT 7 CHECK (target_cover_days >= 0),
  minimum_history_weeks integer NOT NULL DEFAULT 8 CHECK (minimum_history_weeks > 0),
  minimum_nonzero_days integer NOT NULL DEFAULT 100 CHECK (minimum_nonzero_days > 0),
  top_n_products integer NOT NULL DEFAULT 8 CHECK (top_n_products > 0),
  cv_folds integer NOT NULL DEFAULT 3 CHECK (cv_folds > 1),
  timezone text NOT NULL DEFAULT 'Asia/Manila' CHECK (btrim(timezone) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE forecast_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  data_origin data_origin NOT NULL,
  status forecast_run_status NOT NULL DEFAULT 'queued',
  algorithm_name text NOT NULL CHECK (btrim(algorithm_name) <> ''),
  algorithm_version text,
  xgboost_verified boolean NOT NULL DEFAULT false,
  training_start date NOT NULL,
  training_end date NOT NULL,
  validation_start date NOT NULL,
  validation_end date NOT NULL,
  final_test_start date NOT NULL,
  final_test_end date NOT NULL,
  forecast_horizon_days integer NOT NULL CHECK (forecast_horizon_days > 0),
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  data_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  failure_message text,
  requested_by uuid,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (training_start <= training_end),
  CHECK (training_end < validation_start),
  CHECK (validation_start <= validation_end),
  CHECK (validation_end < final_test_start),
  CHECK (final_test_start <= final_test_end),
  CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at),
  FOREIGN KEY (business_id, data_origin) REFERENCES businesses(id, data_origin) ON DELETE CASCADE,
  FOREIGN KEY (business_id, requested_by) REFERENCES users(business_id, id) ON DELETE RESTRICT,
  UNIQUE (business_id, id)
);

CREATE TABLE forecast_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  forecast_run_id uuid NOT NULL,
  product_id uuid NOT NULL,
  prediction_date date NOT NULL,
  method forecast_method NOT NULL,
  dataset_split prediction_split NOT NULL,
  predicted_quantity numeric(18, 3) NOT NULL CHECK (predicted_quantity >= 0),
  actual_quantity numeric(18, 3) CHECK (actual_quantity IS NULL OR actual_quantity >= 0),
  lower_bound numeric(18, 3) CHECK (lower_bound IS NULL OR lower_bound >= 0),
  upper_bound numeric(18, 3) CHECK (upper_bound IS NULL OR upper_bound >= 0),
  fallback_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, forecast_run_id) REFERENCES forecast_runs(business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, product_id) REFERENCES products(business_id, id) ON DELETE RESTRICT,
  CHECK (lower_bound IS NULL OR upper_bound IS NULL OR lower_bound <= upper_bound),
  CHECK ((dataset_split = 'future' AND actual_quantity IS NULL) OR dataset_split <> 'future'),
  CHECK ((method IN ('fallback', 'rule') AND fallback_reason IS NOT NULL) OR method NOT IN ('fallback', 'rule')),
  UNIQUE (forecast_run_id, product_id, prediction_date, method, dataset_split)
);

CREATE TABLE forecast_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  forecast_run_id uuid NOT NULL,
  product_id uuid,
  method forecast_method NOT NULL,
  dataset_split forecast_split NOT NULL,
  mae numeric(18, 6) NOT NULL CHECK (mae >= 0),
  rmse numeric(18, 6) NOT NULL CHECK (rmse >= 0),
  observation_count integer NOT NULL CHECK (observation_count > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, forecast_run_id) REFERENCES forecast_runs(business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, product_id) REFERENCES products(business_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX forecast_metrics_product_unique
  ON forecast_metrics (forecast_run_id, product_id, method, dataset_split)
  WHERE product_id IS NOT NULL;
CREATE UNIQUE INDEX forecast_metrics_aggregate_unique
  ON forecast_metrics (forecast_run_id, method, dataset_split)
  WHERE product_id IS NULL;

CREATE UNIQUE INDEX sales_import_source_row_unique
  ON sales (import_id, source_row_number)
  WHERE import_id IS NOT NULL AND source_row_number IS NOT NULL;
CREATE UNIQUE INDEX inventory_movements_sale_unique
  ON inventory_movements (sale_id)
  WHERE sale_id IS NOT NULL;

CREATE TABLE reorder_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  forecast_run_id uuid,
  method forecast_method NOT NULL,
  recommendation_date date NOT NULL,
  forecast_daily_demand numeric(18, 3) NOT NULL CHECK (forecast_daily_demand >= 0),
  current_stock numeric(18, 3) NOT NULL CHECK (current_stock >= 0),
  lead_time_days integer NOT NULL CHECK (lead_time_days >= 0),
  safety_stock numeric(18, 3) NOT NULL CHECK (safety_stock >= 0),
  target_cover_days integer NOT NULL CHECK (target_cover_days >= 0),
  demand_during_lead_time numeric(18, 3) NOT NULL CHECK (demand_during_lead_time >= 0),
  reorder_point numeric(18, 3) NOT NULL CHECK (reorder_point >= 0),
  target_stock numeric(18, 3) NOT NULL CHECK (target_stock >= 0),
  suggested_quantity numeric(18, 3) NOT NULL CHECK (suggested_quantity >= 0),
  status recommendation_status NOT NULL,
  confidence_level text NOT NULL CHECK (confidence_level IN ('low', 'medium', 'high')),
  calculation_version text NOT NULL CHECK (btrim(calculation_version) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, product_id) REFERENCES products(business_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id, forecast_run_id) REFERENCES forecast_runs(business_id, id) ON DELETE RESTRICT,
  CHECK (forecast_run_id IS NOT NULL OR method IN ('fallback', 'rule')),
  UNIQUE (product_id, forecast_run_id, recommendation_date, method)
);

CREATE INDEX sales_product_date_idx ON sales (product_id, sale_date, id);
CREATE INDEX sales_business_date_idx ON sales (business_id, sale_date, id);
CREATE INDEX inventory_movements_product_date_idx ON inventory_movements (product_id, movement_date, created_at, id);
CREATE INDEX data_imports_business_created_idx ON data_imports (business_id, created_at DESC);
CREATE INDEX forecast_runs_business_created_idx ON forecast_runs (business_id, created_at DESC);
CREATE INDEX forecast_predictions_product_date_idx ON forecast_predictions (product_id, prediction_date);
CREATE INDEX reorder_recommendations_business_date_idx ON reorder_recommendations (business_id, recommendation_date DESC);

CREATE TRIGGER businesses_set_updated_at BEFORE UPDATE ON businesses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER products_set_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER business_settings_set_updated_at BEFORE UPDATE ON business_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
