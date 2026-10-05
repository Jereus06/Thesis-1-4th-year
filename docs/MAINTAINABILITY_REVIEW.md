# Separate engineering review

Maintainability is assessed through source, documentation, regression checks, and review of a
change. It is not a client survey characteristic and has no invented numeric score.

This review concerns the available workspace on 2026-10-05. It is engineering evidence for the
software change, not a completed thesis evaluation or a standards certification.

| Review area | Evidence and review procedure |
| --- | --- |
| Application boundaries | React/TypeScript remains under `src/`; the FastAPI API and separate official Python XGBoost worker remain under `backend/app/`. No second backend was introduced. |
| Permission changes | Read `auth_routes.py`, `permissions.ts`, and `account-maintenance.tsx` together. Session-authenticated reads work; mutations retain CSRF protection and owner/business checks. Focused regression checks cover read headers, write rejection, and management failures. |
| Forecast change isolation | `data_quality.py` shares effective review precedence with usable-history bounds. Immutable snapshots retain preparation provenance. Regression checks cover reviewed zeros, excluded/unknown dates, timezone cutoffs, frozen inputs, and expired dates. |
| Evaluation boundaries | Normal Refresh saves its planned split; the worker retains actual usable counts. Calibration and final-test mutation checks verify that those observations cannot choose model parameters, ensemble weights, or methods. |
| Timing definitions | Saved phase scopes are versioned and measured separately. Unexecuted phases remain unavailable; legacy scopes remain unknown. Controlled-clock and real database tests cover persistence and interrupted publication. |
| Survey evolution | The client questionnaire has stable item IDs and a version. Submitted evidence is separate from local drafts and technical review. Review the additive migration and authorization tests before adopting a new questionnaire version. |
| Database history | Existing migration files are compared with their initial SHA-256 values. New durable survey storage uses an additive migration; previous migrations must retain their bytes. |
| Operator documentation | README, project context, user guide, and separate API/browser measurement procedures describe current behavior and distinguish synthetic verification from partner evidence. |

The required build, type, lint, backend, database, and container checks and their actual outcomes
are recorded in [the verification record](REVIEW_VERIFICATION.md). Existing Fast Refresh warnings
should remain visible in lint results rather than being reported as a clean warning-free run.

Before using this work as research evidence, the team still needs to review the questionnaire
wording and administration, confirm the future partner's records and reviewed-day policy, agree
performance targets, and assess a representative maintenance change. This document does not
invent completed client participation, a validated instrument, or maintenance effort measurements.
