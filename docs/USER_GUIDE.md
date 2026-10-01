# StockCast User Guide

This guide explains the current StockCast application: installation, every screen, daily
record keeping, forecasting, inventory recommendations, and maintenance. It was checked against
the source on **1 October 2026**. The Strategies User guide tab and its downloadable manual use this same
document.

The official thesis title is **Sales Forecasting and Inventory Optimization for Small Retail
Businesses Using XGBoost Algorithm**. The team is still finding a partner business. Examples
below are fictional practice records; they are not collected partner data or research results.

## 1. Quick start

### What you need

Use Node.js **24 or newer** and Docker Desktop with its Linux container engine running.
Open a terminal in the StockCast project folder. Normal startup installs the application
dependencies inside Docker; you do not need to install Python or PostgreSQL on the laptop.

### First installation

1. Start Docker Desktop and wait for its engine to be ready.
2. To choose initial account details, run `npm run setup`, then edit the generated private `.env` file before the first startup. This step is optional.
3. Run `npm start`. The first build downloads dependencies and can take several minutes.
4. Wait for the terminal to print `StockCast is running:` and its address.
5. Open `http://localhost:8080` with the default local settings.
6. Sign in using your email and initial owner password, or choose **Create account** to create your own store.
7. Open **Inventory** and add products, then record or explicitly import authorized sales history.

If `.env` does not exist, setup/startup creates it with random database and owner passwords.
The default Business ID is `00000000-0000-4000-8000-000000000001`, and the default email is
`owner@example.com`. The generated password is the `OWNER_PASSWORD` value in your private
configuration. A customized Business ID or email takes precedence over those defaults. Business ID is now optional during sign-in; use **Choose a specific business** if your credentials match multiple older stores.

A fresh normal installation creates the business, settings, and owner account with an empty
catalog. There are no generated products or sales in the PostgreSQL application.

### Returning to the system

1. Start Docker Desktop.
2. Run `npm start` from the same project folder.
3. Open the address printed by startup. An active cookie session restores automatically; otherwise, sign in.
4. To stop the application, run `npm run stop`. Saved records remain in the database volume.

Keep `.env` private and retain a protected copy. Restarting preserves an existing account's
password; changing `OWNER_PASSWORD` in `.env` does not reset an account already in the database.

## 2. How the parts work together

The website sends requests to the Python API. The API checks the signed-in user's business and
permissions, reads or changes PostgreSQL records, and returns results to the screen. Forecast
training runs in a separate worker so ordinary inventory and sales actions can continue.

| Part                          | What it does                                                                                | What you normally see                      |
| ----------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------ |
| React website                 | Displays pages, forms, charts, and validation messages                                      | The StockCast interface in your browser    |
| Caddy / web service           | Serves the built website and forwards API requests; manages hosted HTTPS                    | The website address                        |
| Python / api service          | Checks sessions and permissions; handles business actions and reads saved forecasts         | Success messages, records, and errors      |
| PostgreSQL / database service | Stores accounts, products, sales, stock movements, settings, jobs, predictions, and metrics | Records persist after an ordinary restart  |
| initialize service            | Applies existing migrations and creates missing initial business/account records            | It normally finishes with exit code 0      |
| Python / worker service       | Processes queued forecast jobs using the official Python XGBoost package                    | A queued/running/completed forecast status |
| Docker Compose                | Builds images, connects the services, checks readiness, and keeps persistent volumes        | Startup/build output in the terminal       |

A forecast refresh creates a job with a snapshot of its input records and settings. The worker
processes that snapshot, saves predictions and evaluation results to PostgreSQL, and stores
trained model JSON files in the model volume. Pages use saved results while a new run is pending.

## 3. Signing in and permissions

### Sign in to an existing account

Enter your **Email** and **Password**. If the system asks you to select a store, open
**Choose a specific business** and enter its **Business ID**. This optional field preserves
access to older accounts whose email/password combination matches more than one business.
Business ID identifies the store's records; it is not the store name.

The browser restores a valid session when you reopen the page. Sessions last 12 hours by
default, unless the server administrator configures another duration. Expired sessions require
sign-in again. **Sign out** ends that StockCast browser session; it does not erase records or
sign you out of Google.

### Save your email and password in this browser

On password sign-in or registration, select **Ask this browser to save my email and password**
if you want StockCast to request saving with the browser's built-in password manager. The
checkbox starts unchecked. After successful sign-in or registration, a supported browser can
ask you to confirm or decline saving, or handle an existing saved login without showing a new
prompt. The browser controls saving and autofill; StockCast cannot guarantee a prompt.

Leaving the checkbox unchecked skips StockCast's explicit save request. Your browser can still
offer its usual password-saving prompt based on its own settings. Saved email/password details
belong to the browser's password manager; StockCast does not put them in its browser app storage.
They can help fill a later sign-in form, but do not extend the StockCast session's 12-hour
default lifetime.

If saving or autofill is unavailable, check the browser's password-manager settings and blocked
sites. Private browsing, unsupported features, or an insecure hosted address can affect saving.
Use the same website address when returning. Google-only accounts have no StockCast password to
save.

### Create your own store

1. Open **Create account** on the sign-in screen.
2. Enter your name, email, and a password containing **12 to 128 characters**. Confirm the password.
3. Enter your store name and, optionally, its location.
4. Choose **Test records** for practice data or **Authorized business records** for real records you have permission to use. Confirm permission when choosing authorized records.
5. Choose **Create my store**. A successful registration signs you in as its owner.

StockCast automatically generates a unique **Business ID** (a UUID) when your account and store
are created, including when you finish first-time Google registration. You do not need to invent
or enter one during registration. Find it under **Inventory > Settings > Your account**. It
identifies the store's records; normally, your email and password are enough to sign in.

Your new store has default settings and an **empty catalog**. Registration does not copy another
store's records or generate products, sales, deliveries, or forecasts. An email already
registered on this installation must sign in instead.

### What "Records you plan to use" means

This field labels the source of the records you plan to add later.

| Choice                          | When to choose it                                                     |
| ------------------------------- | --------------------------------------------------------------------- |
| **Test records**                | Practice records, invented examples, or other test data               |
| **Authorized business records** | Real records from a business that has given you permission to use them |

Both choices create the same application features and a separate empty store. Choosing Test
records does not generate sample data. Choosing Authorized business records asks you to confirm
permission and marks provenance; it does not establish a thesis partner or research result.

### Continue with Google

**Continue with Google** appears when the installation administrator has configured Google.
Choose it, select your Google account, and complete any account-selection or consent steps Google
requires. StockCast verifies the returned identity before creating a session.

For your first Google registration, StockCast asks for a store name, optional location, and
record provenance. Choose **Create my store** to finish. This creates a separate empty owner
store, just like email registration. The temporary setup expires after ten minutes; restart
Google sign-in if it expires. Google-created accounts use Google to sign in and do not receive
a StockCast password.

An existing password account is not connected to Google just because the emails match.
Sign in with its password first, open **Inventory > Settings > Your account**, and choose
**Connect Google account**. Complete Google's steps. Later, Continue with Google opens that
same account with its existing store and permissions. Owners and staff can connect their
own account. A Google identity can belong to only one StockCast account.

Google may still require selection or consent. Automatic reopening uses the active StockCast
session cookie; it does not promise silent Google sign-in after that session expires.

### Permissions and account limits

| Action in the current application                                  | Owner | Staff |
| ------------------------------------------------------------------ | ----- | ----- |
| View products, sales, settings, forecasts, and restock suggestions | Yes   | Yes   |
| View account details and connect your own Google account           | Yes   | Yes   |
| Export sales and stock-movement records                            | Yes   | Yes   |
| Record a sale or receive a delivery                                | Yes   | Yes   |
| Add/edit products or set a stock count                             | Yes   | No    |
| Import inventory snapshots or historical sales                     | Yes   | No    |
| Save business/forecast settings                                    | Yes   | No    |
| Refresh forecasts                                                  | Yes   | No    |

Some management controls can remain visible to staff. The API enforces permission and can
return **Owner role required** when a staff member submits them.

Email/password registration does not send an email-verification message. The current website
has no password-change, password-reset, or staff-invitation screen. Ask the installation
administrator about existing staff access or account recovery. Public registration creates
an owner of a new store; it does not join another owner's store. Editing initial-owner
environment values does not update an existing account.

After signing in, open **Strategies > User guide** to search the manual or download it.
**Strategies > Evaluation** opens the system-quality rating form for owners and staff.

## 4. Navigation, Overview, and the daily routine

On a large screen, use the sidebar. On a small screen, use the bottom navigation.
**Record sale** is available from the application header.

| Page       | Main purpose                                                                           |
| ---------- | -------------------------------------------------------------------------------------- |
| Overview   | Read the morning briefing, urgent restock queue, inventory value, and model comparison |
| Restock    | Review reorder suggestions and record an actual delivery                               |
| Forecasts  | Refresh forecasts, inspect product charts, and compare evaluation errors               |
| Inventory  | Manage products, inspect/import/export sales, and save settings                        |
| Strategies | Read methodology/thesis text, search the User guide, and complete the Evaluation form  |

### Reading Overview

- **Need restock** counts products marked Stockout or Reorder.
- **Inventory value** is on-hand quantity multiplied by unit cost, summed across products. It is a cost-based value in PHP, not sales revenue or profit.
- The forecast summary shows the selected method, its MAE when available, the horizon, and ML product coverage.
- **Restock queue** shows up to six urgent products with on-hand stock, reorder point, and suggested quantity. **View all** opens Restock.
- **Model comparison** shows MAE and RMSE. The selected method comes from validation; the displayed evaluation errors come from final testing.
- **Open forecast charts** opens Forecasts.

### Suggested daily routine

1. Open Overview and check Stockout and Reorder items.
2. Check the actual shelves/counts before using a recommendation.
3. Record new sales as they happen.
4. Record received goods after the delivery arrives.
5. Check Restock again; stock changes update recommendations using the available demand estimate.
6. After adding sales history or changing forecasting settings, have the owner use **Refresh forecasts**.
7. Review the job status and product results; keep the business's own judgment in the ordering decision.

Forecast suggestions do not place supplier orders, reserve stock, or receive goods automatically.

## 5. Inventory: products and stock counts

Open **Inventory**, then the **Products** tab. Search matches parts of a product's name, SKU,
or category without regard to letter case.

### Add a product

Choose **Add product** to open the New product form, fill it in, and choose **Add to catalog**.

| Field           | Meaning                                               | Current form default |
| --------------- | ----------------------------------------------------- | -------------------- |
| Name            | Product name                                          | Required             |
| Category        | Grouping label                                        | Staples              |
| Unit            | Counting unit, such as pc or pack                     | pc                   |
| On hand         | Opening stock count                                   | 0                    |
| Lead time       | Days between ordering and receiving from the supplier | 3                    |
| Safety stock    | Extra units used as a restock buffer                  | 5                    |
| Unit cost (PHP) | Cost per counting unit used for inventory valuation   | 10                   |

The form generates a SKU automatically; it does not offer a custom SKU input. Use an inventory
CSV snapshot when an existing catalog must retain specific SKUs. Choose one consistent unit for
each product and express its stock, sales, safety stock, and cost in that unit.

Positive opening stock creates an opening-balance stock movement. It is not historical sales.

### Edit an existing product

Open its editor, update **On hand**, **Lead time (days)**, or **Safety stock**, then choose
**Save**. These values cannot be negative; lead time is a whole number of days. The current
individual editor displays the other catalog details but does not edit name, SKU, category,
unit, or cost. An inventory snapshot can update those catalog details.

Saving **On hand** sets a counted balance and records the difference as a stock adjustment.
For example, changing 20 to 17 records a reduction of three. Use this for a verified physical
count correction; use **Record delivery** for received goods.

The current website has no product-delete or archive control. Products omitted from an import
remain in the catalog.

## 6. Record sale: new transactions

Choose **Record sale** in the header. Select the product, enter a positive quantity and the
sale date, and save. The initial date is today's date.

A manually recorded sale immediately reduces current on-hand stock and creates a linked sales
and stock-movement record. The API rejects a quantity that would make stock negative. It also
checks the date and numeric inputs.

Example: a product has 20 units. Recording a new sale of three makes its on-hand balance 17.
Recording that same transaction again would reduce it again.

Use the sales-history importer for earlier transactions already reflected in your current
physical stock count. Manual sale entry also reduces stock when you select an earlier date.
The current UI has no sale edit, delete, cancellation, or void action; agree on a correction
process with the administrator before changing business records.

## 7. Deliveries and other stock movements

Open **Restock** and choose **Record delivery** for a product with a positive recommended
quantity. Enter the actual **Quantity received** and save only after the goods have arrived.

The delivery adds the received quantity to on-hand stock and records a receipt dated today.
The current dialog has no delivery-date picker. If you leave the quantity blank, it uses the
recommended quantity, so explicitly enter what actually arrived.

The Restock button is disabled when the recommended quantity is zero. The current website does
not expose a general delivery form for other products. Ask the administrator about the existing
stock-movement API when another inventory workflow is needed.

| Movement        | Effect on stock                                   | Current web workflow                                  |
| --------------- | ------------------------------------------------- | ----------------------------------------------------- |
| Opening balance | Establishes initial stock                         | Add product or add a new SKU in an inventory snapshot |
| Sale            | Subtracts sold units                              | Record sale                                           |
| Receipt         | Adds delivered units                              | Record delivery                                       |
| Adjustment      | Adds/subtracts the difference to a verified count | Save On hand or import an inventory snapshot          |
| Return          | Adds returned units                               | Available in the API; no dedicated web form           |
| Write-off       | Subtracts lost/damaged units                      | Owner API action; no dedicated web form               |

Stock-changing API actions are audited and reject a negative resulting balance.
A recommendation is neither a receipt nor proof that an order was placed.

## 8. Import an inventory snapshot

An inventory snapshot establishes or corrects the current catalog and counts. It is suitable for
bringing an authorized existing catalog into StockCast. It is not a list of deliveries.

In **Inventory > Products**, choose **Import inventory**. Paste CSV text or select **Upload CSV
file**. Uploading only fills the text area; choose **Import inventory** to submit it.

### Required column order

```csv
SKU,Product,Category,Unit,On Hand,Lead Time,Safety Stock,Unit Cost
PRACTICE-001,Practice Rice,Staples,pack,20,3,5,45
PRACTICE-002,Practice Soap,Household,pc,12,2,3,18
```

These are fictional examples. Use your own authorized records in the live business.

| Column       | Rule                                           |
| ------------ | ---------------------------------------------- |
| SKU          | Required; unique within the submitted snapshot |
| Product      | Required product name                          |
| Category     | Required grouping label                        |
| Unit         | Required counting unit                         |
| On Hand      | Nonnegative current balance                    |
| Lead Time    | Nonnegative whole number of days               |
| Safety Stock | Nonnegative number of units                    |
| Unit Cost    | Nonnegative cost in PHP                        |

The optional header must start with `SKU,`. Keep this column order. The current web parser
splits on commas: quoted commas inside a field and multiline CSV fields are unsupported.
Avoid commas/newlines in these field values. Stock/safety values support up to three decimal
places; unit cost supports up to four. The API accepts at most 5,000 rows in a batch.

### What submitting changes

- A matching SKU updates catalog details and sets on-hand stock, with an audited adjustment for a changed count. SKU matching ignores letter case.
- A new SKU creates a product and an opening balance for positive stock.
- A matched inactive product is reactivated.
- Products absent from the file remain; the importer does not delete them.
- Sales history is unchanged. No sale or delivery is inferred from a snapshot.
- The snapshot is atomic: a rejected row or duplicate SKU prevents the whole snapshot from committing.

Review the file before submitting: its counts replace matched products' current on-hand values.

## 9. Import historical sales

First create or import the catalog. Then open **Inventory > Sales ledger**, use **Import CSV**,
and paste rows or choose **Upload CSV file**. Choose **Import rows** to submit the filled text.

### Required column order

```csv
Date,Product,Quantity
2026-09-01,PRACTICE-001,3
2026-09-02,PRACTICE-001,2
2026-09-02,PRACTICE-002,1
```

These are fictional examples that refer to the example catalog. `Product` should identify an
existing SKU; the current parser also accepts an exact product name without regard to letter
case, or the internal product ID. SKUs are the safer choice when names are similar.

Use `YYYY-MM-DD` dates, a positive quantity, and up to three decimal places. Keep the column
order; the optional header starts with `Date,`. The current parser does not support quoted
commas or multiline fields. The API accepts at most 50,000 rows per batch.

Historical imports add demand history while preserving current stock. They do not create sale
stock movements or deliveries. This prevents old transactions from deducting a current inventory
count a second time.

### Check results before retrying

The web form checks product matches and input rows. An API response can report imported and
rejected records, and accepted records in such a response have already been saved. Invalid
request shapes, dates, or quantity precision can reject the request.

An identical batch with the same source and ordered rows is blocked as already submitted.
Changing or reordering an overlapping file can still add duplicate sales. Import each historical
period once, inspect the result/export, and prepare only the genuinely missing rows for a retry.
There is no global deduplication of every imported transaction.

After adding history, the owner should **Refresh forecasts**.

## 10. Sales ledger and exports

The **Sales ledger** displays the latest 40 records, ordered with recent dates first. Its total
record count can be larger than the table. The current table has no date filter, pagination,
transaction search, or edit/delete action.

In normal API mode, choose **Export sales CSV** to download all saved sales for the signed-in
business, including records beyond those 40 displayed rows.

```csv
id,sku,sale_date,quantity,source,data_origin
```

The export contains more columns than the three-column history importer. To import into another
installation, deliberately map it to `Date,Product,Quantity`; do not paste the export unchanged.

In **Inventory > Products**, choose **Export stock movements** to download the signed-in
business's audit records. The CSV contains these columns:

```csv
id,sku,movement_date,movement_type,quantity_delta,balance_after,data_origin,note
```

A positive quantity delta adds stock; a negative one removes stock. `balance_after` records the
balance immediately after that movement. Historical sales imports intentionally have no matching
stock delta.

CSV exports are useful business records, but they do not include accounts, settings, all forecast
records, or trained models. They are not a full-system backup.

## 11. Settings

Open **Inventory > Settings**. The **Your account** card shows your name, email, role, and
Business ID. For public registration, StockCast generates this UUID automatically; it is
different from your store name. Owners and staff can use **Connect Google account** there when
Google is enabled.
This action connects only the signed-in account and preserves its store and permissions.

For store/model fields, change values and choose **Save settings**. Owner permissions are
required to save those business settings in normal mode.

| Setting                          | What it controls                                                   | Choices in the current website |
| -------------------------------- | ------------------------------------------------------------------ | ------------------------------ |
| Store name                       | Store label shown in the interface                                 | Text                           |
| Location                         | Store location label                                               | Text                           |
| Forecast horizon                 | Number of future days predicted after the last observed sales date | 7, 14, 21, or 30               |
| Cover days after delivery        | Additional coverage used in target stock                           | 3, 7, 10, or 14                |
| MA window, under Advanced        | Recent calendar-day window used by Moving Average                  | 3, 7, or 14                    |
| ML product limit, under Advanced | Maximum eligible products considered for machine learning          | Top 5, 8, 12, or 20            |

Default backend values are a 14-day horizon, seven cover days, a seven-day MA window, and a
top-eight ML limit. A top-N value is a cap: it does not make an ineligible product qualify.

The history summary shows the date range and calendar coverage. Its **Limited history** message
below 56 calendar days is a broad history check, not proof that an individual product passes
the machine-learning rules.

The normal web settings keep the minimum nonzero-day requirement at 100 and the business
timezone at `Asia/Manila`; neither has a web-editable control. The minimum-history default is
eight weeks. A stored CV-fold setting is not used as repeated cross-validation by the current
Python trainer, which uses one chronological validation segment.

Save changed forecasting settings, then explicitly refresh forecasts. Changes to stock counts,
lead time, and safety stock affect restock calculations using current demand estimates; they do
not by themselves require retraining the sales-demand model.

## 12. Forecasts: refresh, charts, and evaluation

Open **Forecasts**. Before a trained run is available, the API can provide a Moving Average
baseline. A product without an eligible ML result can continue using that fallback.

### Refresh forecasts

1. Record/import the history you want the run to use and save any forecasting settings.
2. Have the owner choose **Refresh forecasts** on Forecasts or Strategies.
3. The job is queued, then processed by the Python worker. Only one queued/running job per business is allowed.
4. Watch the training/status banner. The website checks forecast status about every five seconds.
5. When the job finishes, review the new results. A previous completed run remains available while a replacement is running or fails.

The run snapshots its sales totals, settings, and active products. Records added after it is
queued need a later refresh. Navigating to a page does not itself retrain the Python model.

At least three calendar days of history are required to queue a run; that is only a baseline
minimum, not ML eligibility. Future-dated history is rejected.

### Why a product may use Moving Average

Machine-learning checks apply to the **training period only**:

- At least the configured minimum history, normally eight calendar weeks, and a minimum of 31 days for the model's 30-day feature history.
- At least 100 distinct days with positive sales.
- A position inside the top-N active products ranked by training sales volume. Ranking comes before the separate history and nonzero-day checks.

Eight weeks contain 56 calendar days, so eight weeks alone cannot provide 100 distinct nonzero
days. Validation and final-test days are kept separate and cannot satisfy the training gates.
Products that fail these checks use the Python Moving Average fallback.

Missing calendar dates currently count as zero sales. An unrecorded day or a stockout can differ
from genuine zero demand; confirm ledger completeness and the interpretation of such days with
the future partner before using results for research or purchasing decisions.

### How the models are evaluated

| Stage                | What it is used for                                                          |
| -------------------- | ---------------------------------------------------------------------------- |
| Training             | Fit candidate models and determine product eligibility/ranking               |
| Validation           | Select parameters, ensemble weights, and the operating method                |
| Final test / holdout | Measure performance on later dates that did not select the model             |
| Operational refit    | Refit the selected configuration on observed history to predict future dates |

Validation and final test each use `max(1, min(14, calendarDays // 5))` days at the end of the
history; earlier days train. The Python worker compares three XGBoost parameter candidates
on validation. Features include sales lags of 1, 7, and 14 days, means over 7 and 30 days,
weekday, and month.

**Moving Average** is the recent-demand baseline. **XGBoost** uses the official Python package
to learn from those features. **Ensemble** combines the two forecasts with weights determined
by validation MAE. Validation selects the operating method for each product.

Final-test predictions use the same product/date observations and fixed cutoff for comparison.
They are recursive: actual final-test demand is not fed back into prediction or model selection.
After evaluation, the chosen configuration is frozen and the operational model is refitted
through the observed history.

### Reading the screen

- The three model cards show aggregate **MAE** and **RMSE** on matching ML-eligible observations. With no eligible products, XGBoost/ensemble scores may be unavailable.
- **MAE** means average absolute error in product units. **RMSE** gives more weight to larger errors. Lower values mean smaller errors on the evaluated data.
- **Better model** reflects the validation selection. It does not mean the smallest displayed final-test error was used to choose it.
- The product selector changes the chart and its method, daily demand, grain, nonzero-day count, and confidence label.
- Hover over the chart to inspect dates and available Actual, Moving Average, XGBoost, and Ensemble values.
- Actuals cover the final-test period; future dates have predictions rather than observed outcomes.
- In **Per-product holdout errors**, **Obs** means nonzero sales days, not total calendar days.
- An em dash or `n/a` means a score is unavailable. Baseline-only products have no XGBoost score.
- **Copy MAE / RMSE table** copies a tab-separated aggregate table suitable for a spreadsheet. Your browser can block clipboard access.

Future predictions start after the **latest recorded sale date**, which can be earlier than
today. Keep sales history current and inspect chart dates before treating a forecast as current.

All normal-mode operational confidence labels remain **low** pending research validation.
No certified accuracy, calibrated prediction intervals, or confidence percentages are claimed.
A generic interval legend in a chart does not establish an evaluated interval; normal API
forecasts do not provide a calibrated band. Forecasts support decisions and do not guarantee sales.

## 13. Restock: statuses and calculations

Open **Restock** to review **Order now**, **Watch list**, and **Healthy stock**.
Each card shows the product, SKU, category, supplier lead time, safety stock, operating demand
method, on-hand stock, daily demand, reorder point, days of cover, and recommended quantity.

| Symbol | Meaning                                                                  |
| ------ | ------------------------------------------------------------------------ |
| D      | Average predicted daily demand, or the available Moving Average fallback |
| L      | Supplier lead time in days                                               |
| SS     | Safety stock in product units                                            |
| C      | Configured cover days after delivery                                     |
| I      | Current on-hand stock                                                    |

```text
Reorder point = D × L + SS
Target stock = D × (L + C) + SS
Suggested quantity = max(0, ceil(Target stock - I)), only when I <= Reorder point
Days of cover = I / D, when D is positive
```

Above the reorder trigger, suggested quantity is zero even if current stock is below target
stock. The displayed reorder point is rounded up; the trigger calculation uses the unrounded
value. With zero estimated demand, days of cover cannot be estimated and the UI displays an
em dash.

| Status   | Normal API meaning                                                                                 |
| -------- | -------------------------------------------------------------------------------------------------- |
| Stockout | On-hand stock is zero                                                                              |
| Reorder  | Stock is at or below the reorder point                                                             |
| Watch    | Stock is above the trigger, but days of cover are at or below lead time plus configured cover days |
| Healthy  | Stock is above the trigger and outside the Watch band                                              |

### Fictional worked example

Suppose demand is 10 units/day, lead time is two days, safety stock is five units, and cover days
are seven. The reorder point is 25 and target stock is 95.

- With 20 on hand, the suggestion is 75 units.
- With 30 on hand, the suggestion is zero because the product has not reached the trigger.
- Receiving 60 units when 20 are on hand makes the new stock 80. Record the actual 60, not the previous suggestion of 75.

The current calculation does not account for outstanding purchase orders, supplier pack sizes,
minimum order quantities, changing supplier lead times, or lost demand during stockouts.
Check those business conditions before ordering. **Record delivery** changes stock only when you
save an actual receipt; it does not contact a supplier.

## 14. Strategies and supporting thesis material

In normal mode, **Strategies** contains four tabs:

| Tab         | What you can do                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| Methodology | Read chronological evaluation, eligibility, model features, and saved forecast behavior; the owner can Refresh forecasts |
| Thesis text | Read/copy supporting sections and download available Markdown/Word artifacts                                             |
| User guide  | Search this manual, browse/expand topics, and download the manual                                                        |
| Evaluation  | Rate five selected system-quality characteristics and save a browser draft                                               |

The selected tab is part of the URL, so a direct link or reload can reopen it. Older
`/guide` links redirect to the User guide tab, retaining a topic hash when supplied.
Normal API-mode access requires sign-in.

### Complete the evaluation

1. Open **Evaluation**.
2. Rate Functional suitability, Reliability, Interaction capability, Performance efficiency, and Maintainability from 1 (Poor) to 5 (Excellent).
3. Check the number of scored criteria and the mean. The mean uses scored criteria only; an unanswered item is not a zero rating.
4. Choose **Save ratings** before leaving the tab. Partial drafts can be saved.
5. Reopen the same browser/device and account to load the saved draft.

**Clear form** clears the displayed scores; choose Save ratings to save the cleared draft.
Normal-mode drafts are kept separately for each business/account in browser storage.
Browser-demo drafts retain their earlier local storage. These ratings are not uploaded to the
server or included in the PostgreSQL dump. They are selected-characteristic feedback, not a
complete standards assessment, certification, or completed research result.

The thesis panel provides **Show/Hide** sections, **Copy this section**, copying all text, and
Markdown/Word downloads where available. These are supporting checked-in artifacts. The latest
approved Chapters 1-3 are maintained outside this repository, so the checked-in text/downloads
can lag the current manuscript.

Use the maintained working drafts for formal thesis wording. Screen metrics and fictional
examples are not evidence of approved research outcomes.

The extra Accuracy, Speed, and Models prototype tabs belong to the optional browser
demonstration and are described in the browser-demo section.

## 15. Where records live and how devices share them

Normal-mode records live in PostgreSQL, not only in your browser. Different authorized users
connecting to the **same server** access that server's business records.

Separate laptop installations and a hosted installation have separate databases; they do not
synchronize automatically. Transfer authorized records deliberately through imports or a planned
backup/restore.

| Storage                                             | What it contains                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `stockcast_postgres_data`                           | PostgreSQL records, accounts, settings, forecast jobs/results, and migration history |
| `stockcast_model_data`                              | Official trained XGBoost model JSON files                                            |
| `stockcast_caddy_data` and `stockcast_caddy_config` | Web server certificate/configuration data                                            |
| Browser demo's `stockcast-v5` storage               | Separate synthetic demonstration catalog, sales, and settings                        |
| Older SQLite files                                  | Older optional adapter records; not automatically migrated                           |

Those are the default volume names for the current Compose project. Ordinary container
recreation and `npm run stop` preserve named volumes. Removing volumes or using Docker's data
reset can erase stored records.

Forecast status/dashboard data are polled, but another browser's product/sales edits are not a
complete live refresh of your local catalog/ledger. Reload the application when you need to
see another user's latest catalog/ledger changes.

The sidebar label **Test records** or **Partner records** describes configured record provenance.
Setting `OWNER_DATA_ORIGIN=partner` does not prove that records came from a partner; use it only
for authorized actual business data. Browser-demo seeds remain synthetic regardless of their
older scenario label.

## 16. Start, stop, logs, and service health

Run these commands from the project folder.

| Command                                         | Purpose                                                                    |
| ----------------------------------------------- | -------------------------------------------------------------------------- |
| `npm run setup`                                 | Create a missing private configuration without starting services           |
| `npm start`                                     | Build/start the complete Compose application and wait for readiness        |
| `npm run stop`                                  | Stop/remove application containers and network while keeping named volumes |
| `npm run logs`                                  | Follow recent service logs                                                 |
| `docker compose ps -a`                          | List running and exited services                                           |
| `docker compose logs --tail 100 worker`         | Inspect recent worker messages                                             |
| `docker compose logs --tail 100 api initialize` | Inspect API/initialization errors                                          |
| `npm run backup`                                | Create a timestamped PostgreSQL backup                                     |

`npm run logs` stays open; Ctrl+C stops following the logs. The services started by
`npm start` run detached, so closing that terminal does not stop them.

A healthy installation normally has database and api running/healthy, web and worker running,
and initialize exited with code 0. Initialize is a one-time successful step, not a service
that must stay running.

Compose publishes web HTTP/HTTPS ports. PostgreSQL and the API remain inside its network.
Changing the 180-second container-readiness wait is different from fixing a failed image build.

## 17. Backups and a safe recovery check

### Create and retain a backup

1. Make sure the database service is running.
2. Run `npm run backup`.
3. Confirm the command succeeds and note the timestamped `.dump` file under `backups/`.
4. Copy that dump to your chosen protected backup location.
5. Keep a protected copy of your private configuration and copy trained model files separately.

```powershell
npm run backup
docker compose cp worker:/app/data/models backups/models
```

The backup is a PostgreSQL custom-format dump containing database tables, records, and migration
checksums. A failed backup command removes its incomplete dump.

| Included in the database dump                 | Saved separately                                                      |
| --------------------------------------------- | --------------------------------------------------------------------- |
| Products, sales, stock movements, imports     | Private `.env` configuration and access credentials                   |
| Business settings and account password hashes | Trained files from the model volume                                   |
| Forecast jobs, saved predictions, and metrics | Caddy certificate/configuration volumes if required by the deployment |
| Database migration history                    | Source/configuration needed to recreate the installation              |
| Other records stored in that database         | Browser storage, including evaluation drafts, and older SQLite files  |

The database dump and separately copied model files are not one atomic snapshot. For
recovery-sensitive copies, arrange a quiet period without a running forecast job.
A restored database preserves existing account password hashes; restoring is not a password
reset.

### Test a dump without replacing the live database

The following example restores into a **new, separate** database. Replace
`backups/your-backup.dump` with the file you created. The check-database name must not already
exist. An installation administrator should run this check.

```powershell
docker compose exec database createdb -U stockcast_admin -O stockcast stockcast_restore_check
docker compose cp backups/your-backup.dump database:/tmp/stockcast-backup.dump
docker compose exec database pg_restore -U stockcast -d stockcast_restore_check --exit-on-error /tmp/stockcast-backup.dump
docker compose exec database psql -U stockcast -d stockcast_restore_check -c "SELECT count(*) FROM products;"
```

Successful restoration and a product count provide a basic recovery check. Compare expected
records and exercise the restored application's workflows in an isolated environment for a
full drill. Live cutover requires a planned transfer of database, model files, configuration,
and credentials, with team-approved record validation. These commands do not replace the
running business database.

Choose backup frequency, retention, destination, and responsibility with the team/business.

## 18. Configuration and hosting

Installation administrators manage root `.env`. The website's Settings screen manages the
business/forecast fields described earlier.

| Environment value                      | What it controls                                                     |
| -------------------------------------- | -------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`                    | Initial database administrator password                              |
| `APP_DB_PASSWORD`                      | Initial restricted application database-role password                |
| `OWNER_PASSWORD`                       | Initial owner's password, at least 12 characters                     |
| `OWNER_BUSINESS_ID`                    | Initial business UUID                                                |
| `OWNER_BUSINESS_NAME`                  | Initial business name                                                |
| `OWNER_DISPLAY_NAME` and `OWNER_EMAIL` | Initial account identity                                             |
| `OWNER_DATA_ORIGIN`                    | `demo` or `partner` record provenance                                |
| `APP_ENV`                              | Development or production behavior, including secure cookies         |
| `APP_ADDRESS`                          | `:80` for local HTTP, or a public hostname for HTTPS                 |
| `HTTP_PORT` and `HTTPS_PORT`           | Published host ports; local defaults 8080 and 8443                   |
| `CORS_ORIGIN`                          | Allowed frontend origin; Compose defaults to `http://localhost:8080` |
| `GOOGLE_CLIENT_ID`                     | Optional Google Web application OAuth client ID                      |
| `GOOGLE_CLIENT_SECRET`                 | Optional private server-only Google OAuth secret                     |
| `GOOGLE_REDIRECT_URI`                  | Optional registered callback at the exact website origin             |

Use URL-safe generated database passwords, such as hex values. Changing environment database
passwords after PostgreSQL's persistent volume exists does not rotate the existing role
passwords. The database administrator must coordinate actual credential changes.

### Hosted installation

1. Prepare a persistent server with Docker Compose and Node.js 24 or newer.
2. Run `npm run setup` and configure private credentials before its first initialization.
3. Set the real domain and production values. The example below is a placeholder, not a deployed StockCast domain.
4. Point the domain's DNS to the server and allow incoming HTTP/HTTPS ports 80 and 443.
5. Run `npm start`. Caddy manages HTTPS certificates for the configured public domain.
6. Open the HTTPS address, sign in, and verify the actual installation and recovery plan.

```dotenv
APP_ENV=production
APP_ADDRESS=stockcast.your-domain.com
HTTP_PORT=80
HTTPS_PORT=443
CORS_ORIGIN=https://stockcast.your-domain.com
```

Production cookies require HTTPS. Keep the configuration, server access, storage, and backup
retention under the deployment administrator's control. A laptop and the server do not
automatically share existing records.

### Optional Google setup

Google is optional; email/password registration and sign-in work without its credentials.
The administrator configures the server's private environment. Keep the Google client secret
out of source control, screenshots, browser code, and any variable starting with `VITE_`.

1. Create/select a Google Cloud project and configure Google Auth Platform **Branding**, support/contact details, and **Audience** for the people who will use the installation. See [Google's Auth Platform setup](https://support.google.com/cloud/answer/15544987?hl=en).
2. Under **Clients**, create a **Web application** OAuth client. Register the exact callback from the table below as an **Authorized redirect URI**. Scheme, host, port, and path must match. See [Google's web-server OAuth setup](https://developers.google.com/identity/protocols/oauth2/web-server).
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` in the appropriate private server configuration. Set `CORS_ORIGIN` to the exact website origin, with no API path. Compose uses the root `.env`; direct Python development uses `backend/.env`.
4. Review Audience/test users and publishing status before rollout. Google documents an exception to the usual Testing user-list/seven-day limits for the basic `openid email profile` scopes StockCast requests. Other scopes or organizational restrictions can change availability. Follow [Google's current Audience rules](https://support.google.com/cloud/answer/15549945?hl=en).
5. Run `npm start` to rebuild/recreate Compose with the new configuration, or restart the direct development API. Reopen the matching website origin.
6. Verify real Google sign-in, first-account setup, and intentional account connection on that installation. Keep a record of the actual result; code and mocked-provider tests do not establish successful live OAuth.

| Installation                       | `CORS_ORIGIN` / website origin      | `GOOGLE_REDIRECT_URI` / registered callback                     |
| ---------------------------------- | ----------------------------------- | --------------------------------------------------------------- |
| Default local Compose              | `http://localhost:8080`             | `http://localhost:8080/api/v1/auth/google/callback`             |
| Vite with direct Python API        | `http://localhost:5173`             | `http://localhost:5173/api/v1/auth/google/callback`             |
| Hosted example, replace the domain | `https://stockcast.your-domain.com` | `https://stockcast.your-domain.com/api/v1/auth/google/callback` |

Hosted callbacks require HTTPS. The callback must use the same origin as `CORS_ORIGIN` and
the exact path `/api/v1/auth/google/callback`, with no trailing slash, query, or fragment.
Register a changed host/port in Google too. Use the same hostname throughout a flow; localhost
and 127.0.0.1 have different cookies.

### Authentication attempt limits

The API limits registration attempts to **five per hour per client IP**, password sign-in to
**ten per minute per client IP and email**, and throttled authentication writes to a shared
**120 per minute per client IP**. Google flow starts also have ten attempts per minute per IP.
An HTTP 429 response means wait for the stated retry interval.

These counters are held in each API process. A deployment with multiple processes/replicas
needs coordinated limits at its gateway or another shared limiter; process-local limits alone
do not enforce a single installation-wide quota.

## 19. Optional browser demonstration

The browser demonstration is an explicit development mode for synthetic examples. It bypasses
sign-in, stores records locally in that browser, and uses custom TypeScript boosted trees.
That prototype is not the official Python XGBoost implementation and does not establish
validated research accuracy.

For developers, install frontend dependencies, set this in `.env.local`, and start Vite:

```dotenv
VITE_DATA_MODE=browser-demo
```

```powershell
npm ci
npm run dev
```

Restart Vite after changing mode. Normal container builds use API mode by default.

### Differences to expect

- The seed catalog/store/location and generated sales are synthetic placeholders, even if an older scenario setting says `partner`.
- Data stay in this browser's `stockcast-v5` storage; another browser/device has separate demo data.
- The demo display date is fixed rather than the normal live header date.
- Prototype forecast training can be triggered in the background after data changes; its caches/illustrative intervals are distinct from Python saved runs.
- The demo Watch band is a fixed ten days of cover; normal Python mode uses lead time plus configured cover days.
- API CSV export controls are not part of this browser-only persistence workflow.
- **Reset demo data** immediately replaces local demo products, sales, and settings with the seed data. Export/save anything you need before using it.

### Extra prototype Strategies tools

The browser Strategies page has **Accuracy**, **Speed**, **Thesis text**, **Models**,
**User guide**, and **Evaluation** tabs. Accuracy/Speed describe prototype reliability levels and architecture
techniques; Speed has **Retrain models**. Models shows prototype parameters, errors, and
inventory mathematics.

Evaluation uses the same five rating questions as normal mode, with its own browser-demo
draft. **Save ratings** preserves the draft and the mean uses scored criteria. Existing demo
ratings remain available. The User guide tab provides the same searchable/downloadable manual.
Neither synthetic demo behavior nor these ratings establishes research results or standards
compliance.

Older SQLite adapter commands are a separate optional legacy demonstration. They are not the
normal PostgreSQL startup and do not automatically migrate into it.

## 20. Troubleshooting

### Startup/build problems

| Message or symptom                                       | Meaning and next step                                                                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Start Docker Desktop first                               | Start its Linux engine; check `docker info`, then retry `npm start`                                                                              |
| Replace the password placeholders                        | Replace remaining `replace_with_` values in the private configuration                                                                            |
| `python:3.12-slim ... TLS handshake timeout`             | Docker timed out on a secure registry request; restart Desktop, try `docker pull python:3.12-slim`, then retry startup                           |
| `rpc error ... EOF` during export                        | The build-status connection closed; the message alone does not establish why. Restart Docker Desktop and inspect its build details if it repeats |
| `DONE`, `CACHED`, pip root warning, or pip update notice | Ordinary build status/notices; find the later actual failing step                                                                                |
| Startup failed                                           | The wrapper reports a failed Compose command; inspect the preceding error                                                                        |
| initialize exited 0                                      | Normal completion of the initialization step                                                                                                     |
| Website cannot be reached                                | Check `docker compose ps -a`, configured web port, and service logs                                                                              |

For a registry timeout, run the pull separately to check whether the required base image can
be retrieved:

```powershell
docker pull python:3.12-slim
npm start
```

If the pull fails, check connectivity and any VPN/proxy configuration. A timeout does not prove
which network component caused it. Docker's [troubleshooting guide](https://docs.docker.com/desktop/troubleshoot-and-support/troubleshoot/)
covers restarting Desktop; its [settings documentation](https://docs.docker.com/desktop/settings-and-maintenance/settings/)
covers proxies.

Build failures occur before application containers run, so `npm run logs` may have no relevant
container messages. Use the earlier build output and Docker Desktop's linked build details.
Increasing the container-readiness timeout does not repair registry TLS failures or build EOF.

### Sign-in and record problems

- **Invalid credentials:** check the email/password for the existing account. Open **Choose a specific business** if matching credentials belong to multiple older stores. Changing initial-owner values in `.env` does not change that account.
- **Email already registered:** sign in to the existing account. Public registration creates a separate store only for a new email.
- **Passwords do not match:** enter the same password in both registration fields; new passwords must contain 12 to 128 characters.
- **Browser did not offer to save the password:** check its password-manager settings and site exceptions. The save checkbox requests browser-owned saving after successful password sign-in or registration; prompts remain under browser control. Private browsing or unsupported features can prevent a prompt.
- **Too many attempts:** wait for the server's retry interval before trying again. Follow the retry interval before submitting another attempt.
- **Google button missing:** the administrator must configure a valid Google client, secret, callback, and matching website origin, then restart the API.
- **Google redirect URI mismatch:** register the exact configured callback in Google Cloud, including scheme, hostname, port, and `/api/v1/auth/google/callback`.
- **Google setup expired:** restart Continue with Google; temporary flow/setup records last ten minutes.
- **Google email already has an account:** sign in with its password, then connect Google under **Inventory > Settings > Your account**. Emails do not automatically connect identities.
- **Google denied or connection failed:** start again from StockCast and review the Google Cloud audience/consent configuration and API logs, excluding secrets.
- **Session expired or CSRF error:** sign in again using the same configured website origin. Avoid switching between localhost and 127.0.0.1 during a session; production uses HTTPS.
- **Owner role required:** use an owner account for the management action.
- **Insufficient stock:** check the physical count; record an actual receipt or an authorized count correction before a new sale.
- **CSV row rejected:** check the exact column order, known SKUs, ISO dates, numeric precision, duplicate rows, and unsupported commas/newlines.
- **Historical import changed the ledger but stock stayed the same:** this is intentional; it adds history without deducting the current count.
- **Another user's catalog changes are absent:** reload the application to fetch that catalog/ledger.

### Forecast and backup problems

- **No XGBoost score:** inspect training-only history, 100 nonzero days, and top-N eligibility. Moving Average is the fallback.
- **Forecast queued indefinitely:** check the worker with `docker compose logs --tail 100 worker`.
- **Worker interrupted; refresh to retry:** after the worker is running, the owner can explicitly refresh the failed job.
- **A stale forecast warning:** record/import complete history, save settings, and refresh.
- **Forecast dates look old:** predictions start after the latest recorded sale date. Check that recent sales are recorded before refreshing.
- **Low confidence:** all operational confidence remains low pending validation; it is not evidence of a certified probability.
- **Days of cover is an em dash:** the current demand estimate is zero or unavailable.
- **Clipboard blocked:** use a browser that permits clipboard access at the configured origin, or manually copy the displayed values.
- **Backup failed:** check that the database service is running, inspect the error, and retry. Do not rely on a failed/incomplete dump.

For a support report, provide the exact error, action/command, approximate time, and relevant
service/build output. Omit passwords, cookies, tokens, and private customer/business data.
Avoid deleting volumes or resetting Docker data as a routine troubleshooting step.

## 21. Development and implementation reference

This section is for the team maintaining the installation. Ordinary business use starts with
`npm start`; the commands here serve development.

`npm ci` installs the locked frontend packages. `npm run dev` provides frontend hot reload,
normally on port 5173. Its default API proxy points to `http://127.0.0.1:3001`. Compose does
not publish that API port, so unmodified Vite development needs a directly running Python API
or an intentionally configured alternative proxy.

Use Python 3.12 and a dedicated PostgreSQL development database. Configure the private
`backend/.env` from `backend/.env.example`; this is separate from Compose's root `.env`.
The backend README contains the database and owner setup details.

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r backend/requirements-lock.txt
python -m pip install --no-deps -e "./backend[forecast,test]"
python -m backend.app.initialize
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 3001 --reload
```

Run the worker in a second activated terminal with the same development configuration:

```powershell
python -m backend.app.worker
```

The direct API documentation is available at `http://127.0.0.1:3001/docs`. Inspect the actual
schema and authentication requirements before administrative API actions. This is the direct
development address, not a published Compose port.

| Files                                                       | Responsibility                                                  |
| ----------------------------------------------------------- | --------------------------------------------------------------- |
| `scripts/start.mjs`, `compose.yaml`, Dockerfiles, `deploy/` | Setup, service orchestration, builds, and web serving           |
| `scripts/backup.mjs`                                        | PostgreSQL dump creation                                        |
| `backend/app/main.py`, schemas, security, repository        | Python API contract, authorization, and database operations     |
| `backend/app/auth_routes.py`, auth_repository, google_auth  | Registration, Google identity, and existing session integration |
| `backend/app/forecasting.py`, worker, dashboard, inventory  | Model jobs, saved outputs, and reorder calculations             |
| `backend/db/`                                               | Existing SQL migration history                                  |
| `src/routes/`, `src/components/`                            | Website pages and user controls                                 |
| `src/lib/api.ts`, store, API forecast hook                  | Normal-mode frontend/API integration                            |
| `src/lib/forecast/`                                         | Separate browser demonstration forecasting                      |
| `docs/USER_GUIDE.md`                                        | This guide's single source for the website and download         |
| `docs/PROJECT_CONTEXT.md`                                   | Confirmed implementation/project facts                          |

### Verification commands

```powershell
npm run typecheck
npm run lint
npm run build
python -m pytest backend/tests
```

The system CI also checks Compose startup, worker/API behavior, backup restoration, and
persistence. Local checks do not prove a successful hosted deployment or validated forecast
accuracy. Preserve the existing database contract/migration history and the groupmate-reserved
date helper described in `backend/docs/RESERVED_DATE_HELPER.md`.

## 22. Glossary and decisions still needed

| Term                     | Meaning                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------- |
| SKU                      | Stable catalog identifier for a product                                            |
| On hand                  | Current stock balance in the product's counting unit                               |
| Lead time                | Expected days from ordering to receipt                                             |
| Safety stock             | Additional units held as a buffer                                                  |
| Reorder point / ROP      | Stock threshold that triggers a suggested replenishment                            |
| Cover days               | Estimated days the stock can support demand, or configured coverage after delivery |
| Horizon                  | Number of future dates predicted                                                   |
| Nonzero sales day        | A distinct date with positive total sales                                          |
| Moving Average / MA      | Baseline based on recent daily sales                                               |
| XGBoost                  | Official Python boosted-tree model in normal mode                                  |
| Ensemble                 | Weighted combination of MA and XGBoost                                             |
| Validation               | Date range used to select model configuration/method                               |
| Holdout / final test     | Later date range used to measure the frozen selection                              |
| MAE / RMSE               | Error measures in product units; lower means smaller evaluated error               |
| Snapshot                 | Captured input/counts at a particular point                                        |
| Provenance / data origin | Whether records are test data or authorized business data                          |
| Volume                   | Docker's persistent storage kept separately from containers                        |

The team/future partner still needs to confirm the real catalog and units, supplier policies,
ledger completeness, treatment of missing days and stockouts, correction/void procedures,
authorized data collection/import mapping, backup retention, deployment settings, and independent
research evaluation cutoffs. The guide does not invent those decisions or claim an approved
manuscript, completed partner evaluation, or certified model accuracy.
