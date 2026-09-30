# StockCast completion checklist

Last reviewed for the Python migration: 2026-09-30. “Complete” means the repository contains implementation plus automated
or recorded workflow evidence. External research and deployment work is not marked complete from
code alone.

| Requirement                                       | Status                   | Evidence / blocker                                                                                                                                                            |
| ------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL schema, pool, migration runner, server | Complete locally in code | `backend/db/` and `backend/app/`; live PostgreSQL rerun still required in the target environment.                                                                             |
| Reproducible Node/package installation            | In progress              | Node version and lockfiles require reconciliation.                                                                                                                            |
| Python FastAPI migration                          | In progress              | Configuration, DB lifecycle, migrations, auth, products, settings, sales, movements, and chronological forecast core exist; runtime dependencies could not be installed here. |
| Authentication and owner/staff authorization      | In progress              | Python session, CSRF, membership, and permission enforcement exist; live PostgreSQL workflow tests remain blocked in this environment.                                        |
| Products/settings/sales/receipts API              | Partial                  | Core writes exist; authentication, paging, retry safety, corrections, and expanded movement rules remain.                                                                     |
| Frontend/API integration                          | In progress              | Credentialed TypeScript API client and DTO conversion exist; screens/store still use the explicit localStorage demonstration.                                                 |
| Safe historical imports                           | Not started              | Tables exist; preview/mapping/idempotent workflow does not.                                                                                                                   |
| Verified XGBoost                                  | Blocked externally       | Official-package chronological training code exists, but XGBoost is not installed/run and partner data/cutoffs are unavailable, so verification is not claimed.               |
| Forecast persistence and worker                   | Not started              | Tables exist; execution API/worker does not.                                                                                                                                  |
| Conditional reorder recommendations               | Not started              | Browser calculation exists; persisted server workflow does not.                                                                                                               |
| Exports                                           | Not started              | No operational export endpoints.                                                                                                                                              |
| Backup/restore verification                       | Blocked externally       | Requires an available PostgreSQL instance and selected deployment environment.                                                                                                |
| Real partner evaluation                           | Blocked externally       | Partner, permission, records, evaluator responses, and research outcomes remain pending.                                                                                      |

## Non-negotiable boundaries

- Generated records are `demo`, never partner evidence.
- The custom browser boosted-tree module is not verified XGBoost.
- Final-test data cannot select parameters, ensemble weights, eligibility, or intervals.
- Real partner storage cannot begin before authentication, authorization, backup, restore, and
  retention arrangements are tested.
