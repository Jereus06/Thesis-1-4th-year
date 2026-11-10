BEGIN;

CREATE TABLE account_activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  display_name text NOT NULL CHECK (btrim(display_name) <> ''),
  email text NOT NULL CHECK (email = lower(btrim(email)) AND email <> ''),
  role user_role NOT NULL,
  event text NOT NULL CHECK (event IN ('signed_in', 'signed_out')),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (business_id, user_id) REFERENCES users(business_id, id) ON DELETE RESTRICT
);

CREATE INDEX account_activity_events_business_time_idx
  ON account_activity_events (business_id, occurred_at DESC, id DESC);

COMMIT;
