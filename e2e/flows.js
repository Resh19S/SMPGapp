// End-to-end walk through every feature, the way a person would use it.
// Run against a freshly seeded scratch app (see README) — it changes data.
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");
const { APP, CHROME, OUT, OWNER, STAFF } = require("./config");

const results = [];
let activePage = null; // for a screenshot if the flow stops
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  activePage = page;
  const crashes = [];
  page.on("pageerror", (e) => crashes.push(String(e).split("\n")[0]));
  const unexpected = [];
  page.on("response", (r) => {
    if (r.status() >= 500) unexpected.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });

  async function signIn({ username, password }) {
    await page.goto(APP + "/login");
    await page.fill("#username", username);
    await page.fill("#password", password);
    await page.click("button[type=submit]");
    await page.waitForURL(APP + "/");
    await page.waitForSelector("text=Open items");
  }
  const rows = () => page.locator("div[class*=tableWrap] tbody tr");

  await signIn(OWNER);
  check("Sidebar shows property name", (await page.locator("aside").textContent()).includes("Sunrise PG"));
  check("Sidebar badges present", (await page.locator("aside span[aria-label*='open items']").count()) === 1);

  // --- Part payment → banner → receipt → WhatsApp link
  await page.goto(APP + "/rent");
  await rows().first().waitFor();
  const first = rows().first();
  const tenantName = (await first.locator("td").first().innerText()).split("\n")[0];
  const remindHref = await first.locator("a:has-text('Remind')").getAttribute("href");
  check("Reminder opens WhatsApp with text", /^https:\/\/wa\.me\/91\d{10}\?text=/.test(remindHref ?? ""), remindHref?.slice(0, 40));
  await first.locator("button:has-text('Record payment')").click();
  await page.fill("#paid-amount", "1000");
  await page.click("button:has-text('Record part payment')");
  await page.waitForSelector("[role=status]:has-text('Payment recorded')");
  check("Payment banner names the tenant", (await page.locator("[role=status]").first().innerText()).includes(tenantName));
  await page.click("text=View & send receipt");
  await page.waitForSelector("text=Rent receipt");
  const receiptText = await page.locator("article").innerText();
  check("Receipt shows amount and balance", receiptText.includes("₹1,000") && /Balance for the month/.test(receiptText));
  const waReceipt = await page.locator("a:has-text('Send on WhatsApp')").getAttribute("href");
  check("Receipt WhatsApp link prefilled", decodeURIComponent(waReceipt ?? "").includes("Rent receipt R"));

  // --- Export rent to Excel
  await page.goto(APP + "/rent");
  await rows().first().waitFor();
  const [rentCsv] = await Promise.all([page.waitForEvent("download"), page.click("button:has-text('Export to Excel')")]);
  const rentPath = path.join(OUT, "rent.csv");
  await rentCsv.saveAs(rentPath);
  const rentLines = fs.readFileSync(rentPath, "utf8").trim().split(/\r?\n/);
  check("Rent export has header + rows", rentLines[0].includes("Tenant") && rentLines.length > 10, `${rentLines.length} lines`);

  // --- Add rooms in bulk
  await page.goto(APP + "/properties");
  await page.waitForSelector("text=Floor 1");
  await page.click("text=+ Add rooms");
  await page.fill("#bulk-rooms", "901-902");
  await page.fill("#bulk-labels", "A, B");
  await page.fill("#bulk-rent", "15000");
  await page.click("button:has-text('Add 4 beds')");
  await page.waitForSelector("text=Floor 9");
  check("Bulk rooms create floor 9", (await page.locator("#room-901 button, #room-902 button").count()) === 4);

  // --- Import tenants from CSV into the new rooms
  await page.goto(APP + "/tenants");
  await rows().first().waitFor();
  const before = await rows().count();
  await page.click("text=Import from Excel");
  const csv = [
    "Name,Phone,Room,Bed,Move-in date,Rent due day,Rent,Deposit,Agreement ends",
    "Imported One,9811100001,901,A,01/09/2026,5,15000,15000,31/07/2027",
    "Imported Two,9811100002,901,b,15/09/2026,15,,15000,14/08/2027",
  ].join("\n");
  await page.setInputFiles("input[type=file]", { name: "register.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.waitForSelector("text=ready to import");
  await page.click("button:has-text('Import 2 tenants')");
  await page.waitForSelector("text=2 tenants imported");
  await page.waitForTimeout(400);
  check("Import adds 2 tenants", (await rows().count()) === before + 2, `${before} → ${await rows().count()}`);

  // --- Search: room → highlighted; resident → details open
  await page.fill("input[type=search]", "901");
  await page.locator("[role=option]:has(span:text-is('Room 901'))").click();
  await page.waitForURL("**/properties?room=901");
  await page.waitForSelector("#room-901");
  check("Search opens the room", (await page.locator("#room-901[class*=roomFocus]").count()) === 1);
  await page.fill("input[type=search]", "Imported One");
  await page.locator("[role=option]:has(span:text-is('Imported One'))").click();
  await page.waitForSelector("[role=dialog]:has-text('Imported One')");
  check("Search opens the resident", true);
  await page.click("text=Edit name / phone");
  await page.fill("#edit-phone", "+91 98111 00009");
  await page.click("[role=dialog] button:text-is('Save')");
  await page.waitForSelector("[role=dialog] >> text=9811100009");
  check("Edit phone normalises and saves", true);

  // --- Renewal with +5%
  await page.click("text=Renew agreement");
  await page.click("button:has-text('+5%')");
  await page.click("text=Confirm renewal");
  await page.waitForSelector("[aria-label='Renewal history'] li");
  check("Renewal recorded with new rent", (await page.locator("[role=dialog]").innerText()).includes("₹15,750"));
  await page.keyboard.press("Escape");

  // --- Lead → move in
  await page.goto(APP + "/leads");
  await rows().first().waitFor();
  const lead = rows().filter({ hasText: "Priya Sharma" });
  await lead.locator("button:has-text('Move in')").click();
  check("Move-in prefilled from lead", (await page.inputValue("#tenant-name")) === "Priya Sharma");
  await page.selectOption("#tenant-bed", { index: 1 });
  await page.click("button:has-text('Move in') >> nth=-1");
  await page.waitForSelector("text=moved into Room");
  check("Lead marked booked", (await rows().filter({ hasText: "Priya Sharma" }).innerText()).toLowerCase().includes("booked"));

  // --- Profit & loss: add, export, delete
  await page.goto(APP + "/profit-loss");
  await page.waitForSelector("text=Statement");
  await page.selectOption("#exp-cat", "maintenance");
  await page.fill("#exp-amount", "1234");
  await page.fill("#exp-to", "E2E plumber");
  await page.click("button:has-text('Add expense')");
  await page.waitForSelector("text=E2E plumber");
  const [pnlCsv] = await Promise.all([page.waitForEvent("download"), page.click("button:has-text('Export to Excel')")]);
  await pnlCsv.saveAs(path.join(OUT, "pnl.csv"));
  check("P&L export includes the new expense", fs.readFileSync(path.join(OUT, "pnl.csv"), "utf8").includes("E2E plumber"));
  page.once("dialog", (d) => d.accept());
  await page.click("button[aria-label*='₹1,234']");
  await page.waitForSelector("text=E2E plumber", { state: "detached" });
  check("Expense deleted", true);

  // --- Owner resets staff password; staff signs in with it, then changes it back
  await page.goto(APP + "/staff");
  await rows().first().waitFor();
  await rows().filter({ has: page.locator(`td[class*=mono]:text-is('${STAFF.username}')`) }).locator("button:has-text('Reset password')").click();
  await page.fill("#reset-pw", "temporary-pass");
  await page.click("[role=dialog] button[type=submit]");
  await page.waitForSelector("text=signed out everywhere");
  await page.keyboard.press("Escape");
  await page.click("text=Log out");
  await signIn({ username: STAFF.username, password: "temporary-pass" });
  check("Staff sees no owner pages", (await page.locator("aside >> text=Profit").count()) === 0 && (await page.locator("aside >> text=Staff Access").count()) === 0);
  await page.goto(APP + "/profit-loss");
  await page.waitForTimeout(300);
  check("Staff redirected away from P&L", !page.url().includes("profit-loss"), page.url());
  await page.click("button:has-text('Password')");
  await page.fill("#pw-current", "temporary-pass");
  await page.fill("#pw-new", STAFF.password);
  await page.fill("#pw-confirm", STAFF.password);
  await page.click("button:has-text('Change password') >> nth=-1");
  await page.waitForSelector("text=Password changed");
  check("Staff changed own password", true);

  check("No page crashes", crashes.length === 0, crashes.join(" | "));
  check("No server errors (5xx)", unexpected.length === 0, unexpected.join(" | "));
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exitCode = failed ? 1 : 0;
  await browser.close();
})().catch((e) => {
  console.log(results.join("\n"));
  console.error("\nFLOW STOPPED:", e.message.split("\n").slice(0, 3).join(" | "));
  const done = () => process.exit(1);
  if (activePage) activePage.screenshot({ path: path.join(OUT, "flow-stopped.png") }).then(done, done);
  else done();
});
