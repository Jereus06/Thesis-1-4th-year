BEGIN;
ALTER TABLE sales DROP CONSTRAINT sales_price_amount_consistent;
ALTER TABLE sales DROP COLUMN sales_amount;
ALTER TABLE sales DROP COLUMN selling_price;
-- Retain catalog columns/values: these may predate this migration. Restoring a
-- zero default or NOT NULL would also invalidate legitimate unknown prices.
COMMIT;
