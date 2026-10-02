BEGIN;
CREATE TABLE password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE staff_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  email text NOT NULL, display_name text NOT NULL, token_hash text NOT NULL UNIQUE,
  invited_by uuid NOT NULL, expires_at timestamptz NOT NULL, accepted_at timestamptz, revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, invited_by) REFERENCES users(business_id,id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX staff_invitations_active_email ON staff_invitations(business_id,email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
COMMIT;
