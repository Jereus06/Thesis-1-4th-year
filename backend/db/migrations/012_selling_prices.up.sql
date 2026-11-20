BEGIN;

-- Some installations already applied catalog extensions outside this checkout.
-- Preserve those columns and their values when upgrading either schema lineage.
ALTER TABLE products ADD COLUMN IF NOT EXISTS brand varchar(100) NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS model varchar(150) NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS variant varchar(150) NOT NULL DEFAULT '';

-- Unknown historical prices stay NULL. Never infer them from today's catalog.
ALTER TABLE products ADD COLUMN IF NOT EXISTS selling_price numeric(18,4)
    CHECK (selling_price >= 0);
-- Earlier catalog extensions used NOT NULL DEFAULT 0. Unknown prices must be
-- representable; preserve existing values without treating them as sale evidence.
ALTER TABLE products ALTER COLUMN selling_price DROP NOT NULL;
ALTER TABLE products ALTER COLUMN selling_price DROP DEFAULT;
ALTER TABLE sales ADD COLUMN selling_price numeric(18,4)
    CHECK (selling_price >= 0);
ALTER TABLE sales ADD COLUMN sales_amount numeric(36,7)
    CHECK (sales_amount >= 0);
ALTER TABLE sales ADD CONSTRAINT sales_price_amount_consistent CHECK (
    (selling_price IS NULL AND sales_amount IS NULL) OR
    (selling_price IS NOT NULL AND sales_amount IS NOT NULL
     AND sales_amount = quantity * selling_price)
);

COMMIT;
