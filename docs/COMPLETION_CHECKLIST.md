# StockCast implementation and verification checklist

Reviewed against this branch: 2026-10-01. Implementation, executable checks, and external research
or hosting evidence are distinct records.

| Requirement                 | Implementation                                                                            | Verification                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Shared local/hosted startup | `npm start`; PostgreSQL, migrations, owner, API, worker, frontend                         | Compose CI starts the same command                                                               |
| Clean installation          | Frontend lockfile repaired; Python package discovery/migration data configured            | Clean npm installation/build and Python package checks                                           |
| Authentication/access       | Session/password/CSRF, business isolation, owner/staff enforcement                        | PostgreSQL API integration tests                                                                 |
| Inventory and sales         | Transactional writes, idempotency, audited stock counts/deliveries                        | API tests and full-stack smoke check                                                             |
| Frontend integration        | Products, sales, deliveries, imports, profile/settings, exports, Python forecasts/restock | Typecheck/lint/build and authenticated web/API checks                                            |
| Historical imports          | Validated SKU mapping, content hash, stored outcomes, stock preserved                     | PostgreSQL test and smoke check                                                                  |
| Official XGBoost            | Python CPU package; validation selection and recursive final testing                      | Real training, test-data perturbation check, worker smoke check                                  |
| Saved forecast outputs      | Immutable input snapshot, model JSON, parameters/weights, metrics and future predictions  | Queue/worker/API checks                                                                          |
| Worker failure recovery     | Failed status commits; later runs continue; session locks detect interruption             | PostgreSQL failure/next-job integration check                                                    |
| Restock trigger             | Current stock and operating forecast/baseline; zero quantity above ROP                    | Formula tests and dashboard checks                                                               |
| Backups/restart persistence | PostgreSQL dump, persistent database/model volumes                                        | CI separate-database restore and container recreation                                            |
| Hosted URL/TLS              | Caddy/domain environment configuration                                                    | Verify DNS/HTTPS and recovery on the chosen host                                                 |
| Partner research            | Provenance and evaluation fields preserve separation                                      | Confirm partner, permission, ledger interpretation, evaluation cutoffs and results with the team |
| Groupmate helper            | Standalone ISO-date helper remains reserved                                               | [Task contract](../backend/docs/RESERVED_DATE_HELPER.md)                                         |

An executed successful workflow is implementation evidence; a listed CI check is not a fabricated
pass. Actual hosting and research outcomes are recorded after they occur. The browser prototype's
custom booster is not the official XGBoost runtime.
