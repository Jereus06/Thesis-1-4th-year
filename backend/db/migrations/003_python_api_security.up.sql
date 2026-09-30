BEGIN;
ALTER TABLE sessions ADD COLUMN csrf_token_hash text CHECK (csrf_token_hash IS NULL OR length(csrf_token_hash) = 64);
CREATE INDEX sessions_token_expiry_idx ON sessions (token_hash, expires_at);
COMMIT;
