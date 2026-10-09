# Remaining thesis work for the group

The 9 October 2026 manuscript and current chapter companions align the retail scope, Python
architecture, daily forecasting rules, public-data procedure, and client questionnaire. The
repository's 5 October software records now supply attributed engineering evidence in Table 3.14.
The remaining tasks below can be completed by the group without obtaining confidential sales files.

## Prepare the public retail dataset

Select a traceable source that permits the intended use and provides product identifiers,
dated quantities, consistent counting units, and sufficient daily history. Retain its citation,
version or access date, licence or permission, original file checksum, field mapping, and exclusion
counts. Preserve a copy of the original before converting it. Extra columns may be ignored through
the guided importer; ambiguity and invalid required fields must be resolved before saving.

Audit calendar completeness and product history before choosing the experiment. Missing
transactions do not establish zero sales. Only documented confirmed-zero dates may be classified
as zero; closures, stockouts, incomplete records, and unknown dates remain exclusions. Do not fill
unknown dates with zeros merely to make a product eligible for XGBoost. Report the baseline-only
outcome if a source cannot meet the implemented gates. Any stock or lead-time values absent from
the source can support clearly labelled controlled arithmetic checks, rather than claims about
that retailer's observed inventory.

## Record the forecasting comparison

Fix the product set, units, horizon, chronological training, selection/calibration and final-test
cutoffs before inspecting the final errors. Keep the same product-date-origin-horizon observations
for Moving Average, official Python XGBoost, and any validation-supported ensemble. Preserve saved
run inputs, model decisions, exclusions, observation counts, per-product metrics, and the method
used to combine comparable product results.

Fill Table 3.13 only from this documented experiment. Generated performance fixtures and early
dashboard demonstration values are not empirical forecast findings. Describe public-source
results as benchmark findings for that dataset. Save enough records for another group member to
reproduce the comparison without accessing private client files.

## Replace the prototype screenshots

Capture Figures 3.6–3.10 from the current normal Python/API application using a labelled public-data
or software-verification account. Show the Overview, product inventory, historical CSV import,
forecast evidence, and restocking advice. Record the source version, date and data provenance.
Ensure the screenshots display current controls and terms, and update the accompanying text to
describe exactly what each screenshot shows. Retain the old illustrations as an archive rather
than treating their generated errors as current results.

## Complete the maintenance review

Document one representative, authorised maintenance change: its purpose, affected modules,
relevant regression checks, and observed effort. Review whether it requires unrelated changes
and whether another developer can reproduce the workflow using the documentation. Record the
reviewer's observations; do not invent a maintainability rating from the client questionnaire.
The groupmate-reserved date helper and its dedicated tests remain reserved under `AGENTS.md`.

Client questionnaire administration is a separate activity with actual consenting owner/manager
and staff respondents. The public-data fallback supports the forecast experiment without
confidential records; it does not supply survey responses.
