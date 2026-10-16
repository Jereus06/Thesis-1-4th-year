# How to use StockCast

Use this guide to find a screen, record a transaction, and check your saved records. Choose a common task or search for words such as **sale**, **delivery**, **return**, or **staff**. Each task tells you where to go, what to enter, and what happens after saving.

## Getting started

### Your first visit

1. Open the StockCast website address given to you by the store owner or the person who manages the installation.
2. Sign in with your own email and password. If you were invited as staff, open the invitation email and finish setting your password first.
3. Read the store name in the sidebar to check that you are using the correct store.
4. Open **Inventory > Account & settings > Your account** to check your role. Staff see **Inventory > Account** instead.

**Create account** is for someone creating a separate store as its owner. It does not join an existing owner's store. Staff should use the owner's invitation.

### Create an owner account

1. Choose **Create account**, then enter **Your name**, **Email**, **Password**, and **Confirm password**. Use a password with 12 to 128 characters.
2. Enter the **Store name** and optional location.
3. Choose **Test records** for practice or **Authorized business records** for records you have permission to store. Confirm that permission when requested.
4. Choose **Create my store** and wait for the store to open.

Use the eye button to show or hide a password while checking it. Switching between account-access screens clears entered passwords. If the page says your account was created but store records could not be loaded, reload the page to load the existing account.

### Recover your password

1. Choose **Forgot password** on the sign-in screen. You can open it before entering an email.
2. Enter your account **Email**. If you use the same email in multiple stores, open **Choose a specific business** and enter the appropriate **Business ID**.
3. Choose **Send reset link**, wait for the confirmation, and check your inbox and spam folder.
4. Open the email link within 30 minutes. Enter **New password** and **Confirm password**, then choose **Reset password**.
5. After **Password updated**, return to StockCast and sign in with your new password when prompted.

Recovery confirmation does not reveal whether an account exists. Links work once; if a link is expired or already used, request a new one. The installation's email service must be enabled to deliver recovery mail. If mail does not arrive, ask the person managing the installation to check delivery. If this browser is signed into another account, returning to StockCast preserves that account's session.

### Sign out

Choose **Sign out** in the header and wait until the sign-in screen appears. The button shows **Signing out…** while the request is pending. If a connection or request error appears, retry after the connection is restored.

### Set up a new store

1. As the owner, open **Inventory > Products** and add your products or import your current inventory.
2. Check each product's counting unit and opening stock against your actual records.
3. If you have earlier sales, import them in **Inventory > Sales ledger** after the products exist.
4. Record new sales and deliveries as they happen. Review missing or unusual sales dates in **Quality**.
5. Review **Forecasts** and **Restock** after a forecast has completed.

An empty account starts without products or sales. An unavailable forecast means there is not yet usable history for that estimate.

### A daily routine

- Check **Overview** for stock and forecast notices.
- Use **Record sale** for new sales and **Record delivery** when goods arrive.
- Review **Restock** before deciding what to buy.
- Check **Sales ledger** and **Stock movements** to confirm the day's records.
- Review unusual dates in **Quality** and check that forecasts cover the dates you need.

Open **User guide** in the header whenever you need help. The same guide is available in **Strategies > User guide**. Choose **Download manual** to keep a readable copy.

## Find the right page

Use the sidebar on a laptop or the bottom navigation on a smaller screen.

| If you want to...                                              | Open this screen                                          |
| -------------------------------------------------------------- | --------------------------------------------------------- |
| See a summary of the store                                     | **Overview**                                              |
| Find products that may need more stock                         | **Restock**                                               |
| View a product's demand chart and forecast information         | **Forecasts**                                             |
| Add, find, or edit a product                                   | **Inventory > Products**                                  |
| Record an incoming delivery or check current stock             | **Inventory > Products**                                  |
| View sales, import past sales, or download sales records       | **Inventory > Sales ledger**                              |
| Record returns or write-offs and inspect stock changes         | **Inventory > Stock movements**                           |
| Check your account or change your password                     | **Inventory > Account & settings**; staff use **Account** |
| Invite staff or change store settings                          | **Inventory > Account & settings**, as the owner          |
| Review zero-sale days, closures, missing records, or stockouts | **Quality**                                               |
| Read the user guide                                           | **Strategies > User guide**                               |
| Give feedback after using the system                           | **Strategies > Evaluation**                               |

### Owner and staff access

Owners and staff can view the store's records, record sales and deliveries, record usable returns, review data quality, and use available exports. Both can maintain their own account.

Only owners can manage products, correct stock counts, write off stock, import files, change business settings, manage staff, or manually refresh forecasts. If a management button is absent, check **Your account** and ask the owner to perform that task.

## Record a sale

**Who can do this:** owner or staff.

**Where:** **Record sale** in the top-right header, or **Inventory > Sales ledger > Record sale**.

1. Choose **Record sale**.
2. Select the **Product**. Check the displayed on-hand quantity and counting unit.
3. Select the sale **Date** and enter the positive **Quantity** actually sold.
4. Choose **Save sale** and wait for the saved confirmation.
5. Open **Inventory > Sales ledger** to see the sale and **Stock movements** to see its stock deduction.

**What changes:** the sold quantity is subtracted from current stock. For example, a saved sale of 3 units reduces a balance of 20 to 17.

Use **Import CSV** in the Sales ledger for earlier sales already reflected in your current physical count. Recording an earlier date through **Record sale** still deducts stock now. Recording the same transaction twice deducts it twice.

If there are no active products, ask the owner to add or activate one. If the quantity exceeds the available stock, check the physical count and any unrecorded delivery before saving. Ask the owner to delete a mistakenly recorded sale using the steps below.

## Delete a recorded sale

**Who can do this:** owner only.

**Where:** **Inventory > Sales ledger**.

1. Find the row marked **Recorded**, using **Previous** or **Next** for older records.
2. Choose its **Delete** button and review the product, date, quantity, and stock restoration.
3. Choose **Delete sale** to confirm, or **Cancel** to keep the sale.
4. Wait for confirmation, then refresh forecasts from **Overview** or **Forecasts**.

**What changes:** the sale disappears from the sales ledger, sales exports, and future forecast inputs. Its quantity is restored to the product's current stock exactly once. For example, deleting a mistaken sale of 3 units increases a balance of 17 to 20. The original stock deduction remains in **Stock movements**, alongside a new adjustment identifying the deleted sale and the owner who deleted it. The original sale is retained internally as voided for that audit history.

Use this to correct a mistaken entry. For an actual customer return, use **Stock movements > Record return** so the original sale remains part of sales history.

If deletion succeeds but saved records cannot be refreshed, choose **Reload saved records** in the notice. The deletion is already saved; do not record an extra delivery or return to restore the same quantity.

## Delete imported sales

**Who can do this:** owner only.

**Where:** **Inventory > Sales ledger**.

1. Find the row marked **Imported**, using **Previous** or **Next** for older records.
2. Choose its **Delete** button, review the product, date, and quantity, then choose **Delete sale**. Choose **Cancel** to keep the row.
3. To remove the entire imported history, choose **Delete imported sales** above the table and confirm. This includes imported rows on every page.
4. Wait for confirmation, then refresh forecasts from **Overview** or **Forecasts**.

Deletion permanently removes imported sales history and preserves current stock, stock movements, and recorded sales. Saved forecasts become stale; existing forecast-run snapshots remain available for review. The system keeps import audit metadata. The original file can be imported again after every accepted row in its batch has been deleted. A partially deleted batch keeps its duplicate-file safeguard; correct or remove the remaining imported rows before reimporting that exact file.

If deletion fails, the dialog keeps the error visible so you can retry. If deletion succeeds but the ledger refresh fails, choose **Reload saved records** in the notice; the deletion has already been saved.

## Record a delivery

**Who can do this:** owner or staff.

**Where:** **Inventory > Products**, or a product card in **Restock**.

1. Find the product and choose **Record delivery**.
2. Enter the **Quantity received**, using that product's counting unit.
3. Check the quantity against the goods actually received.
4. Choose **Add to inventory** and wait for confirmation.
5. Check the new on-hand balance in **Products** and the receipt in **Stock movements**.

**What changes:** the received quantity is added to current stock. A delivery of 10 units increases a balance of 17 to 27.

Record a delivery after the goods arrive. A suggested reorder quantity does not place an order or add stock automatically. Enter the actual delivered quantity even if it differs from the suggestion. Deliveries can be recorded without a forecast or when the suggested quantity is zero. This form records the receipt for today and has no date picker.

## Record a return or write-off

**Where:** **Inventory > Stock movements**.

### Return an item to usable stock

**Who can do this:** owner or staff.

1. Choose **Record return**.
2. Select the **Active product** and **Movement date**.
3. Enter the positive **Quantity returned** and an optional note.
4. Review the resulting stock balance, then choose **Save return**.
5. Check the saved return in the ledger and the product's increased on-hand balance.

A return adds usable stock. It does not cancel the original sale, issue a refund, or change the Sales ledger. Follow your store's refund procedure separately.

### Remove damaged, expired, or lost stock

**Who can do this:** owner only.

1. Choose **Write off stock**.
2. Select the **Active product** and **Movement date**.
3. Enter the positive **Quantity to write off** and the required **Reason for write-off**.
4. Review the resulting balance, then choose **Save write-off**.
5. Check the saved write-off and the product's reduced stock balance.

The system will not accept a write-off that makes stock negative. A backdated return or write-off changes the current balance; it does not recalculate older saved balances.

## Correct a stock count

**Who can do this:** owner only.

**Where:** **Inventory > Products**.

1. Physically count the product using its existing counting unit.
2. Find its card and choose **Correct stock count**.
3. Enter the actual **Verified on-hand count**. Enter the full counted balance, not the difference.
4. Choose **Save count correction**.
5. Check the updated balance in **Products** and its adjustment in **Stock movements**.

**What changes:** the recorded balance is set to the verified count, and the difference is audited. If StockCast shows 20 units and you count 17, entering 17 records an adjustment of minus 3.

Use this task for a verified counting correction. Use **Record sale**, **Record delivery**, **Record return**, or **Write off stock** for the corresponding actual transaction.

## Manage products

**Who can do this:** owner only. Staff can view and find products.

**Where:** **Inventory > Products**.

### Add a product

1. Choose **Add product**.
2. Enter **Name**, **Category**, and **Unit**. Enter a SKU if your store already uses one, or leave it blank to generate one.
3. Enter the actual **Opening stock**, **Lead time (days)**, **Safety stock**, and **Unit cost (PHP)**.
4. Choose **Add to catalog**.
5. Find the saved product in the list and check its details.

Use one consistent counting unit for the product. For example, if the unit is pack, its stock, sales, deliveries, safety stock, and cost must all use packs. Positive opening stock creates an opening-balance record; it does not create sales history.

### Find or edit a product

1. Use **Search by product, SKU, or category** to find the item.
2. Choose **Edit details**, change the relevant fields, and choose **Save details**.
3. Check the saved product card.

Changing the unit label does not convert existing quantities. Use **Correct stock count** for a verified count rather than editing product details.

### Hide or restore a product

1. Choose **Deactivate**, review the confirmation, and choose **Deactivate product**.
2. Use the product-status filter to select **Inactive** or **All products** when you need to find it again.
3. Choose **Activate**, then **Activate product** to restore it.

Deactivation keeps the saved stock balance and history. Inactive products are excluded from new sales, operational stock movements, forecasts, and restock advice.
You can still import their past sales using the existing SKU. A historical sales import keeps
the product inactive and leaves its current stock unchanged.

### Delete a product

1. Find the product and choose **Delete**.
2. Check its name and SKU, then choose **Delete product** to permanently remove it, or **Cancel** to keep it.

Only products with zero stock and no saved history can be deleted. Sales, stock movements, forecasts,
and other saved records are protected. If these prevent deletion, the dialog explains why. You can
use **Deactivate** to stop using a product while keeping its records. Deletion cannot be undone.

## Import current inventory

**Who can do this:** owner only.

**Where:** **Inventory > Products > Import inventory**.

Use an inventory file to add products or update verified current stock counts. Save your spreadsheet as CSV; columns can have a different order and extra columns are skipped. For products already in StockCast, **SKU and On Hand are enough**. The default import keeps saved product details and ignores unrelated source details, including blank or invalid optional costs or lead times. New products need all the details below:

| Column       | What to enter                           |
| ------------ | --------------------------------------- |
| SKU          | A unique product code                   |
| Product      | Product name                            |
| Category     | Product group                           |
| Unit         | Counting unit, such as pack or pc       |
| On Hand      | Actual current stock, zero or higher    |
| Lead Time    | Whole number of supplier lead-time days |
| Safety Stock | Buffer quantity, zero or higher         |
| Unit Cost    | Cost per counting unit in PHP           |

1. Choose **Import inventory**, then **Choose CSV file** and select your file. You can also choose **Paste CSV**.
2. StockCast automatically selects the useful columns and number format, then checks all records.
3. Check the **Import preview**: product codes, counting units, and current stock counts. Safe report titles, repeated headers, padding, and trailing totals are ignored automatically; the summary shows how many report rows were ignored.
4. When the status says the file is ready, choose **Upload CSV** beside the filename, before the status and preview, to save it. The button stays visible after selecting a file and shows **Uploading…** while saving.
5. Wait for confirmation, then check **Products** and **Stock movements**.

Open **Adjust import** only if a detected column or number format needs changing. There are no required setup questions or review checkbox. To update saved metadata too, enable **Update existing product details from CSV**; supplied fields then need valid values, while absent fields keep their latest saved details. A nonblank incompatible unit always blocks import. For a new product, add its details in **Products** first or include them in the file. Under Adjust import, a verified shared Category, Unit, Lead Time, Safety Stock, or Unit Cost may be entered only when it applies to every row. Use **View original file** to compare the source with the import preview.

Choosing a file starts preparation and shows its status; **Upload CSV** stays visible beside the filename and becomes enabled when the file is ready. Unused columns and recognized report rows are skipped without warnings. If required data cannot be imported, a short explanation appears near the disabled **Upload CSV** button. Open **Import details** to inspect all affected fields or choose **Download complete error report** for every problem and its source record/starting line. CSV structure or file-decoding problems appear under **File details**. The screen shows at most 50 problems. Correct required source values and select the file again, or edit pasted text.

Selecting a file or viewing its preview does not save it. Original and converted previews are bounded; all data records are checked and the full valid file is used for import. Use **Cancel preparation** to stop, or **Prepare again** to retry. To change uploaded data, edit the source file and select it again. Selecting a new source clears its mappings and format choices. Changing a mapping or format triggers fresh preparation; check the converted values before saving.

**What changes:** matching SKUs replace current counts with audited corrections and keep saved product details by default. **Update existing product details from CSV** also updates valid supplied metadata. New SKUs create products. Matching inactive products are reactivated, and products absent from the file remain saved. A rejected inventory row prevents the whole snapshot from saving.

If a notice says the import **was saved** but the product list could not be refreshed, choose **Reload saved records**. Avoid importing the same source again just to refresh the view.

Stock and safety quantities allow up to three decimal places; unit cost allows four. Extra precision is rejected rather than rounded. Duplicate SKUs in one file must be corrected. For an existing SKU, use its current counting unit; changing a unit label does not convert quantities or historical records. The maximum is **5,000 inventory data rows per import**, with a **25 MiB file or pasted-source limit**. Extra unused columns are ignored even in wide files. This is a current inventory snapshot, not a delivery list or sales file.

## Import past sales

**Who can do this:** owner only.

**Where:** **Inventory > Sales ledger > Import CSV**.

Create or import the products first. Save the spreadsheet as CSV. StockCast detects clear column matches and skips unrelated columns:

| Column                      | What to enter                                                                    |
| --------------------------- | -------------------------------------------------------------------------------- |
| Date                        | Sale date; clear formats are detected and saved as **YYYY-MM-DD**                |
| Product                     | An existing SKU; an unambiguous product name or internal product ID also works   |
| Quantity                    | Positive sold quantity in that product's unit                                    |
| Source Record Key, optional | A stable unique identifier for one sale line                                     |
| Unit, optional check        | Nonblank values must match the product's counting unit; blank values are ignored |

1. Open **Sales ledger > Import CSV**, then choose **Choose CSV file** and select your file, or choose **Paste CSV**.
2. StockCast automatically selects the useful columns and formats, then checks all records. The displayed format summary shows its choices.
3. Check the **Import preview**, especially dates, products, sold quantities, and counting units. Unused columns and safe report rows are ignored automatically. Open **Adjust import** only if a detected column or format needs changing.
4. If required data is unavailable, a short explanation appears near the disabled **Upload CSV** button; **Import details** lists the affected records. If a product is unrecognized, correct its source SKU or open **Adjust import** and use **Find catalog product** and **Match product** to choose the existing product with the same counting unit. Add missing products in **Products** first. The complete error report includes problems beyond those shown on screen.
5. When the status says the file is ready, choose **Upload CSV** beside the filename, before the status and preview, to save it; no additional confirmation checkbox is required. The button stays visible after selection and shows **Uploading…** while saving.
6. Read the imported, already-imported, and rejected counts. Check the **Sales ledger** or choose **Export sales CSV** for all saved rows.

StockCast uses the file and catalog to identify required information and ignores unrelated columns. It does not interpret receipt totals or revenue as sold quantities. No missing dates, quantities, or product details are invented, and invalid rows are not silently discarded. Missing required columns are reported so you can correct the source or choose a column under **Adjust import**.

When a file supports more than one interpretation, StockCast prefers ISO dates, then day/month/year, then month/day/year. For numbers it prefers a decimal point, then comma grouping, then a decimal comma. For example, otherwise ambiguous **05/10/2026** becomes **2026-10-05**, and **1,234** becomes **1234**. Check the converted preview and use **Adjust import** if your source uses the other meaning. Evidence elsewhere in the same file can select another supported format automatically.

Under **Adjust import > Selected product matches**, search by source identifier, SKU, or product name, or use **Previous selected matches** / **Next selected matches** to review 50 at a time. Every choice can be changed or removed. Changing the product column, separator, or header choice clears these matches so you can review the new identifiers.

**What changes:** past sales are added to demand history for existing products, including inactive
ones. They do not reduce current stock, reactivate products, or create a delivery. This is
appropriate for older transactions already reflected in your current physical count.

If a notice says the import **was saved** but the ledger could not be refreshed, choose **Reload saved records**. The save succeeded; this button reads saved records without importing the file again.

Sold quantities must be positive with up to three decimal places. Extra precision is rejected rather than rounded. The maximum is **100,000 sales data rows per import**, with a **25 MiB file or pasted-source limit**. Extra unused columns are ignored even in wide files. The converted preview shows the first 50 data records; it does not limit the import to 50 rows. The original preview is also bounded. Mapping or format changes invalidate the earlier preparation and trigger fresh preparation.

### Fix an import problem

- If a product is unknown or ambiguous, check its SKU and unit in **Products**, then match it explicitly or correct the source file.
- If a date is rejected, check the selected date format and the actual calendar date. Two-digit years and timestamps are not converted to sale dates.
- If numbers are rejected, check the selected decimal/grouping format. Remove currency symbols in the source and verify that stock/quantity precision is supported.
- If quotation marks or separators are malformed, correct the CSV structure before its rows can be checked.
- Repeated Source Record Keys inside the same file must be corrected before importing. Separate sale lines need distinct keys.
- Keep the same **Source Record Key** when the same sale line appears in another file. Separate sale lines need distinct keys, even when they share a receipt number.
- A matching saved key is skipped. A key reused with different product, date, or quantity is a conflict; check the original record.
- If some rows were saved and others rejected, inspect the results before retrying. Without source keys, retry only the rows that were not saved to avoid duplicate sales.

Added history is used by a later forecast refresh. The owner can refresh earlier, or the installation's daily forecast schedule can process it.

## Find sales and stock history

**Who can do this:** owner or staff.

### Sales ledger

1. Open **Inventory > Sales ledger**.
2. Check the most recent records and the total sales-record count.
3. Choose **Export sales CSV** to download all saved sales for this store.

The table displays **40 records per page**, with **Previous** and **Next** controls to reach the complete history. It has no search or date filter. The export contains all saved sales, including rows on other pages. StockCast automatically recognizes its import fields and ignores the extra columns. Saved Source Record Keys are included for duplicate checking on reimport. Records originally saved without keys remain unkeyed; overlapping unkeyed records cannot be reliably identified.

### Stock movement ledger

1. Open **Inventory > Stock movements**.
2. Search by product, date, note, or recorded user ID, or choose a movement-type filter.
3. Use the page controls to browse results and expand audit details for a record.
4. Choose **Refresh** to load the latest movements, including changes made by another user.
5. Choose **Export CSV** to download the movement records.

Positive changes add stock; negative changes subtract it. **Saved balance** is the balance immediately after that movement, not necessarily today's stock. Historical sales imports do not have a matching stock deduction.

Exports are useful copies of business records. Ask the person managing the installation to maintain database backups as well.

## Read and refresh forecasts

**Who can view:** owner or staff. **Who can manually refresh:** owner only.

**Where:** **Forecasts**.

1. Check the forecast status, notices, and displayed dates.
2. Choose a product in the results dropdown to see its own results. Choose **Overall results** to return to the combined comparison.
3. Read its expected daily sales, chart, and any notices about its records.
4. Hover over the chart to inspect a date's available actual sales and predictions.
5. Read the **MAE / RMSE** scores in the three method cards. MAE shows average error; RMSE gives more weight to larger mistakes. Lower is better. **Past forecast errors by product** shows every product's results below the chart.

XGBoost requires sufficient usable training history and an eligible place within the configured ML product limit. A product can use Moving Average when those requirements are not met. **0 ML SKUs** means none currently qualifies for machine learning; it does not mean your products or recorded sales disappeared.

### Find the Top products

The **Top products for XGBoost** panel is near the top of **Forecasts**. It lists the selected
products, rank, product code, quantities sold during the saved training period, expected sales
per day, and current forecast confidence. The saved selection counts and sales dates appear above the table.

To use a limit of five, open **Inventory > Account & settings > Advanced forecasting settings**,
set **ML product limit** to **Top 5 eligible products**, and choose **Save settings**. Then open
**Forecasts** and choose **Refresh forecasts**. After it completes, the panel shows up to five
eligible products ranked by training-period sales quantities. The limit is a maximum: a list
of two products means only two qualified, not that three products disappeared.

This is the XGBoost training selection, not a guaranteed future best-selling list. Products
outside the selection can still have Moving Average estimates. A selected product may also
use Moving Average as its operating method if validation supports it. Different product units
are shown beside quantities; pieces, bottles, and packs are not converted into one counting unit.
Changing records or the limit keeps the earlier saved selection visible with a refresh notice.
Deactivated products are omitted from the active list. Older runs without recoverable selection
metadata request a refresh instead of inventing ranks.

### Update after records change

1. As the owner, save the new records or reviewed dates first.
2. Open **Forecasts** and choose **Refresh forecasts** once.
3. Wait while the run is queued or processing. You can continue using other screens.
4. Review the completed result, product dates, and any remaining warnings.

When daily automatic updates are enabled, forecasts refresh at the configured time. The normal default is **00:15 in the store's timezone**. It uses history through the preceding completed business day and requires the installation to remain running. Staff can record daily activity without manually starting training.

### Understand the notices

| Notice                    | What to do                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------- |
| Queued or processing      | Wait for the result; avoid repeated refresh requests                                   |
| Stale                     | Records or settings changed; review the next completed refresh                         |
| Expired                   | Update recent sales or verified zero-sale dates, then ask the owner to refresh         |
| Unavailable or an em dash | Read the reason; a value was not available, rather than measured as zero               |
| Moving Average fallback   | Check the product's history and quality notes; it may not qualify for XGBoost          |
| High confidence           | Past error was small on at least 14 consecutive tested days; still review the estimate |
| Medium confidence         | Past error was moderate on at least 14 consecutive tested days                         |
| Low confidence            | Past errors were large, or there is not enough usable test evidence yet                |
| Tested on past sales      | Read the number of tested days and average error; future sales can still differ        |
| Basic estimate            | Uses recent usable sales; no saved past test is available yet                          |
| Not tested yet            | No usable saved test is available for this model; review its records                   |
| Refresh needed            | Records or settings changed after this estimate was saved                              |
| Demonstration             | Uses synthetic practice data; it does not describe client accuracy                     |

Check forecast dates before using them for today's purchasing. Unknown or excluded dates do not move old predictions forward. MAE and RMSE describe error on evaluated records, not a guaranteed accuracy percentage. Available prediction intervals show an estimated range, not a guarantee of future demand.

For example, an average error of **2.0 units** over **14 tested days** means the saved forecast was checked against 14 past days and differed from actual sales by an average of 2 units. It does not mean a 98% chance of being correct. Past errors and sales-record notices appear beside each estimate.

On a new forecast refresh, the past test period matches the forecast horizon when enough history
remains for training and validation. A 30-day forecast can therefore use a 30-day past test.
With less history, the test period automatically becomes shorter. The displayed tested-day count
includes only usable records; missing or excluded days do not count. Existing saved results keep
their original test period until the next refresh.

StockCast's confidence labels are a disclosed rating of past prediction error. The calculation
adds the absolute errors from the saved operating method's final-test predictions, then divides
that total by the actual units sold on those same tested days. **High** means this relative error
is at most **20%**; **Medium** means above 20% and at most **50%**. Both require at least
**14 consecutive tested days** with some actual sales. Larger errors, fewer tested days, gaps,
zero total actual sales, or no usable saved test receive **Low** with a reason. These thresholds
are StockCast display rules, not a universal statistical standard or a probability of future sales.
An unknown rating from an older API remains unavailable until a compatible refresh.

**Confidence and sales volume are different.** For example, high confidence in an estimate of
two spark plugs per day means past tests support that small estimate; it does not mean the shop
will sell many spark plugs. Read **Expected daily sales** for the amount. Changed records,
expired forecasts, and unavailable current demand suppress the old confidence rating. The
final-test rating never selects the model or recalibrates prediction intervals.

Overall comparisons use matching products and saved test records. If those records are incomplete, scores appear as a dash. The **Chosen method** comes from an earlier, separate check; the scores shown did not decide which method to use. A Moving Average-only test does not show an XGBoost score.

## Use restock recommendations

**Who can do this:** owner or staff can view and record deliveries.

**Where:** **Restock**; a summary is also shown in **Overview**.

1. Review the **Order now** products and any warnings about unavailable or older demand.
2. Check **Stock on hand**, **Expected daily sales**, **Order when stock reaches**, **Days stock may last**, and **Suggested order**.
3. Compare the recommendation with the physical count, supplier lead time, and your store's purchasing needs.
4. Arrange the purchase through your normal supplier process.
5. When the goods arrive, choose **Record delivery** and enter the actual received quantity.

**Order when stock reaches** allows for expected sales while waiting for the supplier, plus extra stock kept in reserve. The supplier delivery time and reserve stock appear below the product name. A suggestion does not place an order or record a delivery. A dash in **Days stock may last** means expected sales are zero or unavailable. You can still record an actual delivery when a sales estimate is unavailable.

## Review data quality

**Who can do this:** owner or staff.

**Where:** **Quality**, which opens the **Sales record review** screen.

1. Choose the **Date** you have reviewed.
2. Select a specific **Product**, or **All products** for a store-wide condition.
3. Under **What happened?**, choose the option that describes the day.
4. Add a **Note (optional)**, such as the record you checked or why the store was closed.
5. Choose **Save review** and check **Reviewed dates**.

| What happened?                | When to use it                                                              |
| ----------------------------- | --------------------------------------------------------------------------- |
| No sales (confirmed)          | You checked that records are complete and the product had no sales that day |
| Store closed                  | The store did not operate that day                                          |
| Out of stock all day          | The product was unavailable for the entire selling period                   |
| Out of stock part of the day  | The product was unavailable for part of the selling period                  |
| Missing or incomplete records | You cannot verify a complete sales record for that day                      |

An absent sale is not automatically a confirmed zero. Confirmed zero days can contribute to forecasting history; closures, stockouts, and incomplete dates are excluded from demand targets. A product-specific review takes precedence over an All products review for that product and date.

To correct a review, select the same date and product, choose the correct option, and save again. Use **Remove** beside a reviewed date to withdraw it. **Export change history** downloads a CSV file of saved changes and removals. Changes are used in the next forecast refresh.

## Manage your account and staff

**Where:** **Inventory > Account & settings** for owners, or **Inventory > Account** for staff.

### Check your account or change your password

1. Read **Your account** to check your email, role, and Business ID.
2. Under **Account maintenance**, enter **Current password** and **New password**. The new password must contain 12 to 128 characters.
3. Choose **Change password**, then sign in again. Changing a password ends that account's active sessions and invalidates its earlier recovery links.

Use **Forgot password** on the sign-in screen if you cannot sign in. Recovery emails require the installation's email service. **Connect Google account** is available in Your account when Google sign-in has been enabled; connecting preserves your current store and role.

### Invite staff to this store

**Who can do this:** owner only.

1. Find **Account maintenance > Invite staff**.
2. Enter **Staff name** and **Staff email**, then choose **Send staff invitation**.
3. Ask the staff member to open the email, follow the invitation link, and set their own password.
4. Review **Staff access** and use **Refresh staff list** to check the latest accounts.

Staff should use the invitation to join this store. Choosing Create account instead creates a separate owner store. Email invitations must point to a website the recipient can open. If email delivery is not configured, ask the person managing the installation to enable it.

Use **Disable** to stop a staff member's access; it also ends their active sessions. Use **Restore** to enable them again. If the staff list fails to load, choose **Retry loading staff**.

### Change store and forecast settings

**Who can do this:** owner only.

1. Find the **Store & model settings** card in Account & settings.
2. Review the store name, location, forecast horizon, and cover days after delivery. You can type a whole number of cover days (zero or more), or choose a suggested value.
3. Find **Advanced forecasting settings** if you need the Moving Average window or ML product limit. Moving Average offers **3, 7, 14, 28, and 30 days**.
4. Choose **Save settings** and review a later completed forecast refresh.

The ML product limit is a maximum; increasing it does not make products with insufficient history eligible. Keep product lead times and safety stock accurate in **Products**.

### Which devices share records?

People using the same running StockCast website and the same store share its saved business records. Different owner stores remain separate. Independent laptop installations have their own databases; copying the application files does not copy another laptop's saved records.

**Test records** identifies a store using demonstration data. Renaming that store does not turn its records into client evidence. Choose the appropriate record type when creating a store and use only authorized real business records for actual business work.

## Complete the evaluation form

**Who can do this:** a signed-in owner or staff member after using the features being rated.

**Where:** **Strategies > Evaluation**.

1. Rate the statements based on your actual experience. Choose from **Strongly disagree** to **Strongly agree**, or **Not applicable** for a feature you have not used.
2. Choose **Save draft** if you want to continue later in this browser and account.
3. Review your answers before choosing **Submit**. A final submission cannot be edited, and each account can submit once per questionnaire version.
4. Wait for **Final submission saved to the server**, then check the submitted feedback below.
5. Use **Refresh submitted feedback** to read the saved result again. Owners can choose **Download submitted CSV** for the store's submissions.

Save draft stores answers only in this browser; it does not submit feedback. Staff can view their own submission; owners can view their store's summaries. Unanswered and Not applicable items are excluded from rating averages. Feedback from demonstration records is labelled **Test feedback**. The browser-only demonstration can save drafts but cannot submit a final server record.

## Get help with a problem

| What you see                                              | What to check or do next                                                                                                                                                |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Failed to fetch, or the website cannot load               | Check your connection and reload once. If it continues, contact the person managing the installation. Previously displayed values may remain visible while a read fails |
| A session or sign-in error                                | Sign in again using the same website address                                                                                                                            |
| A product is missing                                      | Search Products and ask the owner to check the Inactive or All products filter                                                                                          |
| No products are available in a recording form             | Ask the owner to add or activate the product                                                                                                                            |
| A management button is missing                            | Check Your account; the action may require the owner role                                                                                                               |
| Sale or write-off exceeds stock                           | Verify the physical count and check whether a delivery is still unrecorded                                                                                              |
| CSV rows are rejected                                     | Read the row messages; check dates, SKUs, quantities, and source-key conflicts before retrying                                                                          |
| Sales table shows fewer rows than the total               | It displays 40 rows per page; use Previous/Next or Export sales CSV to get all saved records                                                                            |
| Past sales imported, but stock did not change             | This is expected: importing history preserves current stock                                                                                                             |
| New sales or classifications are absent from the forecast | Review the next completed refresh or ask the owner to refresh earlier                                                                                                   |
| No XGBoost result or 0 ML SKUs                            | Read the product's history and eligibility explanation in Forecasts                                                                                                     |
| Forecast remains queued or fails                          | Tell the owner the status and time; the person managing the installation can check processing                                                                           |
| Invitation or recovery email is unavailable               | Ask the person managing the installation to check email delivery; verify the recipient address                                                                          |

If a save reports an error, do not assume it succeeded. Check the relevant ledger or saved record before repeating a transaction. Report the screen, action, exact message, and approximate time to the owner. Avoid including passwords or private customer records in a support screenshot.

## Understand common terms

| Term             | Meaning                                                                      |
| ---------------- | ---------------------------------------------------------------------------- |
| SKU              | A product's catalog code                                                     |
| On hand          | The current recorded stock quantity                                          |
| Lead time        | Days between ordering and receiving goods                                    |
| Safety stock     | Extra stock kept as a buffer                                                 |
| Reorder point    | Stock level used to trigger a replenishment suggestion                       |
| Days of cover    | Estimated time that stock can meet the current demand estimate               |
| Forecast horizon | Number of future days predicted after usable history                         |
| Moving Average   | A demand estimate based on recent usable daily sales                         |
| XGBoost          | The machine-learning method used for eligible products                       |
| Ensemble         | A weighted combination of Moving Average and XGBoost                         |
| Audit trail      | Saved evidence of a record or stock change                                   |
| MAE / RMSE       | Error measures on evaluated sales; lower values mean smaller measured errors |
