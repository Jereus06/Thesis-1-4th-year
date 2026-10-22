BEGIN;

-- A transaction can start before a forecast captures its inputs and then wait
-- for the same business lock. Stamp the eventual write, not transaction start,
-- so updated records correctly invalidate that immutable forecast snapshot.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;

COMMIT;
