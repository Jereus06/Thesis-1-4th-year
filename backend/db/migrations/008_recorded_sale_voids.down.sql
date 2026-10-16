BEGIN;

-- Dropping this state after a correction would silently count the sale again
-- even though its stock deduction has already been reversed.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM sales WHERE voided_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot remove recorded-sale void state while voided sales exist';
  END IF;
END $$;
ALTER TABLE sales DROP COLUMN voided_at;

COMMIT;
