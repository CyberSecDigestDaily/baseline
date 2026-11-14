/* Baseline regression tests: real browser, fixed clock, faked GitHub API. No personal data in here.
   Run from the repo root:  node tests/baseline.test.js
   Needs Playwright with Chromium (npm i -D playwright && npx playwright install chromium).
   BASELINE_FIXTURE=/path/to/data.json runs the same checks against another data file (dates follow its cfg.rampStart). */
"use strict";
const http = require("http"), fs = require("fs"), path = require("path");
let chromium;
try { ({ chromium } = require("playwright")); } catch (e) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || "/opt/npm-tools/node_modules/playwright")); }

const ROOT = path.resolve(__dirname, "..");
const GOOD = "github_pat_" + "T".repeat(40), NOACCESS = "github_pat_" + "N".repeat(40), WRONG = "github_pat_" + "W".repeat(40);
const API = "/repos/CyberSecDigestDaily/baseline-data/contents/";

/* ---------- dates, formatted the way the page formats them ---------- */
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const WEEKDAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const dt = s => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d, 12)); };
const iso = d => d.toISOString().slice(0, 10);
const add = (s, n) => { const d = dt(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const short = s => dt(s).getUTCDate() + " " + MON[dt(s).getUTCMonth()];
const long = s => WEEKDAYS[dt(s).getUTCDay()] + " " + dt(s).getUTCDate() + " " + MONTHS[dt(s).getUTCMonth()];
const range = m => { const a = dt(m), b = dt(add(m, 6));
  return a.getUTCMonth() === b.getUTCMonth() ? a.getUTCDate() + "–" + b.getUTCDate() + " " + MON[b.getUTCMonth()]
    : a.getUTCDate() + " " + MON[a.getUTCMonth()] + " – " + b.getUTCDate() + " " + MON[b.getUTCMonth()]; };

/* ---------- fixture ---------- */
const SYNTH = { v: 1, cfg: { rampStart: "2027-03-01",
  targets: { kcal: 2000, maint: 2300, protein: 150, fibre: 30, sleepMin: 6.5, stepsMin: 5000, waist: 90, vo2: 40 } },
  days: { "2027-02-24": { s: { run: 1 } }, "2027-02-25": { s: { kb: 1 } } }, checkins: {}, markers: {}, health: {}, meta: {} };
const FIX = process.env.BASELINE_FIXTURE ? JSON.parse(fs.readFileSync(process.env.BASELINE_FIXTURE, "utf8")) : SYNTH;
const W1 = FIX.cfg.rampStart, WARM = add(W1, -7), WARM_SAT = add(W1, -2), WARM_SUN = add(W1, -1);
const clone = o => JSON.parse(JSON.stringify(o));

/* ---------- tiny runner ---------- */
let pass = 0, fail = 0; const errors = [];
function check(name, ok, detail) { if (ok) pass++; else { fail++; console.log("FAIL " + name + (detail !== undefined ? "  →  " + JSON.stringify(detail) : "")); } }

/* ---------- static server for the page ---------- */
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2", ".png": "image/png", ".txt": "text/plain", ".md": "text/plain" };
function serve() { return new Promise(res => { const srv = http.createServer((req, rsp) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname); if (p.endsWith("/")) p += "index.html";
  const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f)) { rsp.writeHead(404); rsp.end(); return; }
  rsp.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(rsp);
}).listen(0, "127.0.0.1", () => res(srv)); }); }

/* ---------- fake GitHub contents API ---------- */
function repo(data, inbox) { return { text: JSON.stringify(data, null, 1) + "\n", sha: "s0", n: 0, inbox: Object.assign({ "README.md": "Shortcut drops files here." }, inbox || {}), puts: [], deletes: [] }; }
const repoData = r => JSON.parse(r.text);
async function fakeGitHub(page, r) {
  await page.route("https://api.github.com/**", async route => {
    const q = route.request(), m = q.method(), u = new URL(q.url()), p = u.pathname.startsWith(API) ? u.pathname.slice(API.length) : null;
    const cors = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, PUT, DELETE", "access-control-allow-headers": "authorization, content-type, accept, x-github-api-version" };
    const json = (status, body) => route.fulfill({ status, headers: Object.assign({ "content-type": "application/json" }, cors), body: JSON.stringify(body) });
    if (m === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const auth = q.headers()["authorization"] || "";
    if (auth === "Bearer " + NOACCESS || p === null) return json(404, { message: "Not Found" });
    if (auth !== "Bearer " + GOOD) return json(401, { message: "Bad credentials" });
    if (p === "data.json" && m === "GET") return json(200, { sha: r.sha, content: Buffer.from(r.text).toString("base64").replace(/(.{60})/g, "$1\n") });
    if (p === "data.json" && m === "PUT") { const b = JSON.parse(q.postData());
      if (b.sha !== r.sha) return json(409, { message: "is at " + r.sha + " but expected " + b.sha });
      r.text = Buffer.from(b.content, "base64").toString("utf8"); r.sha = "s" + (++r.n); r.puts.push(b.message); return json(200, { content: { sha: r.sha } }); }
    if (p === "inbox" && m === "GET") return json(200, Object.keys(r.inbox).map(n => ({ type: "file", name: n, path: "inbox/" + n, sha: "i-" + n })));
    if (p.startsWith("inbox/")) { const n = p.slice(6); if (!(n in r.inbox)) return json(404, { message: "Not Found" });
      if (m === "GET") return json(200, { sha: "i-" + n, content: Buffer.from(r.inbox[n]).toString("base64") });
      if (m === "DELETE") { delete r.inbox[n]; r.deletes.push(n); return json(200, {}); } }
    return json(404, { message: "Not Found" });
  });
}

/* ---------- one page per scenario ---------- */
let browser, base;
async function open(date, r, token, opts) {
  opts = opts || {};
  const ctx = await browser.newContext({ timezoneId: "Europe/London", locale: "en-GB", viewport: { width: 390, height: 844 }, colorScheme: opts.dark ? "dark" : "light" });
  if (token) await ctx.addInitScript(t => { localStorage.setItem("baseline.gh.token", t); }, token);
  if (opts.local) await ctx.addInitScript(d => { localStorage.setItem("baseline.v1", JSON.stringify({ data: d, queue: [] })); }, opts.local);
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(date + " " + e.message));
  page.on("console", m => { if (m.type() === "error" && !(opts.allowNet && /^Failed to load resource/.test(m.text()))) errors.push(date + " console: " + m.text()); });
  await page.clock.setFixedTime(new Date(date + "T" + (opts.time || "10:00:00") + "Z"));
  if (r) await fakeGitHub(page, r);
  await page.goto(base);
  if (token === GOOD) await page.waitForSelector("#syncchip.ok", { timeout: 8000 });
  return { page, ctx };
}
const txt = async (page, sel) => ((await page.textContent(sel)) || "").trim();
const all = async (page, sel) => (await page.$$eval(sel, els => els.map(e => e.textContent.trim())));
async function until(fn, ms) { const end = Date.now() + (ms || 6000); while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 100)); } return false; }
async function setupKV(page) { await page.click('#tabs button[data-v="setup"]');
  return page.$$eval(".kv", els => Object.fromEntries(els.map(e => [e.children[0].textContent.trim(), e.children[1].textContent.trim()]))); }

(async () => {
  const srv = await serve(); base = "http://127.0.0.1:" + srv.address().port + "/";
  browser = await chromium.launch();
  let o, r, kv;

  /* 1. Not connected: no personal plan, so no week number is claimed */
  o = await open(WARM_SAT, null, null);
  check("unconnected label", await txt(o.page, ".top .kicker") === "This week, " + range(WARM), await txt(o.page, ".top .kicker"));
  check("unconnected verdict", await txt(o.page, "h1.verdict") === "5 more for the floor", await txt(o.page, "h1.verdict"));
  check("unconnected chip", await txt(o.page, "#syncchip") === "Not connected");
  kv = await setupKV(o.page);
  check("unconnected setup hides Week 1 row", !("Week 1 starts" in kv), kv);
  check("unconnected setup notes generic defaults", (await o.page.content()).includes("These are the generic defaults"));
  await o.ctx.close();

  /* 2. Connected, Saturday of the warm-up week */
  r = repo(FIX); o = await open(WARM_SAT, r, GOOD);
  check("warm-up label", await txt(o.page, ".top .kicker") === "Warm-up week, " + range(WARM), await txt(o.page, ".top .kicker"));
  check("warm-up verdict", await txt(o.page, "h1.verdict") === "Practice week", await txt(o.page, "h1.verdict"));
  check("warm-up sub names Week 1", (await txt(o.page, ".verdict-sub")).includes("Week 1 starts on " + long(W1)), await txt(o.page, ".verdict-sub"));
  check("warm-up floor chart", JSON.stringify(await all(o.page, ".floor-labels > div")) === JSON.stringify(["Runs1 of 2", "Strength1 of 2", "Set days0 of 5"]), await all(o.page, ".floor-labels > div"));
  check("warm-up set targets are week 1's", (await all(o.page, ".counter .val")).join("|") === "0of 20|0of 10", await all(o.page, ".counter .val"));
  await o.page.click('#tabs button[data-v="weeks"]');
  check("warm-up weeks nav", (await txt(o.page, ".weeknav > div")).startsWith("Warm-up week" + range(WARM) + ". Practice week."), await txt(o.page, ".weeknav > div"));
  check("warm-up weeks list", JSON.stringify(await all(o.page, ".weeks .res")) === JSON.stringify(["In progress"]), await all(o.page, ".weeks .res"));
  kv = await setupKV(o.page);
  check("setup Week 1 row", kv["Week 1 starts"] === short(W1) + " " + W1.slice(0, 4), kv["Week 1 starts"]);
  check("setup shows version 1.0.1", await txt(o.page, ".top .kicker") === "Version 1.0.1");
  check("no writes on a clean open", r.puts.length === 0, r.puts);
  await o.ctx.close();

  /* 3. Sunday of the warm-up week says "tomorrow" */
  o = await open(WARM_SUN, repo(FIX), GOOD);
  check("warm-up Sunday sub", (await txt(o.page, ".verdict-sub")).includes("Week 1 starts tomorrow"), await txt(o.page, ".verdict-sub"));
  await o.ctx.close();

  /* 4. Monday of Week 1: countdown starts, warm-up is not counted */
  o = await open(W1, repo(FIX), GOOD);
  check("week 1 label", await txt(o.page, ".top .kicker") === "Week 1, " + range(W1), await txt(o.page, ".top .kicker"));
  check("week 1 verdict", await txt(o.page, "h1.verdict") === "5 more for the floor", await txt(o.page, "h1.verdict"));
  await o.page.click('#tabs button[data-v="weeks"]');
  check("weeks list labels", JSON.stringify(await all(o.page, ".weeks .wk b")) === JSON.stringify(["Week 1, " + range(W1), "Warm-up week, " + range(WARM)]), await all(o.page, ".weeks .wk b"));
  check("warm-up not counted", JSON.stringify(await all(o.page, ".weeks .res")) === JSON.stringify(["In progress", "Not counted"]), await all(o.page, ".weeks .res"));
  check("no streak yet", await txt(o.page, ".top .kicker") === "No streak yet, this week can start one");
  await o.page.click('.weeks button:nth-child(2)');
  check("past warm-up nav", (await txt(o.page, ".weeknav > div")) === "Warm-up week" + range(WARM) + ". Not counted.", await txt(o.page, ".weeknav > div"));
  await o.ctx.close();

  /* 5. Week 3: ramp moves to 30 + 15 */
  o = await open(add(W1, 14), repo(FIX), GOOD);
  check("week 3 label", await txt(o.page, ".top .kicker") === "Week 3, " + range(add(W1, 14)), await txt(o.page, ".top .kicker"));
  check("week 3 set targets", (await all(o.page, ".counter .val")).join("|") === "0of 30|0of 15", await all(o.page, ".counter .val"));
  await o.ctx.close();

  /* 6. Warm-up floor cleared still reads as cleared */
  let d = clone(FIX); [add(WARM, 0), add(WARM, 1), add(WARM, 4)].forEach(x => { d.days[x] = Object.assign(d.days[x] || {}, { pu: 20, pl: 10 }); });
  o = await open(WARM_SAT, repo(d), GOOD);
  check("warm-up floor cleared", await txt(o.page, "h1.verdict") === "Floor cleared", await txt(o.page, "h1.verdict"));
  await o.ctx.close();

  /* 7. Streak counts from Week 1 and is not broken by the warm-up */
  d = clone(FIX); [W1, add(W1, 1), add(W1, 2)].forEach((x, i) => { d.days[x] = i === 0 ? { s: { strength: 1 } } : { pu: 20, pl: 10 }; }); d.days[add(W1, 2)].s = { run: 1 };
  o = await open(add(W1, 7), repo(d), GOOD);
  await o.page.click('#tabs button[data-v="weeks"]');
  check("streak after week 1", await txt(o.page, ".top .kicker") === "Floor cleared 1 week running", await txt(o.page, ".top .kicker"));
  check("week 1 verdict in list", (await all(o.page, ".weeks .res"))[1] === "Floor cleared", await all(o.page, ".weeks .res"));
  await o.ctx.close();

  /* 8. A tap is saved as one commit and replayed on the remote copy */
  r = repo(FIX); o = await open(WARM_SAT, r, GOOD);
  await o.page.locator("button.row", { hasText: "Protein" }).click();
  check("tap commits", await until(() => r.puts.length === 1), r.puts);
  check("commit message", r.puts[0] === "Food " + short(WARM_SAT), r.puts);
  check("remote has the tick", repoData(r).days[WARM_SAT] && repoData(r).days[WARM_SAT].p === 1, repoData(r).days[WARM_SAT]);
  check("remote kept the plan", repoData(r).cfg.rampStart === W1 && JSON.stringify(repoData(r).cfg) === JSON.stringify(FIX.cfg));
  await o.page.locator("button.row", { hasText: "Protein" }).click();
  check("untick commits", await until(() => r.puts.length === 2), r.puts);
  check("untick removes the day", !repoData(r).days[WARM_SAT], repoData(r).days[WARM_SAT]);
  await o.ctx.close();

  /* 9. Someone else wrote first: the 409 is retried on the new copy */
  r = repo(FIX); o = await open(WARM_SAT, r, GOOD);
  { const other = repoData(r); other.days[WARM] = { s: { strength: 1 } }; r.text = JSON.stringify(other); r.sha = "elsewhere"; }
  await o.page.locator("button.row", { hasText: "Fibre" }).click();
  check("conflict resolved", await until(() => r.puts.length === 1 && repoData(r).days[WARM] && repoData(r).days[WARM_SAT] && repoData(r).days[WARM_SAT].f === 1), repoData(r).days);
  await o.ctx.close();

  /* 10. Apple Health inbox: parsed, merged, file deleted */
  const fname = WARM_SAT + "-071500.txt", prev = add(WARM_SAT, -1);
  const lines = ["S|" + prev + "|8432", "S|" + WARM_SAT + "|1,200",
    "Z|Asleep Core|" + prev + "T23:30:00Z|" + WARM_SAT + "T03:00:00Z", "Z|Asleep Deep|" + WARM_SAT + "T03:00:00Z|" + WARM_SAT + "T04:00:00Z",
    "Z|Awake|" + WARM_SAT + "T04:00:00Z|" + WARM_SAT + "T04:10:00Z", "Z|Asleep REM|" + WARM_SAT + "T04:10:00Z|" + WARM_SAT + "T06:40:00Z",
    "Z|In Bed|" + prev + "T23:00:00Z|" + WARM_SAT + "T07:00:00Z", "W|" + WARM_SAT + "|91.6|kg"].join("\n");
  r = repo(FIX, { [fname]: lines }); o = await open(WARM_SAT, r, GOOD);
  check("inbox merged in one commit", await until(() => r.puts.length === 1 && r.deletes.length === 1), { puts: r.puts, deletes: r.deletes });
  const H = repoData(r).health;
  check("steps", H[prev] && H[prev].steps === 8432 && H[WARM_SAT].steps === 1200, H);
  check("sleep union, awake and in-bed excluded", H[WARM_SAT] && H[WARM_SAT].sleep === 7, H[WARM_SAT]);
  check("weight kg to lb", H[WARM_SAT] && H[WARM_SAT].wt === 201.9, H[WARM_SAT]);
  check("healthAt stamped", !!repoData(r).meta.healthAt);
  check("README left alone", "README.md" in r.inbox && !(fname in r.inbox), Object.keys(r.inbox));
  check("today shows Apple Health", (await all(o.page, ".note")).some(t => t === "From Apple Health: 7.0 h sleep, 1,200 steps so far, 201.9 lb."), await all(o.page, ".note"));
  await o.ctx.close();

  /* 11. Connecting from Setup: format check, wrong token, no repo access, then success (the 401 and 404 are expected) */
  r = repo(FIX); o = await open(WARM_SAT, r, null, { allowNet: true });
  await o.page.click('#tabs button[data-v="setup"]');
  const tryTok = async t => { await o.page.fill("#tok", t); await o.page.click("button.btn >> text=Connect"); await o.page.waitForTimeout(400);
    const el = await o.page.$(".msg"); return el ? ((await el.textContent()) || "").trim() : ""; };
  check("rejects non-token text", (await tryTok("hello")).startsWith("That doesn't look like a GitHub token"));
  check("explains a bad token", (await tryTok(WRONG)).startsWith("GitHub didn't accept that token"));
  check("explains missing repo access", (await tryTok(NOACCESS)).includes("Only select repositories"));
  await tryTok(GOOD);
  check("connect stores the token", await until(async () => (await o.page.evaluate(() => localStorage.getItem("baseline.gh.token"))) === GOOD));
  await o.page.click('#tabs button[data-v="today"]');
  check("connected device switches to the plan", await until(async () => (await txt(o.page, ".top .kicker")) === "Warm-up week, " + range(WARM)), await txt(o.page, ".top .kicker"));
  await o.ctx.close();

  /* 12. Logs made before connecting are kept and pushed */
  r = repo(FIX); o = await open(WARM_SAT, r, null);
  await o.page.locator("button.row", { hasText: "Calories" }).click();
  await o.page.click('#tabs button[data-v="setup"]'); await o.page.fill("#tok", GOOD); await o.page.click("button.btn >> text=Connect");
  check("offline log pushed on connect", await until(() => repoData(r).days[WARM_SAT] && repoData(r).days[WARM_SAT].k === 1), repoData(r).days);
  await o.ctx.close();

  /* 13. Parser edge cases */
  o = await open(WARM_SAT, null, null);
  const P = (t, ft) => o.page.evaluate(([t, ft]) => window.__baseline.parseHealth(t, ft), [t, ft || 0]);
  check("stone to lb", (await P("W|2026-11-14|14.5|st"))["2026-11-14"].wt === 203);
  check("unitless kg guess", (await P("W|2026-11-14|92"))["2026-11-14"].wt === 202.8);
  check("comma decimal", (await P("W|2026-11-14|91,6|kg"))["2026-11-14"].wt === 201.9);
  check("body fat fraction", (await P("F|2026-11-14|0.28"))["2026-11-14"].bf === 28);
  check("JSON form", JSON.stringify(await P('{"date":"2026-11-14T08:00:00Z","steps":"9 001","sleep":7.25}')) === JSON.stringify({ "2026-11-14": { sleep: 7.25, steps: 9001 } }));
  check("junk ignored", JSON.stringify(await P("hello\nS|notadate|5\nW|2026-11-14|9999|lb")) === "{}");
  check("lowercase keys and spaces", (await P(" s | 2026-11-14 | 4321 "))["2026-11-14"].steps === 4321);
  await o.ctx.close();

  /* 14. Dark mode renders the same verdict */
  o = await open(WARM_SAT, repo(FIX), GOOD, { dark: true });
  check("dark mode verdict", await txt(o.page, "h1.verdict") === "Practice week");
  await o.ctx.close();

  /* 15. Service worker cache name moves with the version */
  const ver = (fs.readFileSync(path.join(ROOT, "index.html"), "utf8").match(/var VERSION="([^"]+)"/) || [])[1];
  const cache = (fs.readFileSync(path.join(ROOT, "sw.js"), "utf8").match(/const CACHE = 'baseline-([^']+)'/) || [])[1];
  check("VERSION and CACHE match", ver && ver === cache, { ver, cache });

  check("no page or console errors", errors.length === 0, errors);
  await browser.close(); srv.close();
  console.log((fail ? "FAILED " : "OK ") + pass + " passed, " + fail + " failed" + (process.env.BASELINE_FIXTURE ? " (fixture " + path.basename(process.env.BASELINE_FIXTURE) + ")" : ""));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
