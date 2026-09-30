# StockCast completion checklist

Last reviewed: 2026-09-30. “Complete” means the repository contains implementation plus automated
or recorded workflow evidence. External research and deployment work is not marked complete from
code alone.

| Requirement                                       | Status                   | Evidence / blocker                                                                                                                                               |
| ------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL schema, pool, migration runner, server | Complete locally in code | `backend/db/`, `backend/app/main.py`, and `backend/app/db.py`; live PostgreSQL rerun is still required in the target environment.                                |
| Reproducible Python package installation          | In progress              | Python metadata and requirements exist; a clean-environment install still needs to be recorded.                                                                  |
| Authentication and owner/staff authorization      | In progress              | Session/password implementation and permission enforcement exist; dependency installation and live PostgreSQL workflow tests remain blocked in this environment. |
| Products/settings/sales/receipts API              | Partial                  | Core writes, authentication, offset paging, and optional idempotency keys exist; sale correction/void policy still requires confirmation.                        |
| Frontend/API integration                          | Partial                  | Explicit API mode supports sign-in and server-backed products, sales, receipts, and settings; import/forecast/recommendation views still use demo state.          |
| Safe historical imports                           | Partial                  | Validated SKU-mapped historical imports preserve row errors and do not mutate stock; file preview/UI and partner-specific mapping remain.                        |
| Verified XGBoost                                  | Blocked externally       | No verified XGBoost runtime is installed; partner data and preregistered evaluation cutoffs are unavailable.                                                     |
| Forecast persistence and worker                   | Partial                  | Queue/read APIs and a Python worker persist product-level validation/final-test results and future baseline forecasts; deployment scheduling remains.            |
| Conditional reorder recommendations               | Partial                  | The API persists rule-v1 snapshots and returns zero suggested quantity above the reorder trigger; forecast-linked generation remains.                            |
| Exports                                           | Partial                  | Authenticated CSV exports exist for sales and inventory movements; UI download actions and partner review remain.                                                |
| Backup/restore verification                       | Blocked externally       | Requires an available PostgreSQL instance and selected deployment environment.                                                                                   |
| Real partner evaluation                           | Blocked externally       | Partner, permission, records, evaluator responses, and research outcomes remain pending.                                                                         |

## Non-negotiable boundaries

- Generated records are `demo`, never partner evidence.
- The custom browser boosted-tree module is not verified XGBoost.
- Final-test data cannot select parameters, ensemble weights, eligibility, or intervals.
- Real partner storage cannot begin before authentication, authorization, backup, restore, and
  retention arrangements are tested.
