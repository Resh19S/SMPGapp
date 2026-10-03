// Slow-network stress: every API response is delayed 0–700 ms at random while
// toggles and month pickers are flipped fast. The screen must always settle on
// the LAST choice, never crash, and never show a stale list.
const { chromium } = require("playwright-core");
const { APP, API, CHROME, OWNER } = require("./config");

const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);

(async () => {
  // Arrange a moved-out tenant so "Show moved-out" has something to hide.
  const api = async (method, p, body, token) => {
    const res = await fetch(API + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json().catch(() => null);
  };
  const { token } = await api("POST", "/auth/login", OWNER);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const someone = (await api("GET", "/tenants", null, token)).find((t) => !t.notice && t.moveInDate < today);
  await api("POST", `/tenants/${someone.id}/notice`, { noticeDate: today, plannedMoveOutDate: today }, token);
  const notice = (await api("GET", "/move-outs", null, token)).find((n) => n.tenantId === someone.id);
  await api("POST", `/move-outs/${notice.id}/settle`, { refundPaidDate: today }, token);

  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const crashes = [];
  page.on("pageerror", (e) => crashes.push(String(e).split("\n")[0]));
  await page.route(`${API}/**`, async (route) => {
    await new Promise((r) => setTimeout(r, Math.random() * 700));
    await route.continue();
  });

  await page.goto(APP + "/login");
  await page.fill("#username", OWNER.username);
  await page.fill("#password", OWNER.password);
  await page.click("button[type=submit]");
  await page.waitForURL(APP + "/");
  await page.waitForSelector("text=Open items");

  const flip = async (selector, times) => {
    for (let i = 0; i < times; i++) {
      await page.click(selector);
      await page.waitForTimeout(40 + Math.random() * 120);
    }
  };
  const settle = () => page.waitForTimeout(1600);

  await page.goto(APP + "/leads");
  await page.waitForSelector("div[class*=tableWrap] tbody tr");
  for (let round = 1; round <= 3; round++) {
    await flip("text=Show archived (lost) leads", 6);
    await settle();
    const lost = await page.locator("tbody span:text-is('lost')").count();
    check(`Leads toggle round ${round}`, !(await page.isChecked("text=Show archived (lost) leads >> input")) && lost === 0, `lost=${lost}`);
  }

  await page.goto(APP + "/tenants");
  await page.waitForSelector("div[class*=tableWrap] tbody tr");
  for (let round = 1; round <= 3; round++) {
    await flip("text=Show moved-out tenants", 6);
    await settle();
    const moved = await page.locator("tbody span:text-is('moved out')").count();
    check(`Tenants toggle round ${round}`, moved === 0, `movedOut=${moved}`);
  }

  await page.goto(APP + "/operations");
  await page.waitForSelector("text=Move-outs");
  for (let round = 1; round <= 3; round++) {
    await flip("text=Show resolved", 6);
    await flip("text=Show settled", 6);
    await settle();
    const resolved = await page.locator("tbody span:text-is('resolved')").count();
    const settled = await page.locator("article span:text-is('settled')").count();
    check(`Operations toggles round ${round}`, resolved === 0 && settled === 0, `resolved=${resolved} settled=${settled}`);
  }

  await page.goto(APP + "/rent");
  await page.waitForSelector("div[class*=tableWrap] tbody tr");
  const monthSelect = page.locator("select[aria-label=Month]");
  const months = (await monthSelect.locator("option").allTextContents()).filter((m) => m !== "All months");
  for (let round = 1; round <= 3; round++) {
    const picks = ["All months", months[1], "All months", months[round % months.length], "All months", months[(round + 2) % months.length]];
    for (const p of picks) {
      await monthSelect.selectOption({ label: p });
      await page.waitForTimeout(30 + Math.random() * 100);
    }
    await settle();
    const want = picks[picks.length - 1];
    const heading = (await page.locator("h2:has-text('Collection —')").textContent().catch(() => "missing")) ?? "";
    check(`Rent month switching round ${round}`, heading.includes(want), `want=${want} got="${heading}"`);
  }

  await page.goto(APP + "/profit-loss");
  await page.waitForSelector("h2:has-text('Statement')");
  const pnlSelect = page.locator("select[aria-label=Month]");
  const pnlMonths = await pnlSelect.locator("option").allTextContents();
  for (let round = 1; round <= 3; round++) {
    const picks = [pnlMonths[3], pnlMonths[0], pnlMonths[5], pnlMonths[round]];
    for (const p of picks) {
      await pnlSelect.selectOption({ label: p });
      await page.waitForTimeout(30 + Math.random() * 100);
    }
    await settle();
    const heading = await page.locator("h2:has-text('Statement')").textContent();
    check(`P&L month switching round ${round}`, heading.includes(picks[picks.length - 1]), heading);
  }

  // Search typed fast: results must match the final text.
  await page.goto(APP + "/");
  for (const ch of "arjun") {
    await page.type("input[type=search]", ch);
    await page.waitForTimeout(60);
  }
  await settle();
  const titles = await page.locator("[role=option]").allInnerTexts();
  check("Search settles on the final text", titles.length > 0 && titles.every((t) => /arjun/i.test(t)), `${titles.length} results`);

  await page.evaluate(() => sessionStorage.setItem("token", "expired.invalid.token"));
  await page.goto(APP + "/rent");
  await page.waitForURL("**/login?expired=1", { timeout: 8000 }).catch(() => {});
  check("Expired session → sign-in with message", (await page.locator("text=Your session has expired").count()) === 1, page.url());

  await page.evaluate(() => {
    sessionStorage.setItem("token", "x");
    sessionStorage.setItem("user", "{not json");
  });
  await page.goto(APP + "/");
  await page.waitForTimeout(800);
  check("Corrupted saved login → sign-in page", (await page.locator("#username").count()) === 1);

  check("No page crashes", crashes.length === 0, crashes.join(" | "));
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exitCode = failed ? 1 : 0;
  await browser.close();
})();
