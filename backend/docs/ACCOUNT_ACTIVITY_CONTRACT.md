# Account activity contract

The database owner approved this additive contract on 10 November 2026. The implementation uses
the existing Python authentication and owner permissions, with migration `010_account_activity`.
Migrations 001-009 and existing authentication response fields are unchanged. The new history starts
when the migration and application code are enabled; earlier account events are not reconstructed.

## Current behavior and placement

The normal API uses `AuthRepository` through `main.repo`. Successful password sign-in,
registration, accepted invitations, and Google account access create cookie sessions through
`AuthRepository.issue_session`. Google identity linking also calls this method to refresh the
already authenticated user's session. `AuthRepository.sign_out` deletes the matching session and
records an explicit sign-out in the same transaction. The legacy base repository is unchanged.
Password changes, password recovery, and staff deactivation can delete sessions independently.

Before this change, `sessions` stored creation, last-seen, and expiration timestamps, and deleting
a session left no sign-out history. There was no general authentication audit table. The new
event table preserves access history independently of sessions. Sales-day quality and stock
movement audits continue describing their own business events.

Owner interface: **Inventory -> Account & settings -> Sign-in activity**, beside the
existing account and staff controls. Staff cannot read the business's account activity.

## Additive table

Migration `010_account_activity` follows `009_wall_clock_revisions`, preserving all earlier
migration files and their checksums. Table: `account_activity_events`.

| Column | PostgreSQL contract |
| --- | --- |
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `business_id` | `uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE` |
| `user_id` | `uuid NOT NULL`, with `(business_id, user_id)` referencing `users(business_id, id)` using `ON DELETE RESTRICT` |
| `display_name` | Nonblank `text NOT NULL`; snapshot of the name when the event occurs |
| `email` | Nonblank normalized `text NOT NULL`; snapshot when the event occurs |
| `role` | Existing `user_role` type, `NOT NULL`; snapshot when the event occurs |
| `event` | `text NOT NULL CHECK (event IN ('signed_in', 'signed_out'))` |
| `occurred_at` | `timestamptz NOT NULL DEFAULT clock_timestamp()` |

Add an index on `(business_id, occurred_at DESC, id DESC)` for the owner's newest-first feed.
The compound user reference prevents an event from linking a user from a different business.
Identity snapshots keep older entries readable after later profile changes. Account deactivation
does not remove events. There is no product or sales-data linkage.

Store no passwords, cookie values, CSRF tokens, session tokens or their hashes, Google tokens,
IP addresses, or device fingerprints in this table or response. There are no update/delete
activity endpoints and no automatic retention purge. Existing full-database
backup procedures include the table. Future business/account deletion or retention policy
changes remain a database-owner decision.

## Event meanings and atomic writes

- `signed_in`: a successful new authenticated session created after password sign-in, password
  registration, invitation acceptance, Google sign-in, or completed Google store registration.
  Insert the event with the new session in one transaction. A failed session creation or event
  write rolls back both; failed credentials and abandoned Google flows create no entry.
- `signed_out`: the user explicitly signs out and the backend deletes that session. Delete the
  exact matching session with `DELETE ... RETURNING user_id`; insert one event for the removed
  user's identity in the same transaction. No removed session means no new event. Concurrent or
  retried deletion therefore cannot create duplicate sign-out entries. Existing endpoint CSRF
  protection and authentication remain in place. A retry after the browser has lost its session
  may retain the current unauthorized response; it must not create another log entry.

Session-start logging is centralized in `AuthRepository.issue_session`. Its internal
`record_sign_in=False` option suppresses the start event for the Google **link identity** refresh at
`auth_routes.google_callback`; connecting Google while already signed in is not a new sign-in.
Explicit sign-out logging is in the `AuthRepository.sign_out` override, used by the normal
`/api/v1/auth/sign-out` route. Current password/session behavior and transactional boundaries
remain intact. These are server-created events; the client cannot submit arbitrary activity.

Do not label expiration, closing a browser, losing connectivity, password changes, password
recovery, or owner-triggered deactivation as explicit sign-out. Do not infer whether someone is
currently online from the latest event. If a session expires without explicit sign-out, its
history can correctly contain a sign-in without a corresponding sign-out.

Do not backfill earlier sign-ins from live sessions, infer older sign-outs, or fabricate
historical entries. The owner interface must explain that the log begins when this feature is
enabled. An empty response means no account events have been recorded for this feature.

## Owner read API

`GET /api/v1/auth/activity?limit=50&before=<opaque-cursor>&event=signed_in&search=owner`

- Use the existing cookie-session authentication used by `/api/v1/auth/members`.
- Require owner role on the server before querying activity.
- Derive `business_id` from the authenticated principal; there is no client-supplied business
  selector. Every query includes that business ID, including cursor follow-up reads.
- `limit` defaults to 50 and accepts whole numbers from 1 through 100. Invalid limits or malformed
  cursors return 422. Missing, expired, or unavailable accounts return the existing 401; staff
  requests return 403.
- Optional `event` accepts only `signed_in` or `signed_out`; omit it to include both. Optional
  `search` accepts up to 160 characters and matches a case-insensitive literal substring of the
  saved actor `display_name` or `email`. Trim outer whitespace; an empty search applies no actor
  filter. SQL wildcard characters such as `%` and `_` are treated as literal search input. Apply these
  filters to the complete business history before pagination. Invalid filters return 422.
- Sort by `(occurred_at DESC, id DESC)`. A subsequent page uses the decoded cursor pair with
  `(occurred_at, id) < (cursor_time, cursor_id)`, avoiding offset duplicates when new events
  arrive. Read `limit + 1` rows to determine whether another page exists. Encode only the final
  returned timestamp and UUID in an opaque cursor; no secrets are included. Validate decoded
  types and always apply the owner's business scope, regardless of cursor contents.
- The interface resets the cursor when the actor search or event filter changes. **Refresh**
  replaces the visible list with the newest matching page. **Load older activity** appends the
  next matching page. Neither operation changes account events.
- Return UTC ISO timestamps. The interface formats them in the saved business timezone and shows
  that timezone. Read responses should use `Cache-Control: no-store`.

```json
{
  "data": {
    "events": [
      {
        "id": "00000000-0000-4000-8000-000000000010",
        "businessId": "00000000-0000-4000-8000-000000000001",
        "userId": "00000000-0000-4000-8000-000000000002",
        "displayName": "Example Owner",
        "email": "owner@example.test",
        "role": "owner",
        "event": "signed_in",
        "occurredAt": "2026-11-10T08:30:00.123456+00:00"
      }
    ],
    "nextCursor": null
  }
}
```

The entry above illustrates the contract only; it is not collected or seeded account activity.
There is no date-range filter. Each event displays its saved date and time.

The browser-only demonstration does not show shared account activity or request this endpoint.
The owner card handles an older server's 404/501 response as **Sign-in activity is not configured**,
rather than presenting an empty live activity feed. Its fixed-height, keyboard-accessible event
list scrolls internally (320px desktop, 288px mobile), keeping store settings accessible as more
events load.

## Verification scope

Use isolated synthetic businesses/accounts and disposable database schemas. Cover successful
password/Google/invitation starts, failed credentials, linking without a false sign-in, explicit
sign-out, repeat/concurrent sign-out, atomic rollback, UTC timestamps, identity snapshots,
deactivated accounts, expired sessions, owner/staff protection, cross-business isolation,
same-timestamp cursor ordering, full-history actor/event filtering, literal wildcard searches,
and malformed pagination/filter values. Verify that no secrets appear
in the table or read response and that no pre-feature history is invented.

Run `python -m pytest backend/tests` for implementation changes and the existing schema contract
check. Include the new table and transactional up/down migration in schema verification without
changing old migrations. Frontend changes require the project typecheck, lint, and production
build, plus focused owner/staff, pending/unavailable, pagination, and mobile behavior checks.
