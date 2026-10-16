BEGIN;

-- Keep the sale and its immutable stock movement for audit while excluding a
-- corrected record from operational sales history and future forecast inputs.
ALTER TABLE sales ADD COLUMN voided_at timestamptz;

COMMIT;
