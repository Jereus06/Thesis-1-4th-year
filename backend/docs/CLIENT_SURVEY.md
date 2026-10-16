# Client survey contract

Migration `007_client_survey` adds durable submissions and item answers. Migrations 001–006 are
unchanged. [The canonical questionnaire](../app/client_survey_v1.json) is version
`stockcast-client-survey-v1`: twelve statements across the four client-rated characteristics.
Maintainability is assessed through [engineering review](../../docs/MAINTAINABILITY_REVIEW.md).

All routes use `/api/v1/businesses/{businessId}/survey` and require an authenticated membership
in that exact business. Reads need the session cookie; POST retains CSRF and Origin checks.

| Route | Access and result |
| --- | --- |
| `GET /questionnaire` | Owner/staff; canonical version, scale, characteristics and statements. |
| `POST /submissions` | Owner/staff; server role, provenance and UTC timestamp; first save 201, identical replay 200. |
| `GET /submissions` | Owner sees this business/version; staff sees only their own submission. |
| `GET /summary` | Owner business/role aggregates; staff only their own submitted evidence. |
| `GET /export.csv` | Owner only; one row per submitted item with identifiers, version, role, timestamp, provenance and response status. |

POST accepts `questionnaireVersion`, a client-generated UUID `submissionId`, and all twelve unique
item answers: `itemId`, `rating`, and `responseStatus`. A rated answer requires a strict integer
1–5; unanswered/not-applicable require null. Status is `rated`, `unanswered`, or `not_applicable`.
At least one rated item is required. Unknown items/versions, duplicates, invalid ratings and
client-supplied identity/role/timestamp/provenance fields are rejected. The authenticated database
membership maps owner to `owner_manager` and staff to `staff`.

Each participant has one immutable final submission per version. Identical UUID/content retries
return the existing record without increasing participant counts. Changed content or a second
identifier returns 409. The participant row lock serializes independent session submissions.
Stored questionnaire wording and data origin retain provenance; changing the current business
origin does not relabel submitted demonstration responses as client findings.

Item and characteristic means weight every valid rated response equally. Overall mean uses all
valid item responses, not an average of characteristic means. Null/NA/unanswered are excluded.
Summary fields distinguish participants, contributing participants, valid response counts, and
rating frequencies; empty means are null. Owner summaries retain role groups and stored origin
counts. CSV fields use standard CSV quoting, and staff/other-business access is rejected.

Local drafts and archived prototype ratings are never automatically uploaded, included in server
summaries, or described as centrally collected evidence. Normal startup seeds no responses.
Submitted records are included in PostgreSQL backup/restore. These software features do not
establish approved questionnaire wording, actual partner participation, or research findings.
