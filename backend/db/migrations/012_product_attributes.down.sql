BEGIN;

ALTER TABLE products
  DROP COLUMN variant,
  DROP COLUMN model,
  DROP COLUMN brand;

COMMIT;
