# Same email across store accounts — 2026-11-14

## Existing data model

StockCast keeps users within businesses. An email can occur in different businesses;
user IDs, roles, password hashes, sessions and all business records stay separate.
This change does not introduce a global user, merge accounts, add columns, or change
migration history. Creating another store requires an active account's current password
for an existing email. The new store starts with its own owner account, settings and
empty catalog; the original account and records remain unchanged.

## Authentication contract

- `POST /api/v1/auth/sign-up` retains its request and successful response shape. A new
  email registers as before. Reusing an email requires its existing password, after
  which another business can be created. Invalid, inactive or passwordless existing
  accounts cannot authorize reuse. Passwordless Google users can first set a password
  through email recovery. Google signup/linking retains its existing explicit association.
- The signup email lock serializes reuse and repeated requests. An existing store with
  the same case-insensitive trimmed name and location returns 409, preventing a repeated
  signup from silently creating a duplicate store. A distinct name or location is allowed.
- `POST /api/v1/auth/sign-in` remains compatible with optional `businessId`. A single
  matching active account signs in normally; multiple matches return 409 and issue no
  session. Selecting a business verifies its credentials again before issuing a session.
- New `POST /api/v1/auth/sign-in/stores` accepts `{ email, password }` and returns
  `{ data: [{ businessId, businessName, businessLocation, role }] }`. It returns only
  active stores with matching credentials; wrong/unknown credentials return the same
  401 error. This endpoint issues no session or sign-in activity and uses `no-store`,
  Origin validation and the existing login rate limit. It never accepts an email alone.
- The sign-in UI focuses its store selector when needed, requires an explicit choice,
  and clears choices when credentials/screens change or authentication succeeds. It
  preserves existing pending-submission guards, browser-password-manager behavior,
  Google flows, and manual Business ID access.

## Recovery

`POST /api/v1/auth/password/recovery` keeps its neutral `{ data: { accepted: true } }`
response. It locks active accounts in user-ID order, replaces prior outstanding links,
and sends one email listing the stores with distinct 30-minute single-use reset links.
An optional Business ID restricts recovery to that store. Unknown/inactive accounts and
mail transport failures still receive the same public response. Tokens are stored only
as hashes and are neither returned publicly nor logged.

Existing reset completion changes and revokes sessions only for the selected store's
user. Passwords can therefore differ later between stores; sign-in lists only accounts
matching the entered password. Existing staff invitation and Google identity policies
remain unchanged.

## Verification

Focused PostgreSQL tests cover email reuse, unchanged original records, rejected
credentials without orphan rows, duplicate signup, credential-matched store disclosure,
session/tenant isolation, Origin checks, independent recovery, token reuse rejection and
concurrent recovery. The database is a separate disposable PostgreSQL instance; mail and
browser HTTP are synthetic. No real account is created and no real recovery email is sent.

Execution results and any wider-suite limitations are recorded in
[the verification record](../../docs/MULTI_STORE_EMAIL_VERIFICATION.md).
