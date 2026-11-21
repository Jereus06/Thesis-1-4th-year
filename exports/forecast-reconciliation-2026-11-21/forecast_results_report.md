# StockCast saved forecasting evidence reconciliation

Inspection date: 21 November 2026 (Asia/Singapore, UTC+08:00). Database business timezone: Asia/Manila (also UTC+08:00).

## Main finding

The latest completed saved run does not reproduce the supplied thesis scores. It has six bottle products and two piece products with complete matching evidence, but its final test spans **28 September–27 October 2026 (30 days)**, not **14–27 October (14 days)**. Even restricting these saved predictions to the thesis dates does not reproduce the supplied values. A date subset is not a newly evaluated 14-day forecast.

**Precision limitation:** original unrounded daily predictions are not available in the inspected saved evidence. PostgreSQL stores predictions and actuals as numeric(18,3). This report computes every error directly from all available saved digits with Decimal precision 50; it does not average product RMSEs or round intermediate errors. These are reproducible **saved-precision** results, not a claim to recover pre-storage full-precision model outputs. Requested original-full-precision reproduction is therefore blocked by missing evidence, not by localhost/database availability.

Both http://localhost:8080 and http://localhost:8080/api/v1/health returned HTTP 200. Database extraction used a repeatable-read, read-only transaction. No application code, settings, sales, model artifacts or saved forecasts were changed; no refresh, training, tests, restart or GitHub push was performed. Only evidence/export files were written.

## 1. Saved run and provenance

| Field | Saved value |
| --- | --- |
| id | 05f5f70c-4f46-4470-a6cf-e43c522ea0c9 |
| business_id | 1319506c-4a94-445d-98d1-e50305b284f9 |
| data_origin | partner |
| status | completed |
| algorithm_name | xgboost.XGBRegressor |
| algorithm_version | 3.0.2 |
| xgboost_verified | False |
| training_start | 2025-10-28 |
| training_end | 2026-08-30 |
| validation_start | 2026-08-31 |
| validation_end | 2026-09-27 |
| final_test_start | 2026-09-28 |
| final_test_end | 2026-10-27 |
| forecast_horizon_days | 30 |
| started_at | 2026-11-21 07:20:38.005926+00:00 |
| completed_at | 2026-11-21 07:20:50.206436+00:00 |
| created_at | 2026-11-21 07:20:30.132260+00:00 |

The run completed at **15:20:50 on 21 November 2026, UTC+08:00**. Its immutable input snapshot was captured at 2026-11-21T07:20:30.226340+00:00. The current business display name is Rosemenia motorshop.

### Import reference

| Field | Value |
| --- | --- |
| id | df1e2aed-d6ba-4295-828e-403fc08da5f1 |
| source | csv |
| data_origin | partner |
| original_filename | Sales_Import_With_SKU.csv |
| content_sha256 | 0321797983e5f894c91b647ea8fb593fb6f08e972e3c94c95593ff2c723b8d44 |
| status | completed |
| total_rows | 10299 |
| accepted_rows | 10299 |
| rejected_rows | 0 |
| started_at | 2026-11-20 17:20:19.767659+00:00 |
| completed_at | 2026-11-20 17:20:19.767659+00:00 |
| created_at | 2026-11-20 17:20:19.767659+00:00 |

All 10,299 current non-voided sales records reference that single CSV import. They aggregate to 10,283 product-date quantities. A read-only full join found zero missing keys on either side and zero quantity differences between current daily aggregates and the frozen run snapshot. The snapshot contains 208 product IDs, 10,299 source sales rows, no day-quality classifications, and coverage from 2025-10-28 through 2026-10-27. There are 208 current catalog products; metadata is joined from that catalog because the snapshot stores product IDs, not historical SKU/name/unit copies.

The import hash identifies the recorded import payload; the original file bytes and external authorization were not independently available for verification. The source/import linkage is reconstructed from the matching current sales ledger: the snapshot itself does not retain per-sale import IDs. The `partner` data-origin flag and business name are application labels, not proof of a real partner, authorized client collection, public-data license, or nonsynthetic provenance. The team must supply that documentation before describing these as empirical client findings.

## 2. Chronological dates and saved configuration

| Stage | Dates | Calendar days |
| --- | --- | --- |
| Training | 2025-10-28 to 2026-08-30 | 307 |
| Validation overall | 2026-08-31 to 2026-09-27 | 28 |
| Selection portion | 2026-08-31 to 2026-09-17 | 18 |
| Reserved interval calibration | 2026-09-18 to 2026-09-27 | 10 |
| Final test | 2026-09-28 to 2026-10-27 | 30 |
| Future forecast for the eight complete-history products | 2026-10-28 to 2026-11-26 | 30 |

Saved settings:

```json
{
  "cv_folds": 3,
  "timezone": "Asia/Manila",
  "top_n_products": 8,
  "target_cover_days": 30,
  "minimum_nonzero_days": 100,
  "forecast_horizon_days": 30,
  "minimum_history_weeks": 8,
  "moving_average_window": 28
}
```

Saved run configuration excluding per-product summaries (complete configuration, including all product summaries, is in `saved_forecast_configuration.json`):

```json
{
  "cvFolds": 3,
  "runtime": "xgboost.XGBRegressor",
  "lagPolicy": "XGBoost requires a complete observed-or-confirmed-zero daily training sequence",
  "refreshSplit": {
    "policy": "horizon_matched_selection_calibration_v2",
    "trainingCalendarDays": 307,
    "finalTestCalendarDays": 30,
    "validationCalendarDays": 28,
    "trainingReserveCalendarDays": 100,
    "validationSelectionCalendarDays": 18,
    "validationCalibrationCalendarDays": 10,
    "minimumValidationObservationsForIntervals": 20
  },
  "requestedFrom": "web",
  "trainingScope": {
    "limit": 8,
    "ranking": "training_sales_volume_v1",
    "products": [
      {
        "rank": 1,
        "productId": "a4410c6a-c2fe-42d3-84fc-08e2fa674ad9",
        "trainingQuantity": "693.0"
      },
      {
        "rank": 2,
        "productId": "67119a4a-ee1c-4d34-8ae7-d507003ceb9f",
        "trainingQuantity": "603.0"
      },
      {
        "rank": 3,
        "productId": "babeb7f0-ff8d-4799-a241-9509b438b9d9",
        "trainingQuantity": "603.0"
      },
      {
        "rank": 4,
        "productId": "1a81bcb0-f0db-4272-90c2-b59776b03909",
        "trainingQuantity": "601.0"
      },
      {
        "rank": 5,
        "productId": "10af5bac-d96d-4437-b8b4-e61196470625",
        "trainingQuantity": "571.0"
      },
      {
        "rank": 6,
        "productId": "b1d6ba9d-b776-48a2-aa35-5478fff995d4",
        "trainingQuantity": "541.0"
      },
      {
        "rank": 7,
        "productId": "c56610b3-f784-4d88-8201-c0eb1b6698d5",
        "trainingQuantity": "534.0"
      },
      {
        "rank": 8,
        "productId": "c6b927fb-7370-4629-a766-e1ef3f5a39e5",
        "trainingQuantity": "520.0"
      }
    ],
    "trainingEnd": "2026-08-30",
    "trainingStart": "2025-10-28"
  },
  "fallbackPolicy": "contiguous_tail_product_origin_v1",
  "selectionSplit": "validation",
  "xgboostVersion": "3.0.2",
  "evaluationSplit": "final_test",
  "excludedTargets": "closures, incomplete records, full/partial stockouts, and unclassified absent dates",
  "cvValidationDays": 14,
  "historyEndPolicy": "usable_active_observations",
  "missingDayPolicy": "explicit_classification_required",
  "preparationSource": "frozen_prepared_snapshot",
  "evaluationProtocol": "recursive_fixed_cutoff",
  "operationalRefitEnd": "2026-10-27",
  "preparationPolicyVersion": "2026-10-05"
}
```

The eight products were selected by training-period sales volume, with top-N=8. Eligibility requires a complete observed-or-confirmed-zero daily sequence, at least eight calendar weeks (56 days) and 100 nonzero training days; these are separate thresholds. Each included product has 307 training observations, all nonzero. Moving Average window is 28 days, not the 30-day forecast horizon.

The source implements official Python XGBoost, chronological tuning, and recursive fixed-cutoff testing. Final-test evaluation fits on training plus validation history through September 27, then forecasts recursively without incorporating final-test actuals. An operational model is subsequently refitted through October 27 for future forecasts; the saved JSON model artifacts are these operational models, not a stored daily final-test prediction ledger. Eight model files were inspected; each contains `learner` and `version`, with no separate unrounded daily test export.

The saved run records `xgboost_verified=false`. The algorithm name/version and source identify the official implementation, but this flag must not be presented as a verified run. No independent algorithm validation was performed here. A source default such as random seed 42 is not a separately captured run configuration field. The saved configuration records a 20-observation interval threshold but these products have 10 reserved calibration observations and intervals marked available; do not claim 20 reserved observations or a confirmed 80% empirical coverage from that label. Interval checking is separate from the point-error reconciliation requested here.

### Included products and selected model parameters

| SKU | Product | Unit | Test days | Depth | Trees | Learning rate | XGB ensemble weight | Operating method |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RM-OIL-001 | Petron Rev-X | bottle | 30 | 3 | 43 | 0.05 | 0.5119581094347121 | xgboost |
| RM-OIL-004 | Petron Sprint 4T | bottle | 30 | 3 | 43 | 0.05 | 0.5067182797590032 | xgboost |
| RM-OIL-007 | Petron Sprint 4T sc200 1L | bottle | 30 | 4 | 26 | 0.05 | 0.4632789715918131 | movingAverage |
| RM-OIL-008 | Petron Sprint 4T sc200 800ml | bottle | 30 | 3 | 41 | 0.05 | 0.4962014492048958 | movingAverage |
| RM-OIL-013 | Shell Advance 10W-40 1L | bottle | 30 | 3 | 14 | 0.1 | 0.4768913433586082 | movingAverage |
| RM-OIL-014 | Shell Advance 10W-40 800ml | bottle | 30 | 3 | 1 | 0.05 | 0.5170036758662977 | xgboost |
| RM-SPK-003 | Spark Plug NGK D6EA | piece | 30 | 3 | 5 | 0.05 | 0.47293255187681593 | movingAverage |
| RM-SPK-007 | Spark Plug NGK D8EA | piece | 30 | 4 | 60 | 0.05 | 0.5105503816406659 | xgboost |

## 3. Matching evidence and exclusions

The run contains 844 daily final-test model rows: 364 Moving Average, 240 XGBoost, and 240 Ensemble. There are 364 distinct product-date keys. The CSV retains every key, including incomplete-model rows, with explicit inclusion flags and blank missing values, never fabricated zero predictions.

Inclusion requires exactly one finite actual and prediction per model on each of all 30 test dates, identical actual quantities and dates across the three models, and matching frozen-snapshot actuals. The eight included products supply 240 common observations per model: **six bottle products × 30 days = 180**, and **two piece products × 30 days = 60**. No matched actual/snapshot discrepancies were found (0 anomalies). There are 124 additional Moving-Average-only product-date observations across 27 other products; these are excluded from all three pooled model calculations. The remaining 173 catalog products have no final-test prediction rows. In total, 200 products are excluded: 192 have insufficient/noncontiguous training evidence and eight have no training history. Product-by-product saved explanations appear in Appendix A.

The October 14–27 subset uses exactly the same eight products and 14 dates: **84 bottle** and **28 piece** observations per model. No product or date was chosen based on which model performed better.

## 4. Calculations from saved daily errors

For each counting unit, common product-date set S and model m:

`error(i,m) = prediction(i,m) - actual(i)`

`MAE(m) = sum(abs(error(i,m))) / N`

`RMSE(m) = sqrt(sum(error(i,m)^2) / N)`

N counts product-date observations, not products. Bottle and piece are never combined. All intermediate arithmetic uses the stored decimal strings without further rounding; reported metrics below are rounded only for presentation.

### Full saved final test: September 28–October 27

| Unit | Model | Products | N | Sum absolute errors | Sum squared errors | MAE | RMSE |
| --- | --- | --- | --- | --- | --- | --- | --- |
| bottle | Moving Average | 6 | 180 | 147.104 | 182.993984 | 0.817244444 | 1.008282324 |
| bottle | XGBoost | 6 | 180 | 147.627 | 187.836769 | 0.820150000 | 1.021536884 |
| bottle | Ensemble | 6 | 180 | 146.889 | 183.703055 | 0.816050000 | 1.010233898 |
| piece | Moving Average | 2 | 60 | 47.361 | 51.543431 | 0.789350000 | 0.926853377 |
| piece | XGBoost | 2 | 60 | 47.354 | 53.636562 | 0.789233333 | 0.945485431 |
| piece | Ensemble | 2 | 60 | 46.905 | 51.874195 | 0.781750000 | 0.929822519 |

### Diagnostic thesis-date subset: October 14–27

| Unit | Model | Products | N | Sum absolute errors | Sum squared errors | MAE | RMSE |
| --- | --- | --- | --- | --- | --- | --- | --- |
| bottle | Moving Average | 6 | 84 | 67.814 | 91.023804 | 0.807309524 | 1.040969123 |
| bottle | XGBoost | 6 | 84 | 67.026 | 89.932394 | 0.797928571 | 1.034709495 |
| bottle | Ensemble | 6 | 84 | 67.149 | 89.545085 | 0.799392857 | 1.032479015 |
| piece | Moving Average | 2 | 28 | 21.687 | 24.377375 | 0.774535714 | 0.933070488 |
| piece | XGBoost | 2 | 28 | 22.826 | 27.415200 | 0.815214286 | 0.989502039 |
| piece | Ensemble | 2 | 28 | 21.976 | 25.592062 | 0.784857143 | 0.956034630 |

The subset is forecast steps **17–30** from the saved September 27 cutoff. It must not be called forecast steps 1–14 from an October 13 origin. Changing the date filter cannot recreate that earlier experiment.

### Stored summary metric cross-check (not a replacement for daily-error calculations)

| Unit | Model | Weighted saved MAE | sqrt(weighted saved RMSE squared) | Difference vs daily MAE | Difference vs daily RMSE |
| --- | --- | --- | --- | --- | --- |
| bottle | Moving Average | 0.817207333 | 1.008234244 | -0.000037111 | -0.000048080 |
| bottle | XGBoost | 0.820196000 | 1.021592566 | 0.000046000 | 0.000055682 |
| bottle | Ensemble | 0.816028667 | 1.010197025 | -0.000021333 | -0.000036873 |
| piece | Moving Average | 0.789397500 | 0.926918324 | 0.000047500 | 0.000064947 |
| piece | XGBoost | 0.789188000 | 0.945455772 | -0.000045333 | -0.000029659 |
| piece | Ensemble | 0.781770500 | 0.929839050 | 0.000020500 | 0.000016531 |

The worker calculates summary metrics before numeric(18,3) prediction storage; metrics are themselves stored as numeric(18,6). Consequently the application score cards can differ slightly from recomputation of rounded saved predictions. The cross-check weights squared product RMSE by observation count and then takes a square root; it never averages product RMSE. These summary values cannot recover unrounded daily errors or the thesis-date subset. Rounding to 0.001 can perturb MAE and RMSE by at most approximately 0.0005 when actuals are unchanged; it cannot explain the much larger thesis differences below.

## 5. Comparison with supplied thesis values

| Unit | Model | Thesis MAE/RMSE | Full saved test | Same-date subset | Subset minus thesis |
| --- | --- | --- | --- | --- | --- |
| bottle | Moving Average | 0.972/1.184 | 0.817/1.008 | 0.807/1.041 | -0.164690/-0.143031 |
| bottle | XGBoost | 0.810/1.033 | 0.820/1.022 | 0.798/1.035 | -0.012071/+0.001709 |
| bottle | Ensemble | 0.879/1.084 | 0.816/1.010 | 0.799/1.032 | -0.079607/-0.051521 |
| piece | Moving Average | 0.829/0.983 | 0.789/0.927 | 0.775/0.933 | -0.054464/-0.049930 |
| piece | XGBoost | 0.873/1.064 | 0.789/0.945 | 0.815/0.990 | -0.057786/-0.074498 |
| piece | Ensemble | 0.859/1.026 | 0.782/0.930 | 0.785/0.956 | -0.074143/-0.069965 |

No model/unit pair reproduces the supplied thesis pair to three decimals. The number of products and units agrees (six bottle, two piece), but the user did not supply the thesis SKU roster, raw observations, import hash, run ID, training boundaries, model parameters, Moving Average window, or ensemble weights. Therefore identical product identities and data cannot be assumed simply from matching counts.

Only seven completed runs exist for this business in the inspected database: four have a 30-day final test (September 28–October 27), and three have a 23-day final test (October 5–27). None has October 14–27 as its saved test boundary. This does not prove an earlier external experiment never existed; it means that exact experiment is not preserved here.

The repository's `docs/thesis/README.md` identifies the available text companions as the October 9 revision. `docs/thesis/Chapter_3.md`, Table 3.13, still contains unreported dashes. The six numerical pairs compared above come from the user's supplied thesis excerpt, not a located results chapter. The Word master and a newer results chapter were not inspected.

### What explains the discrepancies, and what remains unknown

1. **Dates and horizon — confirmed mismatch:** 30 saved test days versus 14 thesis days. Even the overlap is a different position in a recursive forecast. This changes both observations scored and prediction difficulty.
2. **Product scope — counts agree, identity unverified:** the eight saved SKUs are listed above. Thesis SKU identities must be supplied to establish identity rather than count agreement.
3. **Data — saved source traced, thesis source unverified:** the current ledger exactly matches the latest snapshot, but no thesis raw CSV/hash was supplied. No values were edited or resampled to obtain agreement.
4. **Configuration — saved values known, thesis configuration missing:** the latest run uses MA window 28, horizon 30, top eight, 3 CV folds, selected depths/tree counts and product-specific ensemble weights. The original thesis configuration is unavailable, so no particular parameter can responsibly be named as the sole cause.
5. **Calculation precision — confirmed storage limitation:** original daily predictions were rounded on persistence; saved summary metrics use a different stored precision. This explains small application-vs-CSV differences, not the large thesis differences. Whether the thesis averaged product RMSE, used different dates, or rounded inputs is unknown without its worksheet.
6. **Provenance and implementation claims — require careful wording:** an import tagged `partner` is not documentation of consent or data origin; the run also retains `xgboost_verified=false`. Do not turn these system labels into research validation claims.
7. **Future revenue is not test accuracy:** expired forecasts for sparse products and revenue estimates concern future quantities/current prices. They do not remove the saved historical test evidence for these eight products and are not evidence of these thesis MAE/RMSE values.

The saved full-test results and the same-date subset also have different numerical rankings. Report both metrics, avoid a blanket winner claim, and never select or retune the operating model using these final-test comparisons. The existing operational selection belongs to validation.

## 6. Exact demonstration screens and their limits

These routes and control labels were checked against application source; localhost and health were read successfully. No authenticated browser was driven and no new screenshots were captured, so this is a source-confirmed demonstration guide, not a claim of a fresh visual test. Use the existing account; no credentials are included.

1. **Forecasts — http://localhost:8080/forecasts.** The **Top products for XGBoost** panel lists the eight ranked products and training-history dates. Use the product selector to choose each SKU in the included table. Under **Chart options**, choose **Daily** and enable **Compare forecasting methods**. The product chart shows saved actuals and model curves. These display controls do not retrain models.
2. On the same **Forecasts** screen, the **Moving Average**, **XGBoost**, and **Ensemble** score cards apply to the selected product. Expand **Technical details** for its MAE and RMSE. **Past forecast errors by product** lists the three model error columns and historical evidence. These are per-product saved metrics, not pooled bottle/piece scores; minor precision differences from the CSV are expected.
3. **Sales report — http://localhost:8080/sales-report.** Use **Actual versus forecast**, select a date range, product/counting unit, and a forecasting method if demonstrating the existing report. Do not label its unit-wide average as this matched-three-model experiment: it can include additional products with only Moving Average evidence. **Estimated revenue** is a future-value display and cannot demonstrate historical forecast MAE/RMSE.
4. **Data quality — http://localhost:8080/data-quality.** Read the missing/classified-date diagnostics to explain sparse-product exclusions. Do not save classifications during this demonstration.
5. **For the exact pooled unit results requested here, open this report and `forecast_evidence.csv`.** The present UI has no dedicated matched-three-model, bottle/piece pooled MAE/RMSE table or saved-run/import-hash audit panel. Do not imply an existing screen shows a statistic it does not. The CSV and report provide that audit trail without changing the application.

Do not click Refresh forecasts, upload/import, save settings, or alter records while demonstrating this preserved run. A future automatic or manual completed run can change what the live screen displays; use this report's fixed run ID to distinguish results.

## 7. How to use this evidence in the thesis

If the team chooses the current saved experiment, revise the dates, sample description and configuration together, and label the numerical table as recalculated from stored three-decimal daily predictions. Use the full 30-day table as the primary saved-run result. The 14-day subset is a diagnostic comparison only and must retain its September 27 forecast origin.

If the thesis must retain an October 14–27 experiment with its original forecast origin and full-precision scores, obtain its original raw evidence/run/configuration. That evidence is absent here; this inspection does not authorize or perform replacement training. Do not force the saved values to match the manuscript. Confirm original dataset authorization/provenance, exact eight thesis SKUs, and the earlier calculation worksheet before presenting causal explanations for every numeric difference.

Suggested factual wording: “A read-only audit of saved run 05f5f70c-4f46-4470-a6cf-e43c522ea0c9 identified complete daily final-test evidence for six bottle products (180 product-date observations) and two piece products (60 observations), covering 28 September–27 October 2026. MAE and RMSE were recomputed separately by counting unit on identical observations across all three models. Prediction storage was limited to three decimal places. The audit did not reproduce the previously supplied 14–27 October values.”

This audit is evidence reconciliation, not a new client survey, a new model validation study, a claim of inventory improvement, or confirmation of real partner findings.

## Appendix A. Every excluded product

| SKU | Product | Unit | MA test rows | XGB test rows | Ensemble test rows | Saved exclusion reason |
| --- | --- | --- | --- | --- | --- | --- |
| RM-BAT-001 | Battery 4L OD | piece | 0 | 0 | 0 | Training history: 16/307 classified calendar days, 16 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BAT-002 | Battery 5L OD | piece | 0 | 0 | 0 | Training history: 9/307 classified calendar days, 9 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BAT-003 | Battery 7L OD | piece | 0 | 0 | 0 | Training history: 7/307 classified calendar days, 7 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BOS-001 | BOSNY Black | can | 0 | 0 | 0 | Training history: 20/307 classified calendar days, 20 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BOS-002 | BOSNY Red | can | 0 | 0 | 0 | Training history: 26/307 classified calendar days, 26 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BOS-003 | BOSNY Blue | can | 0 | 0 | 0 | Training history: 16/307 classified calendar days, 16 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BOS-004 | BOSNY White | can | 0 | 0 | 0 | Training history: 19/307 classified calendar days, 19 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BOS-005 | BOSNY Gray | can | 3 | 0 | 0 | Training history: 21/307 classified calendar days, 21 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BPD-001 | Brake Pad MIO SOUL | set | 0 | 0 | 0 | Training history: 34/307 classified calendar days, 34 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BPD-002 | Brake Pad CLICK 125/150 | set | 0 | 0 | 0 | Training history: 35/307 classified calendar days, 35 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BPD-003 | Brake Pad RAIDER 150 REAR | set | 0 | 0 | 0 | Training history: 37/307 classified calendar days, 37 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BPD-004 | Brake Pad XRM TRINITY | set | 0 | 0 | 0 | Training history: 40/307 classified calendar days, 40 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BPD-005 | Brake Pad SNIPER FRONT | set | 0 | 0 | 0 | Training history: 47/307 classified calendar days, 47 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BPD-006 | Brake Pad WAVE 125 | set | 2 | 0 | 0 | Training history: 26/307 classified calendar days, 26 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BPD-007 | Brake Pad WAVE 110 | set | 7 | 0 | 0 | Training history: 34/307 classified calendar days, 34 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BPD-008 | Brake Pad HONDA BEAT | set | 0 | 0 | 0 | Training history: 45/307 classified calendar days, 45 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BPD-009 | Brake Pad ADV/PCX | set | 0 | 0 | 0 | Training history: 47/307 classified calendar days, 47 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BPD-010 | Brake Pad RAIDER 150 FRONT | set | 0 | 0 | 0 | Training history: 41/307 classified calendar days, 41 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BPD-011 | Brake Pad MIO | set | 0 | 0 | 0 | Training history: 36/307 classified calendar days, 36 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BRC-001 | Brake Cable RAIDER 150 | piece | 0 | 0 | 0 | Training history: 24/307 classified calendar days, 24 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BRC-002 | Brake Cable RAIDER J | piece | 0 | 0 | 0 | Training history: 24/307 classified calendar days, 24 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BRC-003 | Brake Cable WAVE/XRM | piece | 0 | 0 | 0 | Training history: 27/307 classified calendar days, 27 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BRC-004 | Brake Cable BARAKO/FURY | piece | 0 | 0 | 0 | Training history: 18/307 classified calendar days, 18 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BRC-005 | Brake Cable TMX/SUPREMO | piece | 0 | 0 | 0 | Training history: 24/307 classified calendar days, 24 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BRC-006 | Brake Cable CLICK | piece | 0 | 0 | 0 | Training history: 23/307 classified calendar days, 23 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BRC-007 | Brake Cable CT100/CT150 | piece | 0 | 0 | 0 | Training history: 22/307 classified calendar days, 22 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BRC-008 | Brake Cable BEAT SKYDRIVE | piece | 0 | 0 | 0 | Training history: 18/307 classified calendar days, 18 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BRG-001 | Bearing YBN 6004 | piece | 0 | 0 | 0 | Training history: 24/307 classified calendar days, 24 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BRG-002 | Bearing YBN 6005 | piece | 0 | 0 | 0 | Training history: 25/307 classified calendar days, 25 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BRG-003 | Bearing YBN 6200 | piece | 0 | 0 | 0 | Training history: 26/307 classified calendar days, 26 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BRG-004 | Bearing YBN 6201 | piece | 0 | 0 | 0 | Training history: 36/307 classified calendar days, 36 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BRG-005 | Bearing YBN 6202 | piece | 0 | 0 | 0 | Training history: 24/307 classified calendar days, 24 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BRG-006 | Bearing YBN 6203 | piece | 4 | 0 | 0 | Training history: 18/307 classified calendar days, 18 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BRG-007 | Bearing KOYO 6204 | piece | 2 | 0 | 0 | Training history: 28/307 classified calendar days, 28 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BRG-008 | Bearing YBN 6204 | piece | 1 | 0 | 0 | Training history: 33/307 classified calendar days, 33 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BRG-009 | Bearing JTEKT 6205 | piece | 0 | 0 | 0 | Training history: 23/307 classified calendar days, 23 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BRG-010 | Bearing YBN 6205 | piece | 0 | 0 | 0 | Training history: 22/307 classified calendar days, 22 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BRG-011 | Bearing YBN 6300 | piece | 0 | 0 | 0 | Training history: 22/307 classified calendar days, 22 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BRG-012 | Bearing YBN 6301 | piece | 0 | 0 | 0 | Training history: 27/307 classified calendar days, 27 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BRG-013 | Bearing YBN 6302 | piece | 0 | 0 | 0 | Training history: 25/307 classified calendar days, 25 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BRG-014 | Bearing HF 6303 | piece | 0 | 0 | 0 | Training history: 22/307 classified calendar days, 22 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BRG-015 | Bearing KOYO 6304 | piece | 0 | 0 | 0 | Training history: 22/307 classified calendar days, 22 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BRG-016 | Bearing JTEKT 6302 | piece | 0 | 0 | 0 | Training history: 33/307 classified calendar days, 33 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BSH-001 | Brake Shoe BARAKO | set | 0 | 0 | 0 | Training history: 31/307 classified calendar days, 31 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BSH-002 | Brake Shoe TMX/SUPREMO | set | 2 | 0 | 0 | Training history: 34/307 classified calendar days, 34 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BSH-003 | Brake Shoe TMX REAR | set | 0 | 0 | 0 | Training history: 24/307 classified calendar days, 24 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BSH-004 | Brake Shoe B120 | set | 0 | 0 | 0 | Training history: 27/307 classified calendar days, 27 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BSH-005 | Brake Shoe C100/XRM REAR WHITE | set | 0 | 0 | 0 | Training history: 38/307 classified calendar days, 38 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BSH-006 | Brake Shoe CT100 | set | 0 | 0 | 0 | Training history: 27/307 classified calendar days, 27 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BSH-007 | Brake Shoe MIO | set | 0 | 0 | 0 | Training history: 25/307 classified calendar days, 25 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BSH-009 | Brake Shoe HONDA CLICK | set | 0 | 0 | 0 | Training history: 26/307 classified calendar days, 26 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BSH-010 | Brake Shoe BEAT | set | 0 | 0 | 0 | Training history: 29/307 classified calendar days, 29 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-BSH-011 | Brake Shoe CB125 | set | 0 | 0 | 0 | Training history: 0/307 classified calendar days, 0 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-CHN-001 | Chain 428H- 110L | piece | 0 | 0 | 0 | Training history: 14/307 classified calendar days, 14 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-CHN-002 | Chain 428H- 120L | piece | 0 | 0 | 0 | Training history: 13/307 classified calendar days, 13 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-CHN-003 | Chain 428H- 130L | piece | 0 | 0 | 0 | Training history: 17/307 classified calendar days, 17 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-CLC-001 | Clutch Cable RAIDER 150 | piece | 0 | 0 | 0 | Training history: 21/307 classified calendar days, 21 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-CLC-002 | Clutch Cable RAIDER J | piece | 0 | 0 | 0 | Training history: 23/307 classified calendar days, 23 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-CLC-003 | Clutch Cable WAVE/XRM | piece | 0 | 0 | 0 | Training history: 18/307 classified calendar days, 18 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-CLC-004 | Clutch Cable BARAKO/FURY | piece | 0 | 0 | 0 | Training history: 20/307 classified calendar days, 20 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-CLC-005 | Clutch Cable TMX/SUPREMO | piece | 0 | 0 | 0 | Training history: 20/307 classified calendar days, 20 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-CLC-006 | Clutch Cable CLICK | piece | 0 | 0 | 0 | Training history: 25/307 classified calendar days, 25 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-CLC-007 | Clutch Cable CT100/CT150 | piece | 0 | 0 | 0 | Training history: 15/307 classified calendar days, 15 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-CLC-008 | Clutch Cable BEAT SKYDRIVE | piece | 0 | 0 | 0 | Training history: 24/307 classified calendar days, 24 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-ETC-001 | CARBURETOR REPAIR KIT | kit | 0 | 0 | 0 | Training history: 40/307 classified calendar days, 40 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-ETC-002 | CVT CLEANER | can | 0 | 0 | 0 | Training history: 31/307 classified calendar days, 31 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-ETC-003 | TIRE SEALANT | bottle | 0 | 0 | 0 | Training history: 32/307 classified calendar days, 32 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-ETC-004 | FIESTA GAS | can | 0 | 0 | 0 | Training history: 31/307 classified calendar days, 31 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-ETC-005 | COOLANT | bottle | 0 | 0 | 0 | Training history: 35/307 classified calendar days, 35 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-ETC-006 | YAMALUBE GEAR OIL | bottle | 0 | 0 | 0 | Training history: 36/307 classified calendar days, 36 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-ETC-007 | PETRON GEAR OIL | bottle | 0 | 0 | 0 | Training history: 38/307 classified calendar days, 38 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-ETC-008 | BRAKE FLUID | bottle | 0 | 0 | 0 | Training history: 25/307 classified calendar days, 25 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-ETC-009 | EXTREME ONE | bottle | 0 | 0 | 0 | Training history: 38/307 classified calendar days, 38 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-ETC-010 | VS1 BIG | can | 0 | 0 | 0 | Training history: 30/307 classified calendar days, 30 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-ETC-011 | VS1 | can | 0 | 0 | 0 | Training history: 26/307 classified calendar days, 26 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-ETC-012 | FORK OIL | bottle | 0 | 0 | 0 | Training history: 33/307 classified calendar days, 33 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-ETC-013 | PETRON SPRINT RED | bottle | 0 | 0 | 0 | Training history: 35/307 classified calendar days, 35 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-ETC-014 | SHELL ADVANCE YELLOW | bottle | 0 | 0 | 0 | Training history: 42/307 classified calendar days, 42 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-ETC-015 | HORN | piece | 0 | 0 | 0 | Training history: 36/307 classified calendar days, 36 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-FUS-001 | Fuse RED | piece | 0 | 0 | 0 | Training history: 37/307 classified calendar days, 37 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-FUS-002 | Fuse BLUE | piece | 0 | 0 | 0 | Training history: 42/307 classified calendar days, 42 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-FUS-003 | Fuse YELLOW | piece | 0 | 0 | 0 | Training history: 43/307 classified calendar days, 43 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-FUS-004 | Fuse GREEN | piece | 0 | 0 | 0 | Training history: 43/307 classified calendar days, 43 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-FUS-005 | Fuse ORANGE | piece | 0 | 0 | 0 | Training history: 50/307 classified calendar days, 50 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-KBR-001 | K. Bearing RAIDER | set | 0 | 0 | 0 | Training history: 19/307 classified calendar days, 19 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-KBR-002 | K. Bearing TMX/SUPREMO | set | 0 | 0 | 0 | Training history: 21/307 classified calendar days, 21 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-KBR-003 | K. Bearing BARAKO | set | 0 | 0 | 0 | Training history: 18/307 classified calendar days, 18 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-KBR-004 | K. Bearing MIO | set | 0 | 0 | 0 | Training history: 9/307 classified calendar days, 9 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-KBR-005 | K. Bearing CLICK | set | 0 | 0 | 0 | Training history: 16/307 classified calendar days, 16 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-OFL-001 | Oil Filter KHC | piece | 0 | 0 | 0 | Training history: 41/307 classified calendar days, 41 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-OFL-002 | Oil Filter SUZUKI | piece | 0 | 0 | 0 | Training history: 50/307 classified calendar days, 50 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-OFL-003 | Oil Filter KAWASAKI | piece | 0 | 0 | 0 | Training history: 36/307 classified calendar days, 36 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-OFL-004 | Oil Filter BAJAJ | piece | 0 | 0 | 0 | Training history: 47/307 classified calendar days, 47 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-OIL-002 | Petron Sprint Scooter sc800 | bottle | 6 | 0 | 0 | Training history: 66/307 classified calendar days, 66 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-OIL-003 | Petron Sprint Scooter sc400 | bottle | 0 | 0 | 0 | Training history: 62/307 classified calendar days, 62 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-OIL-005 | Petron Sprint 4T Scooter Oil | bottle | 0 | 0 | 0 | Training history: 69/307 classified calendar days, 69 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-OIL-006 | Petron M030 | bottle | 0 | 0 | 0 | Training history: 51/307 classified calendar days, 51 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-OIL-009 | Motul 3000 Plus 4T 800ml | bottle | 0 | 0 | 0 | Training history: 76/307 classified calendar days, 76 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-OIL-010 | Motul Scooter LE 800ml | bottle | 0 | 0 | 0 | Training history: 64/307 classified calendar days, 64 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-OIL-011 | Motul 3000 Plus 4T 1L | bottle | 0 | 0 | 0 | Training history: 78/307 classified calendar days, 78 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-OIL-012 | Motul Scooter LE 1L | bottle | 8 | 0 | 0 | Training history: 70/307 classified calendar days, 70 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-OIL-015 | Shell Advance 15W-40 1L | bottle | 0 | 0 | 0 | Training history: 61/307 classified calendar days, 61 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-OIL-016 | Shell Advance 15W-40 800ml | bottle | 0 | 0 | 0 | Training history: 69/307 classified calendar days, 69 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-OIL-017 | Shell Advance 20W-40 1L | bottle | 0 | 0 | 0 | Training history: 79/307 classified calendar days, 79 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-OIL-018 | Shell Advance 20W-40 800ml | bottle | 3 | 0 | 0 | Training history: 64/307 classified calendar days, 64 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-OIL-019 | Shell Advance 10W-40 Ultra 1L | bottle | 12 | 0 | 0 | Training history: 72/307 classified calendar days, 72 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-OIL-020 | Shell Advance 10W-40 Long ride 1L | bottle | 0 | 0 | 0 | Training history: 71/307 classified calendar days, 71 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-OIL-021 | Havoline Ezy 20W-40 1L | bottle | 0 | 0 | 0 | Training history: 66/307 classified calendar days, 66 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-OIL-022 | Scooter Ultra 10W-40 800ml | bottle | 0 | 0 | 0 | Training history: 67/307 classified calendar days, 67 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-OIL-023 | Honda Pro Honda 10W-30 1L | bottle | 8 | 0 | 0 | Training history: 68/307 classified calendar days, 68 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-OIL-024 | Kawasaki Genuine Oil 1L | bottle | 0 | 0 | 0 | Training history: 61/307 classified calendar days, 61 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-OIL-025 | Castrol 20W-40 1L | bottle | 0 | 0 | 0 | Training history: 77/307 classified calendar days, 77 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-OIL-026 | Castrol 20W-40 800ml | bottle | 0 | 0 | 0 | Training history: 89/307 classified calendar days, 89 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-OIL-027 | Ecstar 10W-40 1L | bottle | 6 | 0 | 0 | Training history: 85/307 classified calendar days, 85 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-OIL-028 | Yamalube Business 1L | bottle | 5 | 0 | 0 | Training history: 87/307 classified calendar days, 87 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-OIL-029 | Yamalube Blue Core 1L | bottle | 13 | 0 | 0 | Training history: 66/307 classified calendar days, 66 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-OIL-030 | Yamalube Performance 1L | bottle | 0 | 0 | 0 | Training history: 70/307 classified calendar days, 70 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-OIL-031 | Yamalube Automatic 1L | bottle | 0 | 0 | 0 | Training history: 91/307 classified calendar days, 91 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-OIL-032 | Havoline SF 20W-40 1L | bottle | 0 | 0 | 0 | Training history: 67/307 classified calendar days, 67 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-OIL-033 | Delo Gold 15W-40 1L | bottle | 8 | 0 | 0 | Training history: 65/307 classified calendar days, 65 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-OIL-034 | Castrol Power Scooter 1L | bottle | 0 | 0 | 0 | Training history: 63/307 classified calendar days, 63 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-OIL-035 | Shell Advance 10W-40 800ml w/ Gear Oil | set | 0 | 0 | 0 | Training history: 67/307 classified calendar days, 67 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-RAY-001 | Rayos 10Gx184MM | set | 0 | 0 | 0 | Training history: 12/307 classified calendar days, 12 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-RAY-002 | Rayos 8Gx161MM | set | 2 | 0 | 0 | Training history: 12/307 classified calendar days, 12 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-RAY-003 | Rayos 8GX197MM | set | 0 | 0 | 0 | Training history: 9/307 classified calendar days, 9 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-RAY-004 | Rayos 8Gx230MM | set | 0 | 0 | 0 | Training history: 11/307 classified calendar days, 11 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-RAY-005 | Rayos 8Gx240MM | set | 0 | 0 | 0 | Training history: 15/307 classified calendar days, 15 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-SPC-001 | Speedometer Cable RAIDER 150 | piece | 0 | 0 | 0 | Training history: 10/307 classified calendar days, 10 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-SPC-002 | Speedometer Cable RAIDER J | piece | 2 | 0 | 0 | Training history: 15/307 classified calendar days, 15 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-SPC-003 | Speedometer Cable WAVE/XRM | piece | 0 | 0 | 0 | Training history: 13/307 classified calendar days, 13 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-SPC-004 | Speedometer Cable BARAKO/FURY | piece | 0 | 0 | 0 | Training history: 17/307 classified calendar days, 17 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-SPC-005 | Speedometer Cable TMX/SUPREMO | piece | 0 | 0 | 0 | Training history: 12/307 classified calendar days, 12 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-SPC-006 | Speedometer Cable CLICK | piece | 0 | 0 | 0 | Training history: 15/307 classified calendar days, 15 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-SPC-007 | Speedometer Cable CT100/CT150 | piece | 0 | 0 | 0 | Training history: 14/307 classified calendar days, 14 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-SPC-008 | Speedometer Cable BEAT SKYDRIVE | piece | 0 | 0 | 0 | Training history: 20/307 classified calendar days, 20 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-SPK-001 | Spark Plug Denso X24ES-U | piece | 8 | 0 | 0 | Training history: 35/307 classified calendar days, 35 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-SPK-002 | Spark Plug Denso U22FSR-U | piece | 0 | 0 | 0 | Training history: 57/307 classified calendar days, 57 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-SPK-004 | Spark Plug NGK D6HA | piece | 3 | 0 | 0 | Training history: 49/307 classified calendar days, 49 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-SPK-005 | Spark Plug NGK BP7HS | piece | 0 | 0 | 0 | Training history: 52/307 classified calendar days, 52 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-SPK-006 | Spark Plug NGK B8ES | piece | 0 | 0 | 0 | Training history: 46/307 classified calendar days, 46 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-SPK-008 | Spark Plug NGK CPR6EA-9 | piece | 0 | 0 | 0 | Training history: 55/307 classified calendar days, 55 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-SPK-009 | Spark Plug NGK C7HSA | piece | 5 | 0 | 0 | Training history: 54/307 classified calendar days, 54 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-SPK-010 | Spark Plug NGK CMR6A | piece | 0 | 0 | 0 | Training history: 48/307 classified calendar days, 48 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-SPK-011 | Spark Plug NGK CMR6H | piece | 0 | 0 | 0 | Training history: 48/307 classified calendar days, 48 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-SPK-012 | Spark Plug BOSCH WS7F | piece | 4 | 0 | 0 | Training history: 40/307 classified calendar days, 40 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-SPK-013 | Spark Plug BOSCH C7HSA | piece | 0 | 0 | 0 | Training history: 43/307 classified calendar days, 43 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-THR-001 | Throttle Cable RAIDER 150 | piece | 0 | 0 | 0 | Training history: 20/307 classified calendar days, 20 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-THR-002 | Throttle Cable RAIDER J | piece | 0 | 0 | 0 | Training history: 26/307 classified calendar days, 26 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-THR-003 | Throttle Cable WAVE/XRM | piece | 0 | 0 | 0 | Training history: 24/307 classified calendar days, 24 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-THR-004 | Throttle Cable BARAKO/FURY | piece | 0 | 0 | 0 | Training history: 23/307 classified calendar days, 23 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-THR-005 | Throttle Cable TMX/SUPREMO | piece | 0 | 0 | 0 | Training history: 26/307 classified calendar days, 26 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-THR-006 | Throttle Cable CLICK | piece | 0 | 0 | 0 | Training history: 24/307 classified calendar days, 24 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-THR-007 | Throttle Cable CT100/CT150 | piece | 0 | 0 | 0 | Training history: 30/307 classified calendar days, 30 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-THR-008 | Throttle Cable BEAT SKYDRIVE | piece | 0 | 0 | 0 | Training history: 26/307 classified calendar days, 26 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-THR-009 | Throttle Cable DIO/MIO | piece | 0 | 0 | 0 | Training history: 22/307 classified calendar days, 22 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TIR-001 | Tire BEAST 80X80X14 | piece | 0 | 0 | 0 | Training history: 17/307 classified calendar days, 17 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TIR-002 | Tire BEAST 70X80X14 | piece | 0 | 0 | 0 | Training history: 20/307 classified calendar days, 20 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TIR-005 | Tire BEAST 90X90X14 | piece | 0 | 0 | 0 | Training history: 6/307 classified calendar days, 6 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TIR-006 | Tire BEAST 100X80X14 | piece | 0 | 0 | 0 | Training history: 16/307 classified calendar days, 16 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TIR-007 | Tire BEAST 110X70X14 | piece | 0 | 0 | 0 | Training history: 9/307 classified calendar days, 9 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TIR-008 | Tire BEAST 140X70X14 | piece | 0 | 0 | 0 | Training history: 13/307 classified calendar days, 13 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TIR-009 | Tire RAIZO 300X17 | piece | 0 | 0 | 0 | Training history: 12/307 classified calendar days, 12 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TIR-010 | Tire BULLDOG 250X18 | piece | 0 | 0 | 0 | Training history: 10/307 classified calendar days, 10 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TIR-011 | Tire BULLDOG 275X18 | piece | 0 | 0 | 0 | Training history: 11/307 classified calendar days, 11 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TIR-012 | Tire BULLDOG 300X18 | piece | 0 | 0 | 0 | Training history: 12/307 classified calendar days, 12 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TIR-013 | Tire BULLDOG 325X18 | piece | 0 | 0 | 0 | Training history: 16/307 classified calendar days, 16 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TIR-014 | Tire BEAST 100X70X13 | piece | 0 | 0 | 0 | Training history: 13/307 classified calendar days, 13 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TIR-015 | Tire BULLDOG 300X17 | piece | 0 | 0 | 0 | Training history: 0/307 classified calendar days, 0 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TIR-016 | Tire BEAST 80X90X17 | piece | 0 | 0 | 0 | Training history: 8/307 classified calendar days, 8 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TIR-017 | Tire BEAST 90X80X17 | piece | 0 | 0 | 0 | Training history: 15/307 classified calendar days, 15 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TIR-018 | Tire BEAST 100X80X17 | piece | 0 | 0 | 0 | Training history: 8/307 classified calendar days, 8 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TIR-019 | Tire BEAST 110X70X17 | piece | 0 | 0 | 0 | Training history: 11/307 classified calendar days, 11 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TIR-020 | Tire QUICK 110X70X17 | piece | 0 | 0 | 0 | Training history: 15/307 classified calendar days, 15 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TIR-021 | Tire LEO LASER 200X17 | piece | 0 | 0 | 0 | Training history: 8/307 classified calendar days, 8 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TIR-022 | Tire LEO LASER 225X17 | piece | 0 | 0 | 0 | Training history: 13/307 classified calendar days, 13 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TIR-023 | Tire LEO LASER 250X17 | piece | 1 | 0 | 0 | Training history: 12/307 classified calendar days, 12 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TIR-024 | Tire LEO LASER 275X17 | piece | 0 | 0 | 0 | Training history: 8/307 classified calendar days, 8 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TIR-025 | Tire BEAST 80X90X14 | piece | 0 | 0 | 0 | Training history: 16/307 classified calendar days, 16 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TIR-026 | Tire BEAST 90x80x14 | piece | 0 | 0 | 0 | Training history: 14/307 classified calendar days, 14 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TIR-027 | Tire BEAST 130X70X13 | piece | 0 | 0 | 0 | Training history: 7/307 classified calendar days, 7 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TIR-028 | Tire BEAST 70X80X17 | piece | 0 | 0 | 0 | Training history: 8/307 classified calendar days, 8 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TIR-029 | Tire LEO LASER 300X17 | piece | 0 | 0 | 0 | Training history: 0/307 classified calendar days, 0 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TIR-030 | Tire BULLDOG 325X17 | piece | 0 | 0 | 0 | Training history: 0/307 classified calendar days, 0 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TIR-031 | Tire LEO LASER 275X18 | piece | 0 | 0 | 0 | Training history: 0/307 classified calendar days, 0 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TIR-032 | Tire LEO LASER 300X18 | piece | 0 | 0 | 0 | Training history: 0/307 classified calendar days, 0 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TIR-033 | Tire BEAST 70X90X17 | piece | 0 | 0 | 0 | Training history: 0/307 classified calendar days, 0 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TIR-034 | Tire BEAST 80X80X17 | piece | 0 | 0 | 0 | Training history: 0/307 classified calendar days, 0 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TUB-001 | Interior 185X17 | piece | 0 | 0 | 0 | Training history: 21/307 classified calendar days, 21 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TUB-002 | Interior 200X17 | piece | 0 | 0 | 0 | Training history: 30/307 classified calendar days, 30 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TUB-003 | Interior 225X17 | piece | 0 | 0 | 0 | Training history: 36/307 classified calendar days, 36 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TUB-004 | Interior 250X17 | piece | 0 | 0 | 0 | Training history: 34/307 classified calendar days, 34 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TUB-005 | Interior 275X17 | piece | 2 | 0 | 0 | Training history: 41/307 classified calendar days, 41 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TUB-006 | Interior 300X17 | piece | 1 | 0 | 0 | Training history: 27/307 classified calendar days, 27 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TUB-007 | Interior 250X18 | piece | 0 | 0 | 0 | Training history: 23/307 classified calendar days, 23 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TUB-008 | Interior 275X18 | piece | 5 | 0 | 0 | Training history: 17/307 classified calendar days, 17 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TUB-009 | Interior 300X18 | piece | 1 | 0 | 0 | Training history: 25/307 classified calendar days, 25 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TUB-010 | Interior 225X14 | piece | 0 | 0 | 0 | Training history: 42/307 classified calendar days, 42 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TUB-011 | Interior 250X14 | piece | 0 | 0 | 0 | Training history: 32/307 classified calendar days, 32 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TUB-012 | Interior 275X14 | piece | 0 | 0 | 0 | Training history: 19/307 classified calendar days, 19 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |
| RM-TUB-013 | Interior 300X14 | piece | 0 | 0 | 0 | Training history: 24/307 classified calendar days, 24 nonzero days; requires a complete daily sequence, at least 56 training days and 100 nonzero days. |

## Appendix B. Reproduce the pooled calculations from the CSV

Blank predictions indicate missing evidence; do not replace them with zero. `included_full_test=true` selects the matched 30-day cohort. `included_thesis_date_subset=true` additionally restricts dates to October 14–27. Errors in the CSV are prediction minus actual.

```python
import csv
from decimal import Decimal, getcontext
getcontext().prec = 50
with open('forecast_evidence.csv', encoding='utf-8-sig', newline='') as f:
    rows = list(csv.DictReader(f))
for flag in ('included_full_test', 'included_thesis_date_subset'):
    for unit in ('bottle', 'piece'):
        selected = [r for r in rows if r[flag] == 'true' and r['unit'] == unit]
        for model in ('moving_average', 'xgboost', 'ensemble'):
            errors = [Decimal(r[model + '_prediction']) - Decimal(r['actual_quantity'])
                      for r in selected]
            n = len(errors)
            mae = sum(map(abs, errors), Decimal(0)) / n
            rmse = (sum((e * e for e in errors), Decimal(0)) / n).sqrt()
            print(flag, unit, model, len({r['product_id'] for r in selected}), n, mae, rmse)
```

## Appendix C. Evidence integrity and inspected source

CSV SHA-256: `53eb3993e54d919b80186aa070b6f52669a2f3d2ece457e01e30b92b439118a2`.

Configuration JSON SHA-256: `3f45cab7f8cb29847268362632b4dae7e7c5657809a94a7def9a6a2be2be60ba`.

Source references: `backend/app/worker.py` (saved outputs), `backend/app/forecasting.py` (recursive evaluation and operational refit), `backend/app/forecast_evidence.py` (UI summary pooling), `backend/db/migrations/001_initial_schema.up.sql` (numeric precision), `src/routes/forecasts.tsx`, `src/components/top-forecast-products.tsx`, `src/lib/api-forecast.ts`, `src/lib/sales-forecast.ts`, and `docs/thesis/Chapter_3.md`. Workspace HEAD at inspection: `b8044376e452acfb7b887e017b63978d7bab363f`; existing uncommitted UI changes predate this task. This is not a captured training-time Git commit and must not be presented as one.
