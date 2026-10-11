BEGIN;

-- Existing users and their business-scoped email uniqueness are unchanged.
CREATE TABLE google_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL UNIQUE CHECK (btrim(subject) <> '' AND length(subject) <= 255),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- State/browser bindings are hashed; the PKCE verifier stays server-side.
CREATE TABLE oauth_flows (
  state_hash text PRIMARY KEY CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  browser_hash text NOT NULL CHECK (browser_hash ~ '^[0-9a-f]{64}$'),
  verifier text NOT NULL CHECK (length(verifier) BETWEEN 43 AND 128),
  nonce text NOT NULL CHECK (btrim(nonce) <> '' AND length(nonce) <= 200),
  intent text NOT NULL CHECK (intent IN ('sign-in', 'link')),
  session_hash text CHECK (session_hash IS NULL OR session_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at),
  CHECK ((intent = 'link') = (session_hash IS NOT NULL))
);

CREATE TABLE google_pending (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  subject text NOT NULL CHECK (btrim(subject) <> '' AND length(subject) <= 255),
  email text NOT NULL CHECK (email = lower(btrim(email)) AND email <> ''),
  display_name text NOT NULL CHECK (btrim(display_name) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);

CREATE INDEX oauth_flows_expiry_idx ON oauth_flows (expires_at);
CREATE INDEX google_pending_expiry_idx ON google_pending (expires_at);

COMMIT;
