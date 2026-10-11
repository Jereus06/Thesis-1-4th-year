import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, statSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cpus, release, totalmem } from "node:os";
import { launchEdge } from "./benchmark-browser.mjs";
import ts from "typescript";

// Isolated synthetic browser interaction. Never reads credentials or resets user data.
const base = process.argv[2] ?? "http://127.0.0.1:5174";
const phase = process.argv[3] ?? "after";
const mode = process.argv[4] ?? "demo";
const performanceOnly = process.argv.includes("--performance-only");
const salesOnly = process.argv.includes("--sales-only");
const normalTyping = process.argv.includes("--normal-typing");
const artifacts = `benchmarks/csv/${phase}-${new URL(base).port}${salesOnly ? "-diagnostic" : normalTyping ? "-normal-typing" : ""}`;
mkdirSync(artifacts, { recursive: true });
const salesCsv = (n, prefix = "synthetic") =>
  "Date,SKU,Quantity,Source Record Key\r\n" +
  Array.from(
    { length: n },
    (_, i) => `2026-09-${String((i % 28) + 1).padStart(2, "0")},SYN-001,1.250,${prefix}-${i}`,
  ).join("\r\n");
const inventoryCsv = (n) =>
  "SKU,Product,Category,Unit,On Hand,Lead Time,Safety Stock,Unit Cost\r\n" +
  Array.from(
    { length: n },
    (_, i) =>
      `SYN-${String(i + 1).padStart(3, "0")},Synthetic product ${i + 1},Synthetic,unit,25,3,2,1.2500`,
  ).join("\r\n");
const fixtures = {};
function fixture(name, contents) {
  const path = resolve(artifacts, name);
  writeFileSync(path, contents);
  fixtures[name] = path;
  return path;
}
fixture("tiny.csv", salesCsv(2, "tiny"));
fixture("large.csv", salesCsv(100_000, "large"));
fixture("100001.csv", salesCsv(100_001, "over-limit"));
fixture("73100.csv", salesCsv(73_100, "oversize"));
fixture("inventory.csv", inventoryCsv(2));
fixture("inventory-large.csv", inventoryCsv(5_000));
fixture("inventory-oversize.csv", inventoryCsv(73_100));
fixture("bad-header.csv", "Date,SKU,Unsupported\n2026-09-01,SYN-001,2");
fixture("huge-header.csv", `Date,SKU,Quantity,${"X".repeat(2_000_000)}\n2026-09-01,SYN-001,2,key`);
fixture("bad-date.csv", "Date,SKU,Quantity\n2026-02-30,SYN-001,2");
fixture("invalid-utf8.csv", Buffer.from([0x44, 0x61, 0x74, 0x65, 0x2c, 0xff]));
fixture(
  "utf16le.csv",
  Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(salesCsv(2, "le"), "utf16le")]),
);
const be = Buffer.from(salesCsv(2, "be"), "utf16le");
be.swap16();
fixture("utf16be.csv", Buffer.concat([Buffer.from([0xfe, 0xff]), be]));
fixture(
  "quoted.csv",
  'sep=;\r\nDate;SKU;Quantity;Source Record Key\r\n2026-09-01;SYN-001;2;"comma, and\r\nnewline ""key"""\r\n',
);
const control = (text) =>
  `[...document.querySelectorAll('button')].find(e => e.textContent.trim() === ${JSON.stringify(text)} && e.getBoundingClientRect().height)`;
const tab = (text) =>
  `[...document.querySelectorAll('[role=tab]')].find(e => e.textContent.trim() === ${JSON.stringify(text)})`;
const report = {
  measuredAt: new Date().toISOString(),
  base,
  phase,
  mode,
  provenance:
    "Isolated generated synthetic data; headless Microsoft Edge via real file selection and input events. No existing user browser profile, environment, or database touched.",
  host: { release: release(), cpu: cpus()[0]?.model, cpus: cpus().length, ram: totalmem() },
  samples: [],
  checks: [],
  requests: [],
};
const edge = await launchEdge({
  executable: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  artifactsDirectory: artifacts,
});
report.software = { ...edge.software, node: process.version };
const page = edge.page;
await page.send("Performance.enable");
report.browserErrors = [];
report.workerNetwork = [];
report.documentNavigations = [];
page.on("Page.frameNavigated", ({ frame }) => {
  if (!frame.parentId) report.documentNavigations.push({ url: frame.url, at: Date.now() });
});
page.on("Network.responseReceived", (e) => {
  if (/csv-import.worker/.test(e.response.url))
    report.workerNetwork.push({ url: e.response.url, status: e.response.status });
});
page.on("Runtime.exceptionThrown", (e) =>
  report.browserErrors.push(e.exceptionDetails?.exception?.description ?? e.exceptionDetails?.text),
);
page.on("Runtime.consoleAPICalled", (e) => {
  if (e.type === "error")
    report.browserErrors.push(e.args.map((x) => x.value ?? x.description).join(" "));
});
let pendingImport = null;
if (mode === "api-mock") {
  // Only transport-contract checks: isolated request interception is explicitly not PostgreSQL evidence.
  await page.send("Fetch.enable", { patterns: [{ urlPattern: "*api/v1/*" }] });
  const products = [];
  const sales = [];
  const seen = new Map();
  const session = {
    businessId: "00000000-0000-4000-8000-000000009991",
    userId: "synthetic-owner",
    role: "owner",
    displayName: "Synthetic owner",
    email: "synthetic@example.invalid",
  };
  page.on("Fetch.requestPaused", async (event) => {
    try {
      const path = new URL(event.request.url).pathname;
      let data = null;
      if (path.endsWith("/auth/me")) data = session;
      else if (path.endsWith("/inventory-imports")) {
        const rows = JSON.parse(event.request.postData).rows;
        assert.ok(rows.length <= 5_000);
        report.requests.push({ kind: "inventory", rows: rows.length });
        for (const row of rows) {
          const old = products.find((p) => p.sku === row.sku);
          if (old) Object.assign(old, row);
          else products.push({ ...row, id: "p-" + row.sku, isActive: true });
        }
        data = { created: rows.length, updated: 0 };
      } else if (path.endsWith("/data-imports")) {
        const rows = JSON.parse(event.request.postData).rows;
        assert.ok(rows.length <= 100_000);
        report.requests.push({
          kind: "sales",
          rows: rows.length,
          firstKey: rows[0]?.sourceRecordKey,
          lastKey: rows.at(-1)?.sourceRecordKey,
        });
        const errors = [];
        rows.forEach((row, i) => {
          if (seen.has(row.sourceRecordKey))
            errors.push({ row: i + 1, code: "duplicate_source_record_key" });
          else {
            seen.set(row.sourceRecordKey, row);
            sales.push({
              id: "s-" + sales.length,
              productId: products.find((p) => p.sku === row.sku).id,
              saleDate: row.saleDate,
              quantity: row.quantity,
            });
          }
        });
        data = { acceptedRows: rows.length - errors.length, rejectedRows: errors.length, errors };
        pendingImport = data;
      } else if (path.endsWith("/products")) data = products;
      else if (path.endsWith("/sales")) {
        const url = new URL(event.request.url);
        data = sales.slice(
          Number(url.searchParams.get("offset") ?? 0),
          Number(url.searchParams.get("offset") ?? 0) + 200,
        );
      } else if (path.endsWith("/settings"))
        data = {
          movingAverageWindow: 7,
          forecastHorizonDays: 14,
          targetCoverDays: 14,
          minimumHistoryWeeks: 8,
          minimumNonzeroDays: 100,
          topNProducts: 10,
          cvFolds: 3,
          timezone: "Asia/Manila",
        };
      else if (path.endsWith("/forecast-dashboard"))
        data = {
          stale: true,
          run: null,
          latestRun: null,
          recommendations: [],
          predictions: [],
          metrics: [],
          summaries: {},
          businessDay: "2026-10-06",
          businessTimezone: "Asia/Manila",
          message: "Synthetic request fixture",
        };
      else data = { name: "Synthetic CSV verification", location: "", dataOrigin: "demo" };
      await page.send("Fetch.fulfillRequest", {
        requestId: event.requestId,
        responseCode: 200,
        responseHeaders: [{ name: "content-type", value: "application/json" }],
        body: Buffer.from(JSON.stringify({ data })).toString("base64"),
      });
    } catch (error) {
      report.requestError = error.message;
      await page.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "Failed" });
    }
  });
}
await page.send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  window.__csvMetrics={reads:[],decodes:[],textareaWrites:[],sorts:[],longTasks:[],frames:[]};
  const metrics=window.__csvMetrics;
  const read=Blob.prototype.arrayBuffer; Blob.prototype.arrayBuffer=async function(){const start=performance.now();const result=await read.call(this);metrics.reads.push({bytes:this.size,ms:performance.now()-start});return result;};
  const decode=TextDecoder.prototype.decode; TextDecoder.prototype.decode=function(...args){const start=performance.now();const result=decode.apply(this,args);metrics.decodes.push({ms:performance.now()-start,characters:result.length});return result;};
  const descriptor=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value');
  Object.defineProperty(HTMLTextAreaElement.prototype,'value',{...descriptor,set(value){const start=performance.now();descriptor.set.call(this,value);metrics.textareaWrites.push({ms:performance.now()-start,characters:value.length});}});
  const sort=Array.prototype.sort;Array.prototype.sort=function(...args){const start=performance.now();const result=sort.apply(this,args);if(this.length>=1000)metrics.sorts.push({rows:this.length,ms:performance.now()-start});return result;};
  new PerformanceObserver(list=>{for(const e of list.getEntries())if(e.startTime>=window.__csvStart)metrics.longTasks.push({start:e.startTime,ms:e.duration});}).observe({entryTypes:['longtask']});
  window.__csvLastFrame=performance.now();function frame(now){if(now>=window.__csvLastFrame){metrics.frames.push(now-window.__csvLastFrame);window.__csvLastFrame=now;}requestAnimationFrame(frame);}requestAnimationFrame(frame);
  ${
    mode === "demo"
      ? `localStorage.setItem('stockcast-v5',JSON.stringify({version:5,state:{products:Array.from({length:200},(_,i)=>({id:'p-'+(i+1),sku:'SYN-'+String(i+1).padStart(3,'0'),name:'Synthetic product '+(i+1),category:'Synthetic',unit:'unit',currentStock:25,leadTimeDays:3,safetyStock:2,unitCost:1.25,isActive:true})),sales:Array.from({length:73100},(_,i)=>({id:'history-'+i,productId:'p-1',date:'2026-09-'+String(i%28+1).padStart(2,'0'),qty:1}))}}));
  // Memory-only import stress workload avoids profile quota limiting synthetic test sizes.
  const store=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key!=='stockcast-v5')store.call(this,key,value);};`
      : ""
  }
`,
});
async function resetMetrics() {
  await page.evaluate(
    `for (const key of Object.keys(window.__csvMetrics)) window.__csvMetrics[key]=[]; for(const e of performance.getEntriesByType('measure'))if(e.name.startsWith('csv-'))performance.clearMeasures(e.name); window.__csvStart=performance.now();window.__csvLastFrame=window.__csvStart`,
  );
}
async function selectFile(name) {
  const { root } = await page.send("DOM.getDocument");
  const { nodeId } = await page.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: "input[type=file]",
  });
  assert.ok(nodeId, "file control exists");
  await page.send("DOM.setFileInputFiles", { nodeId, files: [fixtures[name]] });
}
async function measureFile(name, label) {
  const countersBefore = Object.fromEntries(
    (await page.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]),
  );
  await resetMetrics();
  await selectFile(name);
  if (phase === "before")
    await page.waitFor(
      `window.__csvMetrics.textareaWrites.some(w=>w.characters===${statSync(fixtures[name]).size})`,
      label,
      240_000,
    );
  else
    await page.waitFor(
      `performance.getEntriesByName('csv-worker-total').length && (document.querySelector('[data-csv-state="ready"]') || document.querySelector('[data-csv-state="error"]'))`,
      label,
      120_000,
    );
  // Includes two frames of preview/textarea layout; phases recorded separately below.
  await page.evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
  const sample = await page.evaluate(
    `({elapsedMs:performance.now()-window.__csvStart,metrics:window.__csvMetrics,text:document.querySelector('main')?.innerText.slice(-7000),previewRows:document.querySelectorAll('table[aria-label="Uploaded CSV preview"] tbody tr').length,textareaCharacters:document.querySelector('textarea')?.value.length ?? 0,workerTimings:performance.getEntriesByType('measure').filter(e=>e.name.startsWith('csv-')).map(e=>({name:e.name,ms:e.duration}))})`,
  );
  const countersAfter = Object.fromEntries(
    (await page.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]),
  );
  sample.mainThread = Object.fromEntries(
    ["LayoutDuration", "RecalcStyleDuration", "ScriptDuration", "TaskDuration"].map((name) => [
      name + "Ms",
      (countersAfter[name] - countersBefore[name]) * 1000,
    ]),
  );
  sample.metrics.maxFrameGapMs = Math.max(0, ...sample.metrics.frames);
  delete sample.metrics.frames;
  report.samples.push({ name, label, ...sample });
  console.log(
    `${phase} ${label}: ${sample.elapsedMs.toFixed(1)} ms, max frame ${sample.metrics.maxFrameGapMs.toFixed(1)} ms`,
  );
  return sample;
}
try {
  await page.send("Page.navigate", { url: base + "/inventory" });
  await page.waitFor(
    `document.querySelector(${JSON.stringify('input[aria-label="Search inventory products"]')})`,
    "inventory",
    120_000,
  );
  await page.click(control("Import inventory CSV")).catch(async () => {
    const names = await page.evaluate(
      `[...document.querySelectorAll('button')].map(e=>e.textContent.trim())`,
    );
    const name = names.find((x) => /Import.*inventory|Import CSV/.test(x));
    await page.click(control(name));
  });
  await measureFile("inventory.csv", "tiny inventory selection");
  if (phase === "after" && mode === "api-mock") {
    await page.click(control("Upload CSV"));
    await page.waitFor(`!document.querySelector('input[type=file]')`, "inventory accepted");
    await page.click(control("Import inventory"));
  }
  if (!salesOnly) await measureFile("inventory-oversize.csv", "73100 inventory selection");
  if (normalTyping) {
    await selectFile("inventory-oversize.csv");
    await page.waitFor(
      `document.querySelector('[data-csv-state="preparing"]')`,
      "normal-speed preparation",
    );
    await resetMetrics();
    const typingStarted = performance.now();
    await page.type('input[aria-label="Search inventory products"]', "Synthetic");
    assert.equal(
      await page.evaluate(`document.querySelector('input[type=search]').value`),
      "Synthetic",
    );
    const elapsedMs = performance.now() - typingStarted;
    const metrics = await page.evaluate(`window.__csvMetrics`);
    assert.ok(elapsedMs < 1500, `normal-speed search took ${elapsedMs.toFixed(1)} ms`);
    report.checks.push({
      name: "normal-speed typing during file preparation",
      passed: true,
      elapsedMs,
      cpuThrottle: 1,
      maximumAllowedMs: 1500,
      maxFrameGapMs: Math.max(0, ...metrics.frames),
      longTasks: metrics.longTasks,
    });
    await page.click(control("Close import"));
  }
  await page.click(tab("Sales ledger"));
  await measureFile("tiny.csv", "tiny sales selection");
  await measureFile("73100.csv", "73100 sales selection");
  if (phase === "before") {
    const parserSource = ts.transpileModule(
      readFileSync("benchmarks/csv/baseline-source/src/lib/import-csv.ts", "utf8"),
      { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
    ).outputText;
    const parserUrl = "data:text/javascript;base64," + Buffer.from(parserSource).toString("base64");
    report.parserBaseline = await page.evaluate(
      `(async()=>{const parser=await import(${JSON.stringify(parserUrl)});const products=Array.from({length:200},(_,i)=>({id:'p-'+(i+1),sku:'SYN-'+String(i+1).padStart(3,'0'),name:'Synthetic product '+(i+1)}));const text=document.querySelector('textarea').value;const start=performance.now();const records=parser.parseCsvRecords(text);const parsed=performance.now();const rows=parser.parseSalesCsv(text,products);const ended=performance.now();return {thread:'main',scope:'parse-only diagnostic then complete original Import parser; parseAndValidate includes parsing',records:records.length,rows:rows.length,parseOnlyMs:parsed-start,parseAndValidateMs:ended-parsed};})()`,
    );
  } else if (!performanceOnly) {
    report.checks.push({
      name: "bounded 73100 preview",
      passed:
        report.samples.at(-1).previewRows <= 50 && report.samples.at(-1).textareaCharacters === 0,
    });
    if (mode === "api-mock") {
      assert.equal(await page.evaluate(`${control(phase === "before" ? "Import rows" : "Upload CSV")}?.disabled`), false);
      report.checks.push({ name: "73100 sales rows within the new limit", passed: true });
      await measureFile("100001.csv", "100001 sales limit selection");
      assert.match(report.samples.at(-1).text, /100,000|100000/);
      assert.equal(await page.evaluate(`${control(phase === "before" ? "Import rows" : "Upload CSV")}?.disabled`), true);
      report.checks.push({ name: "oversize submission prevented", passed: true });
    }
    for (const name of ["bad-header.csv", "huge-header.csv", "bad-date.csv", "invalid-utf8.csv"]) {
      const s = await measureFile(name, name);
      assert.match(s.text, /CSV record|Could not read|Unsupported/i);
      if (name === "huge-header.csv") {
        assert.ok(
          (await page.evaluate(`document.querySelector('[role=alert]')?.textContent.length`)) <
            1000,
          "malformed values remain bounded in the displayed error",
        );
      }
    }
    for (const name of ["utf16le.csv", "utf16be.csv", "quoted.csv"]) {
      await measureFile(name, name);
      assert.equal(await page.evaluate(`${control(phase === "before" ? "Import rows" : "Upload CSV")}?.disabled`), false);
    }
    await resetMetrics();
    await selectFile("73100.csv");
    await selectFile("tiny.csv");
    await page.waitFor(`document.querySelector('[data-csv-state="ready"]')`, "latest selection");
    assert.match(await page.evaluate(`document.querySelector('main').innerText`), /tiny\.csv/);
    report.checks.push({ name: "rapid reselection latest file wins", passed: true });
    await page.click(control(phase === "before" ? "Import rows" : "Upload CSV"));
    await page.waitFor(
      `document.body.innerText.includes('Imported 2 sales rows') && document.querySelector('[data-csv-state="idle"]')`,
      "tiny file accepted",
    );
    report.checks.push({ name: "tiny uploaded sales file imported", passed: true });
    // Throttling makes cancellation/navigation overlap a running worker reproducibly.
    await page.send("Emulation.setCPUThrottlingRate", { rate: 6 });
    await selectFile("inventory-oversize.csv");
    await page.click(control("Cancel preparation"));
    assert.match(
      await page.evaluate(`document.querySelector('main').innerText`),
      /Cancelled|cancelled/,
    );
    await page.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    report.checks.push({ name: "cancel running preparation", passed: true });
    await page.click(control("Paste CSV"));
    await page.type("textarea", salesCsv(2, "paste"));
    await page.waitFor(`document.querySelector('[data-csv-state="ready"]')`, "paste ready");
    await page.click(control(phase === "before" ? "Import rows" : "Upload CSV"));
    await page.waitFor(
      `document.body.innerText.includes('Imported 2 sales rows') && document.querySelector('[data-csv-state="idle"]') && document.querySelector('textarea')?.value === ''`,
      "paste import",
    );
    report.checks.push({ name: "manual paste imported", passed: true });
    // The persistent file input switches back from paste mode when a file is selected.
    await measureFile("large.csv", "100000 accepted sales selection");
    await page.click(control(phase === "before" ? "Import rows" : "Upload CSV"));
    await page.waitFor(
      `document.body.innerText.includes('Imported 100000 sales rows') || document.body.innerText.includes('Imported 100,000 sales rows')`,
      "all accepted rows imported",
      120_000,
    );
    await selectFile("large.csv");
    await page.waitFor(`document.querySelector('[data-csv-state="ready"]')`, "retry ready");
    await page.click(control(phase === "before" ? "Import rows" : "Upload CSV"));
    await page.waitFor(
      `document.body.innerText.includes('already imported rows skipped')`,
      "retry skips duplicates",
      120_000,
    );
    report.checks.push({
      name: "100000 rows imported beyond preview and retry skips duplicates",
      passed: true,
    });
    if (mode === "api-mock") {
      assert.deepEqual(
        report.requests.filter((x) => x.kind === "sales").map((x) => x.rows),
        [2, 2, 100000, 100000],
      );
      assert.equal(pendingImport.acceptedRows, 0);
    }
    await page.send("Emulation.setCPUThrottlingRate", { rate: 6 });
    await selectFile("73100.csv");
    await page.evaluate(
      `document.querySelector('main').scrollTop=0;document.scrollingElement.scrollTop=0`,
    );
    const responsivenessStarted = performance.now();
    await page.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: 1000,
      y: 600,
      deltaX: 0,
      deltaY: 450,
    });
    await page.waitFor(
      `document.querySelector('[data-csv-state="preparing"]')`,
      "preparing while scrolling",
    );
    const scroll = await page.evaluate(
      `({window:document.scrollingElement.scrollTop,main:document.querySelector('main').scrollTop})`,
    );
    assert.ok(
      scroll.window > 0 || scroll.main > 0,
      "wheel scroll moved the page during preparation",
    );
    report.checks.push({
      name: "scroll dispatch and status remain responsive during preparation",
      passed: true,
      elapsedMs: performance.now() - responsivenessStarted,
      scroll,
    });
    await page.click(tab("Products"));
    await page.click(control("Import inventory"));
    await page.waitFor(
      `document.querySelector('input[type=file]')`,
      "inventory file control mounted",
    );
    await selectFile("inventory-oversize.csv");
    await page.waitFor(
      `document.querySelector('[data-csv-state="preparing"]')`,
      "inventory preparing before typing",
    );
    await resetMetrics();
    const typingStarted = performance.now();
    await page.type('input[aria-label="Search inventory products"]', "Synthetic");
    assert.equal(
      await page.evaluate(`document.querySelector('input[type=search]').value`),
      "Synthetic",
    );
    const typingElapsedMs = performance.now() - typingStarted;
    const typingMetrics = await page.evaluate(`window.__csvMetrics`);
    assert.ok(
      typingElapsedMs < 3000,
      `product search took ${typingElapsedMs.toFixed(1)} ms at 6x CPU throttle`,
    );
    report.checks.push({
      name: "typing in product search during file preparation",
      passed: true,
      elapsedMs: typingElapsedMs,
      cpuThrottle: 6,
      maximumAllowedMs: 3000,
      maxFrameGapMs: Math.max(0, ...typingMetrics.frames),
      longTasks: typingMetrics.longTasks,
    });
    await page.click(control("Close import"));
    await page.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await page.click(tab("Sales ledger"));
    assert.equal(
      await page.evaluate(
        `document.querySelectorAll('table[aria-label="Uploaded CSV preview"] tbody tr').length`,
      ),
      0,
    );
    report.checks.push({
      name: "navigate/unmount during preparation and type in search",
      passed: true,
    });
    report.workerResources = await page.evaluate(
      `performance.getEntriesByType('resource').filter(e=>/csv.*worker|worker.*csv/.test(e.name)).map(e=>({name:e.name}))`,
    );
  }
  const shot = await page.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(resolve(artifacts, "final.png"), Buffer.from(shot.data, "base64"));
  report.outcome = "passed";
} catch (error) {
  report.outcome = "failed";
  report.failure = error.stack;
  report.failureMetrics = await page.evaluate("window.__csvMetrics").catch(() => null);
  report.failureDocument = await page
    .evaluate(
      `({url:location.href,readyState:document.readyState,html:document.documentElement.outerHTML.slice(0,4000)})`,
    )
    .catch(() => null);
  report.failurePage = await page.evaluate(`document.body.innerText`).catch(() => "unavailable");
  console.error(error);
  console.error(report.browserErrors);
  console.error(report.failurePage?.slice(0, 2000));
} finally {
  writeFileSync(resolve(artifacts, "report.json"), JSON.stringify(report, null, 2));
  await edge.close();
}
if (report.outcome !== "passed") process.exitCode = 1;
