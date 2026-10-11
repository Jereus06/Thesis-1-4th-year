BEGIN;

CREATE TYPE sales_day_classification AS ENUM
  ('confirmed_zero', 'business_closed', 'full_stockout', 'partial_stockout', 'incomplete');

CREATE TABLE sales_day_quality (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id uuid,
  classification_date date NOT NULL,
  classification sales_day_classification NOT NULL,
  note text CHECK (note IS NULL OR length(note) <= 1000),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, product_id) REFERENCES products(business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, created_by) REFERENCES users(business_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id, updated_by) REFERENCES users(business_id, id) ON DELETE RESTRICT,
  UNIQUE NULLS NOT DISTINCT (business_id, product_id, classification_date)
);

CREATE TABLE sales_day_quality_audit (
  id bigserial PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  quality_id uuid,
  product_id uuid,
  classification_date date NOT NULL,
  previous_classification sales_day_classification,
  classification sales_day_classification,
  previous_note text,
  note text,
  action text NOT NULL CHECK (action IN ('created', 'updated', 'deleted')),
  changed_by uuid NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, product_id) REFERENCES products(business_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id, changed_by) REFERENCES users(business_id, id) ON DELETE RESTRICT
);

CREATE INDEX sales_day_quality_business_date_idx
  ON sales_day_quality (business_id, classification_date DESC);
CREATE INDEX sales_day_quality_audit_business_date_idx
  ON sales_day_quality_audit (business_id, changed_at DESC);

ALTER TABLE forecast_runs ADD COLUMN timing jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
