BEGIN;
DROP INDEX IF EXISTS sessions_token_expiry_idx;
ALTER TABLE sessions DROP COLUMN IF EXISTS csrf_token_hash;
COMMIT;
