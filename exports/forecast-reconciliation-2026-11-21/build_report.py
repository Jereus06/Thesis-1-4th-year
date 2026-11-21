import csv
import hashlib
import json
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal, getcontext
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

getcontext().prec = 50
root = Path(__file__).parent
data = json.loads((root / 'saved_run_inspection.json').read_text(encoding='utf-8-sig'))
run = data['run']
config = run['configuration']
products = {p['id']: p for p in data['products']}
methods = ['moving_average', 'xgboost', 'ensemble']
labels = dict(zip(methods, ['Moving Average', 'XGBoost', 'Ensemble']))
groups = defaultdict(lambda: defaultdict(list))
for row in data['predictions']:
    groups[(row['product_id'], row['prediction_date'])][row['method']].append(row)
start, end = date.fromisoformat(run['final_test_start']), date.fromisoformat(run['final_test_end'])
expected = {(start + timedelta(days=i)).isoformat() for i in range((end-start).days+1)}
snapshot = {(r['productId'], r['date']): Decimal(r['quantity']) for r in data['snapshot']['dailySales']}
matched = {}
anomalies = []
for key, model_rows in groups.items():
    valid = all(len(model_rows[m]) == 1 for m in methods)
    if valid:
        rows = [model_rows[m][0] for m in methods]
        valid = all(r['actual_quantity'] is not None and Decimal(r['actual_quantity']).is_finite()
                    and Decimal(r['predicted_quantity']).is_finite() for r in rows)
        valid = valid and len({Decimal(r['actual_quantity']) for r in rows}) == 1
    matched[key] = valid
    if valid and snapshot.get(key) != Decimal(rows[0]['actual_quantity']):
        anomalies.append(f'Snapshot actual mismatch: {key}')
included = {pid for pid in config['products'] if
            {day for (p, day), good in matched.items() if p == pid and good} == expected
            and all(good for (p, day), good in matched.items() if p == pid)}
ordered = sorted(included, key=lambda p: products[p]['sku'])
source = data['imports'][0]
fields = ['run_id','source_import_id','product_id','sku','product_name','unit','date',
          'actual_quantity','moving_average_prediction','xgboost_prediction','ensemble_prediction',
          'moving_average_actual','xgboost_actual','ensemble_actual',
          'moving_average_error','xgboost_error','ensemble_error','included_full_test',
          'included_thesis_date_subset','exclusion_reason','saved_prediction_decimal_places']
csv_path = root / 'forecast_evidence.csv'
with csv_path.open('w', newline='', encoding='utf-8-sig') as f:
    writer = csv.DictWriter(f, fieldnames=fields)
    writer.writeheader()
    for (pid, day), model_rows in sorted(groups.items(), key=lambda item:(products[item[0][0]]['sku'],item[0][1])):
        p = products[pid]
        row = dict(run_id=run['id'], source_import_id=source['id'], product_id=pid,
                   sku=p['sku'], product_name=p['name'], unit=p['unit'], date=day,
                   included_full_test=str(pid in included).lower(),
                   included_thesis_date_subset=str(pid in included and day >= '2026-10-14').lower(),
                   exclusion_reason='' if pid in included else config['products'][pid].get('fallbackReason','Incomplete matching evidence'),
                   saved_prediction_decimal_places=3)
        actuals = set()
        for method in methods:
            values = model_rows[method]
            if len(values) == 1:
                value = values[0]
                row[method+'_prediction'] = value['predicted_quantity']
                row[method+'_actual'] = value['actual_quantity']
                if value['actual_quantity'] is not None:
                    actuals.add(Decimal(value['actual_quantity']))
                    row[method+'_error'] = str(Decimal(value['predicted_quantity'])-Decimal(value['actual_quantity']))
        row['actual_quantity'] = str(next(iter(actuals))) if len(actuals)==1 else ''
        writer.writerow(row)

def stats(unit, method, lower):
    selected = [(key, rows[method][0]) for key, rows in groups.items()
                if key[0] in included and products[key[0]]['unit']==unit and key[1]>=lower]
    errors = [Decimal(r['predicted_quantity'])-Decimal(r['actual_quantity']) for _,r in selected]
    sae = sum(map(abs,errors),Decimal(0))
    sse = sum((e*e for e in errors),Decimal(0))
    return len({k[0] for k,r in selected}),len(errors),sae,sse,sae/len(errors),(sse/len(errors)).sqrt()

def table(headers, rows):
    return '\n'.join(['| '+' | '.join(headers)+' |','| '+' | '.join(['---']*len(headers))+' |']+
                     ['| '+' | '.join(str(v).replace('|','/') .replace('\n',' ') for v in row)+' |' for row in rows])

def fmt(n): return f'{n:.9f}'
report = []
def add(text): report.append(text.strip())
add('''# StockCast saved forecasting evidence reconciliation

Inspection date: 21 November 2026 (Asia/Singapore, UTC+08:00). Database business timezone: Asia/Manila (also UTC+08:00).

## Main finding

The latest completed saved run does not reproduce the supplied thesis scores. It has six bottle products and two piece products with complete matching evidence, but its final test spans **28 September–27 October 2026 (30 days)**, not **14–27 October (14 days)**. Even restricting these saved predictions to the thesis dates does not reproduce the supplied values. A date subset is not a newly evaluated 14-day forecast.

**Precision limitation:** original unrounded daily predictions are not available in the inspected saved evidence. PostgreSQL stores predictions and actuals as numeric(18,3). This report computes every error directly from all available saved digits with Decimal precision 50; it does not average product RMSEs or round intermediate errors. These are reproducible **saved-precision** results, not a claim to recover pre-storage full-precision model outputs. Requested original-full-precision reproduction is therefore blocked by missing evidence, not by localhost/database availability.

Both http://localhost:8080 and http://localhost:8080/api/v1/health returned HTTP 200. Database extraction used a repeatable-read, read-only transaction. No application code, settings, sales, model artifacts or saved forecasts were changed; no refresh, training, tests, restart or GitHub push was performed. Only evidence/export files were written.
''')
add('## 1. Saved run and provenance\n\n'+table(['Field','Saved value'], [(k,v) for k,v in run.items() if k not in ('configuration','timing')]))
add('The run completed at **15:20:50 on 21 November 2026, UTC+08:00**. Its immutable input snapshot was captured at '+data['snapshot']['capturedAt']+'. The current business display name is '+data['business']['name']+'.')
add('### Import reference\n\n'+table(['Field','Value'],source.items()))
add('''All 10,299 current non-voided sales records reference that single CSV import. They aggregate to 10,283 product-date quantities. A read-only full join found zero missing keys on either side and zero quantity differences between current daily aggregates and the frozen run snapshot. The snapshot contains 208 product IDs, 10,299 source sales rows, no day-quality classifications, and coverage from 2025-10-28 through 2026-10-27. There are 208 current catalog products; metadata is joined from that catalog because the snapshot stores product IDs, not historical SKU/name/unit copies.

The import hash identifies the recorded import payload; the original file bytes and external authorization were not independently available for verification. The source/import linkage is reconstructed from the matching current sales ledger: the snapshot itself does not retain per-sale import IDs. The `partner` data-origin flag and business name are application labels, not proof of a real partner, authorized client collection, public-data license, or nonsynthetic provenance. The team must supply that documentation before describing these as empirical client findings.''')
add('## 2. Chronological dates and saved configuration\n\n'+table(['Stage','Dates','Calendar days'],[
    ['Training','2025-10-28 to 2026-08-30',307],
    ['Validation overall','2026-08-31 to 2026-09-27',28],
    ['Selection portion','2026-08-31 to 2026-09-17',18],
    ['Reserved interval calibration','2026-09-18 to 2026-09-27',10],
    ['Final test','2026-09-28 to 2026-10-27',30],
    ['Future forecast for the eight complete-history products','2026-10-28 to 2026-11-26',30]]))
add('Saved settings:\n\n```json\n'+json.dumps(data['snapshot']['settings'],indent=2)+'\n```')
add('Saved run configuration excluding per-product summaries (complete configuration, including all product summaries, is in `saved_forecast_configuration.json`):\n\n```json\n'+json.dumps({k:v for k,v in config.items() if k!='products'},indent=2)+'\n```')
add('''The eight products were selected by training-period sales volume, with top-N=8. Eligibility requires a complete observed-or-confirmed-zero daily sequence, at least eight calendar weeks (56 days) and 100 nonzero training days; these are separate thresholds. Each included product has 307 training observations, all nonzero. Moving Average window is 28 days, not the 30-day forecast horizon.

The source implements official Python XGBoost, chronological tuning, and recursive fixed-cutoff testing. Final-test evaluation fits on training plus validation history through September 27, then forecasts recursively without incorporating final-test actuals. An operational model is subsequently refitted through October 27 for future forecasts; the saved JSON model artifacts are these operational models, not a stored daily final-test prediction ledger. Eight model files were inspected; each contains `learner` and `version`, with no separate unrounded daily test export.

The saved run records `xgboost_verified=false`. The algorithm name/version and source identify the official implementation, but this flag must not be presented as a verified run. No independent algorithm validation was performed here. A source default such as random seed 42 is not a separately captured run configuration field. The saved configuration records a 20-observation interval threshold but these products have 10 reserved calibration observations and intervals marked available; do not claim 20 reserved observations or a confirmed 80% empirical coverage from that label. Interval checking is separate from the point-error reconciliation requested here.''')
add('### Included products and selected model parameters\n\n'+table(['SKU','Product','Unit','Test days','Depth','Trees','Learning rate','XGB ensemble weight','Operating method'],[
    [products[p]['sku'],products[p]['name'],products[p]['unit'],30,config['products'][p]['parameters']['max_depth'],config['products'][p]['parameters']['n_estimators'],config['products'][p]['parameters']['learning_rate'],config['products'][p]['xgbWeight'],config['products'][p]['operatingMethod']] for p in ordered]))
add('## 3. Matching evidence and exclusions')
counts = {m:sum(r['method']==m for r in data['predictions']) for m in methods}
add(f'''The run contains {len(data['predictions'])} daily final-test model rows: {counts['moving_average']} Moving Average, {counts['xgboost']} XGBoost, and {counts['ensemble']} Ensemble. There are {len(groups)} distinct product-date keys. The CSV retains every key, including incomplete-model rows, with explicit inclusion flags and blank missing values, never fabricated zero predictions.

Inclusion requires exactly one finite actual and prediction per model on each of all 30 test dates, identical actual quantities and dates across the three models, and matching frozen-snapshot actuals. The eight included products supply 240 common observations per model: **six bottle products × 30 days = 180**, and **two piece products × 30 days = 60**. No matched actual/snapshot discrepancies were found ({len(anomalies)} anomalies). There are 124 additional Moving-Average-only product-date observations across 27 other products; these are excluded from all three pooled model calculations. The remaining 173 catalog products have no final-test prediction rows. In total, 200 products are excluded: 192 have insufficient/noncontiguous training evidence and eight have no training history. Product-by-product saved explanations appear in Appendix A.

The October 14–27 subset uses exactly the same eight products and 14 dates: **84 bottle** and **28 piece** observations per model. No product or date was chosen based on which model performed better.''')
add('''## 4. Calculations from saved daily errors

For each counting unit, common product-date set S and model m:

`error(i,m) = prediction(i,m) - actual(i)`

`MAE(m) = sum(abs(error(i,m))) / N`

`RMSE(m) = sqrt(sum(error(i,m)^2) / N)`

N counts product-date observations, not products. Bottle and piece are never combined. All intermediate arithmetic uses the stored decimal strings without further rounding; reported metrics below are rounded only for presentation.''')
for lower,title in [('2026-09-28','Full saved final test: September 28–October 27'),('2026-10-14','Diagnostic thesis-date subset: October 14–27')]:
    rows=[]
    for unit in ['bottle','piece']:
        for m in methods:
            nprod,n,sae,sse,mae,rmse=stats(unit,m,lower)
            rows.append([unit,labels[m],nprod,n,str(sae),str(sse),fmt(mae),fmt(rmse)])
    add('### '+title+'\n\n'+table(['Unit','Model','Products','N','Sum absolute errors','Sum squared errors','MAE','RMSE'],rows))
add('The subset is forecast steps **17–30** from the saved September 27 cutoff. It must not be called forecast steps 1–14 from an October 13 origin. Changing the date filter cannot recreate that earlier experiment.')
add('### Stored summary metric cross-check (not a replacement for daily-error calculations)')
cross=[]
for unit in ['bottle','piece']:
    for m in methods:
        values=[r for r in data['metrics'] if r['product_id'] in included and products[r['product_id']]['unit']==unit and r['method']==m and r['dataset_split']=='final_test']
        n=sum(r['observation_count'] for r in values)
        mae=sum((Decimal(r['mae'])*r['observation_count'] for r in values),Decimal(0))/n
        rmse=(sum((Decimal(r['rmse'])**2*r['observation_count'] for r in values),Decimal(0))/n).sqrt()
        direct=stats(unit,m,'2026-09-28')
        cross.append([unit,labels[m],fmt(mae),fmt(rmse),fmt(mae-direct[-2]),fmt(rmse-direct[-1])])
add(table(['Unit','Model','Weighted saved MAE','sqrt(weighted saved RMSE squared)','Difference vs daily MAE','Difference vs daily RMSE'],cross))
add('''The worker calculates summary metrics before numeric(18,3) prediction storage; metrics are themselves stored as numeric(18,6). Consequently the application score cards can differ slightly from recomputation of rounded saved predictions. The cross-check weights squared product RMSE by observation count and then takes a square root; it never averages product RMSE. These summary values cannot recover unrounded daily errors or the thesis-date subset. Rounding to 0.001 can perturb MAE and RMSE by at most approximately 0.0005 when actuals are unchanged; it cannot explain the much larger thesis differences below.''')
thesis={'bottle':{'moving_average':('0.972','1.184'),'xgboost':('0.810','1.033'),'ensemble':('0.879','1.084')},'piece':{'moving_average':('0.829','0.983'),'xgboost':('0.873','1.064'),'ensemble':('0.859','1.026')}}
comparison=[]
for u in ['bottle','piece']:
    for m in methods:
        tma,trm=map(Decimal,thesis[u][m]); full=stats(u,m,'2026-09-28'); sub=stats(u,m,'2026-10-14')
        comparison.append([u,labels[m],f'{tma}/{trm}',f'{full[-2]:.3f}/{full[-1]:.3f}',f'{sub[-2]:.3f}/{sub[-1]:.3f}',f'{sub[-2]-tma:+.6f}/{sub[-1]-trm:+.6f}'])
add('## 5. Comparison with supplied thesis values\n\n'+table(['Unit','Model','Thesis MAE/RMSE','Full saved test','Same-date subset','Subset minus thesis'],comparison))
add('''No model/unit pair reproduces the supplied thesis pair to three decimals. The number of products and units agrees (six bottle, two piece), but the user did not supply the thesis SKU roster, raw observations, import hash, run ID, training boundaries, model parameters, Moving Average window, or ensemble weights. Therefore identical product identities and data cannot be assumed simply from matching counts.

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
''')
add('''## 6. Exact demonstration screens and their limits

These routes and control labels were checked against application source; localhost and health were read successfully. No authenticated browser was driven and no new screenshots were captured, so this is a source-confirmed demonstration guide, not a claim of a fresh visual test. Use the existing account; no credentials are included.

1. **Forecasts — http://localhost:8080/forecasts.** The **Top products for XGBoost** panel lists the eight ranked products and training-history dates. Use the product selector to choose each SKU in the included table. Under **Chart options**, choose **Daily** and enable **Compare forecasting methods**. The product chart shows saved actuals and model curves. These display controls do not retrain models.
2. On the same **Forecasts** screen, the **Moving Average**, **XGBoost**, and **Ensemble** score cards apply to the selected product. Expand **Technical details** for its MAE and RMSE. **Past forecast errors by product** lists the three model error columns and historical evidence. These are per-product saved metrics, not pooled bottle/piece scores; minor precision differences from the CSV are expected.
3. **Sales report — http://localhost:8080/sales-report.** Use **Actual versus forecast**, select a date range, product/counting unit, and a forecasting method if demonstrating the existing report. Do not label its unit-wide average as this matched-three-model experiment: it can include additional products with only Moving Average evidence. **Estimated revenue** is a future-value display and cannot demonstrate historical forecast MAE/RMSE.
4. **Data quality — http://localhost:8080/data-quality.** Read the missing/classified-date diagnostics to explain sparse-product exclusions. Do not save classifications during this demonstration.
5. **For the exact pooled unit results requested here, open this report and `forecast_evidence.csv`.** The present UI has no dedicated matched-three-model, bottle/piece pooled MAE/RMSE table or saved-run/import-hash audit panel. Do not imply an existing screen shows a statistic it does not. The CSV and report provide that audit trail without changing the application.

Do not click Refresh forecasts, upload/import, save settings, or alter records while demonstrating this preserved run. A future automatic or manual completed run can change what the live screen displays; use this report's fixed run ID to distinguish results.
''')
add('''## 7. How to use this evidence in the thesis

If the team chooses the current saved experiment, revise the dates, sample description and configuration together, and label the numerical table as recalculated from stored three-decimal daily predictions. Use the full 30-day table as the primary saved-run result. The 14-day subset is a diagnostic comparison only and must retain its September 27 forecast origin.

If the thesis must retain an October 14–27 experiment with its original forecast origin and full-precision scores, obtain its original raw evidence/run/configuration. That evidence is absent here; this inspection does not authorize or perform replacement training. Do not force the saved values to match the manuscript. Confirm original dataset authorization/provenance, exact eight thesis SKUs, and the earlier calculation worksheet before presenting causal explanations for every numeric difference.

Suggested factual wording: “A read-only audit of saved run 05f5f70c-4f46-4470-a6cf-e43c522ea0c9 identified complete daily final-test evidence for six bottle products (180 product-date observations) and two piece products (60 observations), covering 28 September–27 October 2026. MAE and RMSE were recomputed separately by counting unit on identical observations across all three models. Prediction storage was limited to three decimal places. The audit did not reproduce the previously supplied 14–27 October values.”

This audit is evidence reconciliation, not a new client survey, a new model validation study, a claim of inventory improvement, or confirmation of real partner findings.
''')
add('## Appendix A. Every excluded product\n\n'+table(['SKU','Product','Unit','MA test rows','XGB test rows','Ensemble test rows','Saved exclusion reason'],[
    [p['sku'],p['name'],p['unit'],*[sum(len(v[m]) for (pid,day),v in groups.items() if pid==p['id']) for m in methods],config['products'].get(p['id'],{}).get('fallbackReason','No saved product summary')]
    for p in sorted(products.values(),key=lambda p:p['sku']) if p['id'] not in included]))
add('''## Appendix B. Reproduce the pooled calculations from the CSV

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
''')
configuration = {'run':run,'snapshot_metadata':{k:v for k,v in data['snapshot'].items() if k not in ('dailySales','dataQuality','products')},'imports':data['imports'],'products':data['products'],'precision':data['precision']}
(root/'saved_forecast_configuration.json').write_text(json.dumps(configuration,indent=2),encoding='utf-8')
add('## Appendix C. Evidence integrity and inspected source\n\nCSV SHA-256: `'+hashlib.sha256(csv_path.read_bytes()).hexdigest()+'`.\n\nConfiguration JSON SHA-256: `'+hashlib.sha256((root/'saved_forecast_configuration.json').read_bytes()).hexdigest()+'`.\n\nSource references: `backend/app/worker.py` (saved outputs), `backend/app/forecasting.py` (recursive evaluation and operational refit), `backend/app/forecast_evidence.py` (UI summary pooling), `backend/db/migrations/001_initial_schema.up.sql` (numeric precision), `src/routes/forecasts.tsx`, `src/components/top-forecast-products.tsx`, `src/lib/api-forecast.ts`, `src/lib/sales-forecast.ts`, and `docs/thesis/Chapter_3.md`. Workspace HEAD at inspection: `b8044376e452acfb7b887e017b63978d7bab363f`; existing uncommitted UI changes predate this task. This is not a captured training-time Git commit and must not be presented as one.')
(root/'forecast_results_report.md').write_text('\n\n'.join(report)+'\n',encoding='utf-8')
with ZipFile(root/'stockcast_forecast_evidence.zip','w',ZIP_DEFLATED) as archive:
    for name in ['forecast_evidence.csv','forecast_results_report.md','saved_forecast_configuration.json']:
        archive.write(root/name,arcname=name)
print(json.dumps({'run_id':run['id'],'csv_rows':len(groups),'matched_products':len(included),'matched_observations':sum(k[0] in included for k in groups),'actual_anomalies':anomalies,'files':{p.name:p.stat().st_size for p in root.iterdir() if p.suffix in ['.csv','.md','.zip']}}))
