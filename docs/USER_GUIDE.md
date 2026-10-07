# How to use StockCast

Use this guide to find a screen, record a transaction, and check your saved records. Choose a common task or search for words such as **sale**, **delivery**, **return**, or **staff**. Each task tells you where to go, what to enter, and what happens after saving.

## Getting started

### Your first visit

1. Open the StockCast website address given to you by the store owner or the person who manages the installation.
2. Sign in with your own email and password. If you were invited as staff, open the invitation email and finish setting your password first.
3. Read the store name in the sidebar to check that you are using the correct store.
4. Open **Inventory > Account & settings > Your account** to check your role. Staff see **Inventory > Account** instead.

**Create account** is for someone creating a separate store as its owner. It does not join an existing owner's store. Staff should use the owner's invitation.

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

| If you want to... | Open this screen |
| --- | --- |
| See a summary of the store | **Overview** |
| Find products that may need more stock | **Restock** |
| View a product's demand chart and forecast information | **Forecasts** |
| Add, find, or edit a product | **Inventory > Products** |
| Record an incoming delivery or check current stock | **Inventory > Products** |
| View sales, import past sales, or download sales records | **Inventory > Sales ledger** |
| Record returns or write-offs and inspect stock changes | **Inventory > Stock movements** |
| Check your account or change your password | **Inventory > Account & settings**; staff use **Account** |
| Invite staff or change store settings | **Inventory > Account & settings**, as the owner |
| Review zero-sale days, closures, missing records, or stockouts | **Quality** |
| Read help, methodology, or supporting thesis text | **Strategies** |
| Give feedback after using the system | **Strategies > Evaluation** |

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

If there are no active products, ask the owner to add or activate one. If the quantity exceeds the available stock, check the physical count and any unrecorded delivery before saving. The current sales table does not offer an edit, delete, or void button; ask the owner how to handle a mistaken sale.

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

## Import current inventory

**Who can do this:** owner only.

**Where:** **Inventory > Products > Import inventory**.

Use an inventory file to add your catalog and establish or correct current counts. Prepare these columns in your spreadsheet and save it as CSV:

| Column | What to enter |
| --- | --- |
| SKU | A unique product code |
| Product | Product name |
| Category | Product group |
| Unit | Counting unit, such as pack or pc |
| On Hand | Actual current stock, zero or higher |
| Lead Time | Whole number of supplier lead-time days |
| Safety Stock | Buffer quantity, zero or higher |
| Unit Cost | Cost per counting unit in PHP |

1. Choose **Import inventory** to open the importer.
2. Choose **Uploaded file > Upload CSV file**, or **Paste CSV** to enter prepared CSV text.
3. Wait for preparation. Review product names, units, quantities, and any row errors.
4. Choose **Import inventory** inside the importer to save the prepared records.
5. Wait for confirmation, then check **Products** and **Stock movements**.

Selecting a file or viewing its preview does not save it. The preview shows at most the first 50 CSV records; the full prepared file is used for import. Use **Cancel preparation** to stop, or **Prepare again** to retry. To change uploaded data, edit the source file and select it again.

**What changes:** matching SKUs update product details and replace current counts with audited corrections. New SKUs create products. Matching inactive products are reactivated, and products absent from the file remain saved. A rejected inventory row prevents the whole snapshot from saving.

Use a decimal point for numbers. Stock and safety quantities allow up to three decimal places; unit cost allows four. The maximum is **5,000 inventory data rows per import**. This is a current inventory snapshot, not a delivery list or sales file.

## Import past sales

**Who can do this:** owner only.

**Where:** **Inventory > Sales ledger > Import CSV**.

Create or import the products first. Prepare these columns and save the spreadsheet as CSV:

| Column | What to enter |
| --- | --- |
| Date | Sale date in **YYYY-MM-DD** format, such as **2026-09-01** |
| Product | An existing SKU; an unambiguous product name or internal product ID also works |
| Quantity | Positive sold quantity in that product's unit |
| Source Record Key, optional | A stable unique identifier for one sale line |

1. Open **Sales ledger** and locate **Import CSV**.
2. Choose **Uploaded file > Upload CSV file**, or **Paste CSV**.
3. Wait for preparation and check that the product matches and dates are correct.
4. Choose **Import rows**.
5. Read the imported, already-imported, and rejected counts. Check the Sales ledger and use **Export sales CSV** if you need all saved rows.

**What changes:** past sales are added to demand history. They do not reduce current stock or create a delivery. This is appropriate for older transactions already reflected in your current physical count.

Use a decimal point and up to three decimal places for quantities. The maximum is **100,000 sales data rows per import**. The preview is limited to the first 50 CSV records; it does not limit the import to 50 rows.

### Fix an import problem

- If a product is unknown or ambiguous, check its SKU in **Products** and correct the source file.
- If a date is rejected, use **YYYY-MM-DD**. Do not assume an ambiguous day/month format will be converted.
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

The table displays the latest **40 records**, so its visible row count can be smaller than the total. It has no search or date filter. The export contains all saved sales, including rows beyond the displayed 40. Its extra export columns need mapping before reuse as an import file.

### Stock movement ledger

1. Open **Inventory > Stock movements**.
2. Search by product, date, note, or recorded user ID, or choose a movement-type filter.
3. Use the page controls to browse results and expand audit details for a record.
4. Choose **Refresh** to load the latest movements, including changes made by another user.
5. Choose **Export CSV** to download the movement records. **Export stock movements** in Products provides the same kind of stock audit download.

Positive changes add stock; negative changes subtract it. **Saved balance** is the balance immediately after that movement, not necessarily today's stock. Historical sales imports do not have a matching stock deduction.

Exports are useful copies of business records. Ask the person managing the installation to maintain database backups as well.

## Read and refresh forecasts

**Who can view:** owner or staff. **Who can manually refresh:** owner only.

**Where:** **Forecasts**.

1. Check the forecast status, notices, and displayed dates.
2. Choose a product in the product selector.
3. Read its selected method, daily demand, chart, and any history or data-quality explanation.
4. Hover over the chart to inspect a date's available actual sales and predictions.
5. Review the error and prediction-interval evidence when available. **Copy MAE / RMSE table** copies the displayed model comparison for a spreadsheet.

XGBoost requires sufficient usable training history and an eligible place within the configured ML product limit. A product can use Moving Average when those requirements are not met. **0 ML SKUs** means none currently qualifies for machine learning; it does not mean your products or recorded sales disappeared.

### Update after records change

1. As the owner, save the new records or reviewed dates first.
2. Open **Forecasts** and choose **Refresh forecasts** once.
3. Wait while the run is queued or processing. You can continue using other screens.
4. Review the completed result, product dates, and any remaining warnings.

The automatic refresh schedule is displayed on Overview, Restock, and Forecasts when available. The normal default is **00:15 in the store's timezone**. It uses history through the preceding completed business day and requires the installation to remain running. Staff can record daily activity without manually starting training.

### Understand the notices

| Notice | What to do |
| --- | --- |
| Queued or processing | Wait for the result; avoid repeated refresh requests |
| Stale | Records or settings changed; review the next completed refresh |
| Expired | Update recent sales or verified zero-sale dates, then ask the owner to refresh |
| Unavailable or an em dash | Read the reason; a value was not available, rather than measured as zero |
| Moving Average fallback | Check the product's history and quality notes; it may not qualify for XGBoost |
| Low confidence | Treat the estimate as decision support and check the underlying records |

Check forecast dates before using them for today's purchasing. Unknown or excluded dates do not move old predictions forward. MAE and RMSE describe error on evaluated records, not a guaranteed accuracy percentage. Available prediction intervals show an estimated range, not a guarantee of future demand.

## Use restock recommendations

**Who can do this:** owner or staff can view and record deliveries.

**Where:** **Restock**; a summary is also shown in **Overview**.

1. Review the **Order now** products and any warnings about unavailable or older demand.
2. Check **On hand**, **Daily demand**, **Reorder point**, **Days of cover**, and **Recommended qty**.
3. Compare the recommendation with the physical count, supplier lead time, and your store's purchasing needs.
4. Arrange the purchase through your normal supplier process.
5. When the goods arrive, choose **Record delivery** and enter the actual received quantity.

The reorder point combines expected demand during supplier lead time with safety stock. A recommendation is purchasing advice; it does not place an order or record a receipt. An em dash in Days of cover means the demand estimate is zero or unavailable. If demand is unavailable, you can still record an actual delivery from **Inventory > Products**.

## Review data quality

**Who can do this:** owner or staff.

**Where:** **Quality**, which opens the **Data quality** screen.

1. Choose the **Date** you have reviewed.
2. Select a specific **Product**, or **All products** for a store-wide condition.
3. Choose the correct **Classification** using the table below.
4. Add the supporting **Evidence / note**, such as a checked ledger, closure date, or correction reason.
5. Choose **Save classification** and check **Reviewed dates**.

| Classification | When to use it |
| --- | --- |
| Confirmed zero sales | You verified that records are complete and the product had no sales that day |
| Business closed | The store did not operate that day |
| Full stockout | The product was unavailable for the entire selling period |
| Partial stockout | The product was unavailable for part of the selling period |
| Missing / incomplete records | You cannot verify a complete sales record for that day |

An absent sale is not automatically a confirmed zero. Confirmed zero days can contribute to forecasting history; closures, stockouts, and incomplete dates are excluded from demand targets. A product-specific review takes precedence over an All products review for that product and date.

To correct a classification, select the same date and product in the form, enter the corrected classification and note, and save again. Use **Remove** beside a reviewed date when its classification should be withdrawn. **Export audit CSV** downloads the create, update, and removal history. Check the next forecast refresh after changing reviewed dates.

## Manage your account and staff

**Where:** **Inventory > Account & settings** for owners, or **Inventory > Account** for staff.

### Check your account or change your password

1. Read **Your account** to check your email, role, and Business ID.
2. Under **Account maintenance**, enter **Current password** and **New password**. The new password must contain 12 to 128 characters.
3. Choose **Change password**, then sign in again. Changing a password ends that account's active sessions.

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
2. Review the store name, location, forecast horizon, and cover days after delivery.
3. Find **Advanced forecasting settings** if you need the Moving Average window or ML product limit.
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

| What you see | What to check or do next |
| --- | --- |
| Failed to fetch, or the website cannot load | Check your connection and reload once. If it continues, contact the person managing the installation. Previously displayed values may remain visible while a read fails |
| A session or sign-in error | Sign in again using the same website address |
| A product is missing | Search Products and ask the owner to check the Inactive or All products filter |
| No products are available in a recording form | Ask the owner to add or activate the product |
| A management button is missing | Check Your account; the action may require the owner role |
| Sale or write-off exceeds stock | Verify the physical count and check whether a delivery is still unrecorded |
| CSV rows are rejected | Read the row messages; check dates, SKUs, quantities, and source-key conflicts before retrying |
| Sales table shows fewer rows than the total | It displays the latest 40; use Export sales CSV to get all saved records |
| Past sales imported, but stock did not change | This is expected: importing history preserves current stock |
| New sales or classifications are absent from the forecast | Review the next completed refresh or ask the owner to refresh earlier |
| No XGBoost result or 0 ML SKUs | Read the product's history and eligibility explanation in Forecasts |
| Forecast remains queued or fails | Tell the owner the status and time; the person managing the installation can check processing |
| Invitation or recovery email is unavailable | Ask the person managing the installation to check email delivery; verify the recipient address |
| Copy MAE / RMSE table is blocked | Check the browser's clipboard permission or copy the displayed values manually |

If a save reports an error, do not assume it succeeded. Check the relevant ledger or saved record before repeating a transaction. Report the screen, action, exact message, and approximate time to the owner. Avoid including passwords or private customer records in a support screenshot.

## Understand common terms

| Term | Meaning |
| --- | --- |
| SKU | A product's catalog code |
| On hand | The current recorded stock quantity |
| Lead time | Days between ordering and receiving goods |
| Safety stock | Extra stock kept as a buffer |
| Reorder point | Stock level used to trigger a replenishment suggestion |
| Days of cover | Estimated time that stock can meet the current demand estimate |
| Forecast horizon | Number of future days predicted after usable history |
| Moving Average | A demand estimate based on recent usable daily sales |
| XGBoost | The machine-learning method used for eligible products |
| Ensemble | A weighted combination of Moving Average and XGBoost |
| Audit trail | Saved evidence of a record or stock change |
| MAE / RMSE | Error measures on evaluated sales; lower values mean smaller measured errors |
