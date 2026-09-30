BEGIN;

ALTER TABLE users ADD COLUMN password_hash text;
ALTER TABLE users ADD COLUMN password_changed_at timestamptz;

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE INDEX sessions_user_expires_idx ON sessions (user_id, expires_at);

CREATE TABLE idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operation text NOT NULL CHECK (btrim(operation) <> ''),
  key text NOT NULL CHECK (btrim(key) <> ''),
  request_hash text NOT NULL CHECK (length(request_hash) = 64),
  response_status integer CHECK (response_status BETWEEN 200 AND 599),
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (business_id, user_id, operation, key),
  CHECK (expires_at > created_at),
  CHECK ((response_status IS NULL) = (response_body IS NULL))
);

CREATE INDEX idempotency_keys_expires_idx ON idempotency_keys (expires_at);

COMMIT;
