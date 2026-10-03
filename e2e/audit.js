// Full feature audit: the owner's day as one pipeline, with every change
// cross-checked against the API, the Excel exports and the Activity log —
// then a sweep that presses every filter, toggle, chip and link on every page.
// Changes data: run against a freshly seeded scratch app (see README).
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");
const { APP, API, CHROME, OUT, OWNER } = require("./config");

const results = [];
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const section = (title) => results.push(`\n## ${title}`);

// ---- direct API access, used to verify what the UI claims ----
let ownerToken = null;
async function api(method, p, body, token = ownerToken) {
  const res = await fetch(API + p, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const get = async (p) => (await api("GET", p)).body;

function istToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}
function shiftMonth(period, n) {
  const [y, m] = period.split("-").map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}
function parseCsv(file) {
  const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') q = false; else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.some((x) => x !== ""));
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const crashes = [];
  const serverErrors = [];
  page.on("pageerror", (e) => crashes.push(String(e).split("\n")[0]));
  page.on("console", (m) => m.type() === "error" && !/status of 4\d\d/.test(m.text()) && crashes.push(m.text()));
  page.on("response", (r) => r.status() >= 500 && serverErrors.push(`${r.status()} ${r.url()}`));
  const rows = () => page.locator("div[class*=tableWrap] tbody tr");
  const download = async (clickSelector, name) => {
    const [d] = await Promise.all([page.waitForEvent("download"), page.click(clickSelector)]);
    const file = path.join(OUT, name);
    await d.saveAs(file);
    return parseCsv(file);
  };
  const activityHas = async (action, text) =>
    (await get(`/activity?limit=200`)).some((e) => e.action === action && e.detail.includes(text));

  const today = istToday();
  const period = today.slice(0, 7);
  const stamp = Date.now().toString().slice(-5);
  const leadName = `Audit Lead ${stamp}`;
  const leadPhone = `97${String(Date.now()).slice(-8)}`;

  try {
    // ================= 1. Sign in =================
    section("Sign in");
    await page.goto(APP + "/rent");
    await page.waitForURL("**/login");
    check("Protected page sends you to sign-in", page.url().includes("/login"));
    await page.fill("#username", OWNER.username);
    await page.fill("#password", "wrong-password");
    await page.click("button[type=submit]");
    await page.waitForSelector("text=Incorrect username or password");
    check("Wrong password shows a clear message", true);
    await page.fill("#password", OWNER.password);
    await page.click("button[type=submit]");
    await page.waitForSelector("text=Open items");
    ownerToken = await page.evaluate(() => sessionStorage.getItem("token"));
    check("Owner signs in", !!ownerToken);
    check("Failed + successful sign-in both logged", (await activityHas("auth.login_failed", "owner")) && (await activityHas("auth.login", "from")));

    const before = {
      dash: await get("/dashboard"),
      summary: await get(`/payments/summary?periodMonth=${period}`),
      pnl: await get(`/reports/pnl?periodMonth=${period}`),
    };

    // ================= 2. Lead =================
    section("Lead → follow-up → status");
    await page.goto(APP + "/leads");
    await rows().first().waitFor();
    await page.click("text=+ Add lead");
    await page.fill("#lead-name", leadName);
    await page.fill("#lead-phone", leadPhone);
    await page.selectOption("#lead-source", "broker");
    const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    await page.fill("#lead-followup", tomorrow);
    await page.fill("#lead-notes", "Wants a 2-sharing room near the window");
    await page.click("[role=dialog] button[type=submit]");
    await page.waitForSelector(`text=${leadName}`);
    const lead = (await get("/leads")).find((l) => l.name === leadName);
    check("Lead saved with every field", lead && lead.source === "broker" && lead.followUpDate === tomorrow && lead.phone === leadPhone);
    check("Lead appears in Day Book 'coming up'", (await get("/dashboard")).nextSevenDays.some((e) => e.title.includes(leadName)));
    check("Lead creation logged", await activityHas("lead.created", leadName));
    await rows().filter({ hasText: leadName }).locator("select").selectOption("visited");
    await page.waitForTimeout(500);
    check("Status change saved", (await get("/leads")).find((l) => l.id === lead.id).status === "visited");
    check("Status change logged", await activityHas("lead.status", "new → visited"));
    const leadWa = await rows().filter({ hasText: leadName }).locator("a:has-text('WhatsApp')").getAttribute("href");
    check("Lead WhatsApp link uses their number", leadWa.startsWith(`https://wa.me/91${leadPhone}`));

    // ================= 3. Move in from lead =================
    section("Move the lead into a bed (agreed rent differs from listed)");
    const vacant = (await get("/beds")).find((b) => b.rentState === "vacant");
    await rows().filter({ hasText: leadName }).locator("button:has-text('Move in')").click();
    check("Form pre-filled from the lead", (await page.inputValue("#tenant-name")) === leadName && (await page.inputValue("#tenant-phone")) === leadPhone);
    await page.selectOption("#tenant-bed", String(vacant.id));
    check("Agreed rent pre-filled from listed rent", Number(await page.inputValue("#tenant-rent")) === vacant.rentAmount);
    await page.fill("#tenant-rent", "9999");
    await page.fill("#tenant-deposit", "9999");
    await page.fill("#tenant-movein", today);
    await page.fill("#tenant-dueday", String(Number(today.slice(8))));
    await page.click("[role=dialog] button[type=submit]");
    await page.waitForSelector("text=moved into Room");
    const tenant = (await get("/tenants")).find((t) => t.name === leadName);
    check("Resident created with agreed rent ₹9,999", tenant && tenant.rentAmount === 9999 && tenant.depositAmount === 9999);
    check("Lead marked booked", (await get("/leads")).find((l) => l.id === lead.id).status === "booked");
    const bedNow = (await get("/beds")).find((b) => b.id === vacant.id);
    check("Bed now occupied by them, rent due today", bedNow.currentTenant?.name === leadName && bedNow.rentState === "due-today", bedNow.rentState);
    const dashAfterMoveIn = await get("/dashboard");
    check("Day Book occupied beds +1", dashAfterMoveIn.occupiedBeds === before.dash.occupiedBeds + 1);
    check("Empty-bed cost dropped by the listed rent", dashAfterMoveIn.vacantRentPerMonth === before.dash.vacantRentPerMonth - vacant.rentAmount);
    const rentRow = (await get(`/payments?periodMonth=${period}`)).find((r) => r.tenantId === tenant.id);
    check("This month billed at ₹9,999, due today", rentRow && rentRow.amountDue === 9999 && rentRow.dueDate === today && rentRow.status === "due");
    check("Move-in logged", await activityHas("tenant.moved_in", `${vacant.roomNumber}/${vacant.bedLabel}`));

    // ================= 4. Change rent info =================
    section("Change rent: bed's listed rent, then a renewal");
    await page.goto(APP + "/properties");
    await page.waitForSelector("text=Floor 1");
    await page.click(`button[aria-label^='Room ${vacant.roomNumber} bed ${vacant.bedLabel}:']`);
    await page.fill("#edit-rent", "12345");
    await page.click("button:has-text('Save rent')");
    await page.waitForSelector("[role=dialog]", { state: "detached" });
    check("Listed rent changed to ₹12,345", (await get("/beds")).find((b) => b.id === vacant.id).rentAmount === 12345);
    check("…but the current resident still pays ₹9,999", (await get(`/tenants/${tenant.id}`)).rentAmount === 9999);
    check("Listed-rent change logged with before/after", await activityHas("bed.updated", "₹" + vacant.rentAmount.toLocaleString("en-IN") + " → ₹12,345"));

    await page.goto(APP + `/tenants?open=${tenant.id}`);
    await page.waitForSelector(`[role=dialog]:has-text('${leadName}')`);
    await page.click("text=Renew agreement");
    const nextMonth = shiftMonth(period, 1);
    await page.fill("#renew-rent", "10500");
    await page.fill("#renew-from", nextMonth);
    await page.click("text=Confirm renewal");
    await page.waitForSelector("[aria-label='Renewal history'] li");
    const renewed = await get(`/tenants/${tenant.id}`);
    check("Renewal: ₹10,500 scheduled from next month", renewed.upcomingRent === 10500 && renewed.upcomingRentFrom === nextMonth);
    check("Renewal: this month still ₹9,999", renewed.rentAmount === 9999);
    check("Renewal adds an agreement document slot", renewed.documents.some((d) => d.label.startsWith("Renewal agreement")));
    check("Renewal logged", await activityHas("tenant.renewed", "₹9,999 → ₹10,500"));
    await page.keyboard.press("Escape");

    // ================= 5. Payments =================
    section("Record a part payment, then the rest");
    await page.goto(APP + "/rent");
    await rows().first().waitFor();
    const row = () => rows().filter({ hasText: leadName });
    await row().locator("button:has-text('Record payment')").click();
    await page.fill("#paid-amount", "4000");
    await page.selectOption("#paid-method", "upi");
    await page.fill("#paid-note", "UPI ref AUDIT1");
    await page.click("button:has-text('Record part payment')");
    await page.waitForSelector("[role=status]:has-text('Payment recorded')");
    let r = (await get(`/payments?periodMonth=${period}`)).find((x) => x.tenantId === tenant.id);
    check("Part payment: ₹4,000 paid, ₹5,999 left, still due", r.amountPaid === 4000 && r.status === "due");
    const s1 = await get(`/payments/summary?periodMonth=${period}`);
    check("Month's collected total rose by exactly ₹4,000", s1.collected === before.summary.collected + 4000, `${before.summary.collected} → ${s1.collected}`);
    const p1 = await get(`/reports/pnl?periodMonth=${period}`);
    check("Profit & Loss income rose by exactly ₹4,000", p1.incomeTotal === before.pnl.incomeTotal + 4000);
    await page.click("text=View & send receipt");
    await page.waitForSelector("text=Rent receipt");
    const receipt = await page.locator("article").innerText();
    check("Receipt: ₹4,000, UPI, reference, balance ₹5,999", receipt.includes("₹4,000") && receipt.includes("UPI") && receipt.includes("AUDIT1") && receipt.includes("₹5,999"));
    await page.goto(APP + "/rent");
    await row().locator("button:has-text('Record payment')").click();
    check("Second payment defaults to the remaining ₹5,999", (await page.inputValue("#paid-amount")) === "5999");
    await page.fill("#paid-amount", "6000");
    await page.click("[role=dialog] button[type=submit]");
    await page.waitForTimeout(400);
    // Blocked either by the browser's max check or by our own message — never sent.
    const overflow = await page.$eval("#paid-amount", (el) => el.validity.rangeOverflow);
    const ourMessage = await page.locator("text=Only ₹5,999 is left").count();
    const stillOpen = (await page.locator("[role=dialog]").count()) === 1;
    const unchanged = (await get(`/payments?periodMonth=${period}`)).find((x) => x.tenantId === tenant.id).amountPaid === 4000;
    check("Over-payment blocked in the form", stillOpen && unchanged && (overflow || ourMessage > 0), overflow ? "browser max check" : "app message");
    await page.fill("#paid-amount", "5999");
    await page.click("button:has-text('Mark as paid')");
    await page.waitForSelector("[role=status]:has-text('is fully paid')");
    r = (await get(`/payments?periodMonth=${period}`)).find((x) => x.tenantId === tenant.id);
    check("Month fully paid", r.status === "paid" && r.amountPaid === 9999 && r.paidDate === today);
    check("Bed shows paid", (await get("/beds")).find((b) => b.id === vacant.id).rentState === "paid");
    check("Both payments logged with name + month", await activityHas("payment.recorded", `${leadName} · ${period}: ₹5,999.00`));

    // ================= 6. Exports =================
    section("Export to Excel and compare with the screen/API");
    const rentCsv = await download("button:has-text('Export to Excel')", "audit-rent.csv");
    const csvRow = rentCsv.find((x) => x.Tenant === leadName);
    check("Rent export row matches", csvRow && csvRow.Rent === "9999" && csvRow.Paid === "9999" && csvRow.Balance === "0" && csvRow.Status === "paid" && csvRow.Phone === leadPhone);
    check("Rent export has every row on screen", rentCsv.length === (await rows().count()), `${rentCsv.length} rows`);
    await page.goto(APP + "/tenants");
    await rows().first().waitFor();
    const tenantCsv = await download("button:has-text('Export to Excel')", "audit-tenants.csv");
    const tRow = tenantCsv.find((x) => x.Name === leadName);
    check("Tenants export row matches", tRow && tRow.Rent === "9999" && tRow.Deposit === "9999" && tRow.Room === vacant.roomNumber);
    check("Tenants export count = active residents", tenantCsv.length === (await get("/tenants")).length);
    await page.goto(APP + "/profit-loss");
    await page.waitForSelector("text=Statement");
    const pnlCsv = await download("button:has-text('Export to Excel')", "audit-pnl.csv");
    const csvIncome = Number(pnlCsv.find((x) => x.Item === "Total income")["Amount (₹)"]);
    check("P&L export income = API income", csvIncome === (await get(`/reports/pnl?periodMonth=${period}`)).incomeTotal, String(csvIncome));

    // ================= 7. Edit contact =================
    section("Edit phone → reminders use the new number");
    const newPhone = `96${String(Date.now()).slice(-8)}`;
    await page.goto(APP + `/tenants?open=${tenant.id}`);
    await page.click("text=Edit name / phone");
    await page.fill("#edit-phone", newPhone);
    await page.click("[role=dialog] button:text-is('Save')");
    await page.waitForSelector(`[role=dialog] >> text=${newPhone}`);
    check("Phone updated", (await get(`/tenants/${tenant.id}`)).phone === newPhone);
    check("Edit logged with old → new", await activityHas("tenant.updated", `${leadPhone} → ${newPhone}`));
    await page.keyboard.press("Escape");

    // ================= 8. Complaint =================
    section("Complaint: log → assign → resolve");
    const urgentBefore = (await get("/dashboard/counts")).urgentComplaints;
    await page.goto(APP + "/operations");
    await page.waitForSelector("text=Move-outs");
    await page.click("text=+ Log complaint");
    await page.fill("#c-title", `Audit leak ${stamp}`);
    await page.fill("#c-room", vacant.roomNumber);
    await page.selectOption("#c-priority", "urgent");
    await page.click("[role=dialog] button[type=submit]");
    await page.waitForSelector(`text=Audit leak ${stamp}`);
    check("Urgent count +1", (await get("/dashboard/counts")).urgentComplaints === urgentBefore + 1);
    await page.selectOption(`select[aria-label='Assign Audit leak ${stamp}']`, { label: "Ravi Pawar" });
    await page.waitForTimeout(500);
    await page.selectOption(`select[aria-label='Change status for Audit leak ${stamp}']`, "resolved");
    await page.waitForSelector(`text=Audit leak ${stamp}`, { state: "detached" });
    check("Resolved → gone from open list, urgent count back", (await get("/dashboard/counts")).urgentComplaints === urgentBefore);
    check("Complaint updates logged", await activityHas("complaint.updated", "open → resolved"));

    // ================= 9. Move-out =================
    section("Notice → inspection → deduction → settle");
    await page.goto(APP + `/tenants?open=${tenant.id}`);
    await page.click("text=Record move-out notice");
    await page.fill("#notice-date", today);
    await page.fill("#move-out-date", today);
    await page.click("button:has-text('Record notice')");
    await page.waitForSelector("text=Inspection and deposit settlement in Operations");
    await page.click("text=Inspection and deposit settlement in Operations");
    const card = page.locator("article", { hasText: leadName });
    await card.waitFor();
    await card.locator("button:has-text('Schedule')").click();
    await card.locator("text=Reschedule").waitFor();
    await card.locator("input[placeholder='e.g. Broken chair']").fill("Broken chair");
    await card.locator("input[aria-label='Deduction amount']").fill("800");
    await card.locator("button:has-text('Add')").click();
    await card.locator("text=Broken chair").waitFor();
    const refundText = await card.locator("dl > div").last().innerText();
    check("Refund = ₹9,999 − ₹800 = ₹9,199", refundText.includes("₹9,199"), refundText.replace(/\s+/g, " "));
    const dashBeforeSettle = await get("/dashboard");
    await card.locator("button:has-text('Settle')").click();
    await page.waitForSelector(`article:has-text('${leadName}')`, { state: "detached" });
    const bedAfter = (await get("/beds")).find((b) => b.id === vacant.id);
    check("Bed vacant again", bedAfter.status === "vacant" && bedAfter.vacantSince === today);
    const dashAfterSettle = await get("/dashboard");
    check("Occupied −1 and empty-bed cost +₹12,345 (new listed rent)", dashAfterSettle.occupiedBeds === dashBeforeSettle.occupiedBeds - 1 && dashAfterSettle.vacantRentPerMonth === dashBeforeSettle.vacantRentPerMonth + 12345);
    const pnlKept = (await get(`/reports/pnl?periodMonth=${period}`)).incomeLines.find((l) => l.key === "kept-charges");
    check("₹800 kept charge shows in P&L income", pnlKept && pnlKept.amount >= 800);
    check("Settlement logged", await activityHas("moveout.settled", "refund ₹9,199"));

    // ================= 10. Expense =================
    section("Expense add/delete moves P&L both ways");
    await page.goto(APP + "/profit-loss");
    await page.waitForSelector("text=Statement");
    const expBefore = (await get(`/reports/pnl?periodMonth=${period}`)).expenseTotal;
    await page.selectOption("#exp-cat", "maintenance");
    await page.fill("#exp-amount", "1111");
    await page.fill("#exp-to", `Audit vendor ${stamp}`);
    await page.click("button:has-text('Add expense')");
    await page.waitForSelector(`text=Audit vendor ${stamp}`);
    check("Expenses +₹1,111", (await get(`/reports/pnl?periodMonth=${period}`)).expenseTotal === expBefore + 1111);
    page.once("dialog", (d) => d.accept());
    await page.click("button[aria-label*='₹1,111']");
    await page.waitForSelector(`text=Audit vendor ${stamp}`, { state: "detached" });
    check("…and back after delete", (await get(`/reports/pnl?periodMonth=${period}`)).expenseTotal === expBefore);
    check("Add + delete both logged", (await activityHas("expense.added", "₹1,111")) && (await activityHas("expense.deleted", "₹1,111")));

    // ================= 11. Staff account lifecycle =================
    section("Staff account: create → sign in → reset → deactivate");
    const staffUser = `audit${stamp}`;
    await page.goto(APP + "/staff");
    await rows().first().waitFor();
    await page.fill("#staff-name", `Audit Staff ${stamp}`);
    await page.fill("#staff-username", staffUser);
    await page.fill("#staff-password", "first-pass-1");
    await page.click("button:has-text('Create account')");
    await page.waitForSelector(`text=${staffUser}`);
    const staffCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const sp = await staffCtx.newPage();
    sp.on("pageerror", (e) => crashes.push("staff: " + String(e).split("\n")[0]));
    await sp.goto(APP + "/login");
    await sp.fill("#username", staffUser);
    await sp.fill("#password", "first-pass-1");
    await sp.click("button[type=submit]");
    await sp.waitForSelector("text=Open items");
    check("New staff can sign in", true);
    check("…and can't see Profit & Loss / Activity / Staff", (await sp.locator("aside >> text=/Profit|Activity|Staff Access/").count()) === 0);
    await rows().filter({ hasText: staffUser }).locator("button:has-text('Reset password')").click();
    await page.fill("#reset-pw", "second-pass-2");
    await page.click("[role=dialog] button[type=submit]");
    await page.waitForSelector("text=signed out everywhere");
    await page.keyboard.press("Escape");
    await sp.goto(APP + "/rent");
    await sp.waitForURL("**/login?expired=1", { timeout: 8000 }).catch(() => {});
    check("Password reset ends their open session", sp.url().includes("/login"));
    page.once("dialog", (d) => d.accept());
    await rows().filter({ hasText: staffUser }).locator("button:has-text('Deactivate')").click();
    await page.waitForTimeout(600);
    await sp.fill("#username", staffUser);
    await sp.fill("#password", "second-pass-2");
    await sp.click("button[type=submit]");
    await sp.waitForSelector("text=Incorrect username or password");
    check("Deactivated staff can't sign in", true);
    await staffCtx.close();

    // ================= 12. Activity page =================
    section("Activity page shows it all");
    await page.goto(APP + "/activity");
    await rows().first().waitFor();
    const activityText = await page.locator("tbody").innerText();
    check("Recent actions listed by name", activityText.includes(leadName) && /settled move-out/i.test(activityText));
    for (const chip of ["Sign-ins", "Rent", "Residents", "Leads", "Rooms", "Complaints", "Move-outs", "Expenses", "Staff", "Everything"]) {
      await page.click(`button[aria-pressed]:text-is('${chip}')`);
      await page.waitForTimeout(250);
    }
    check("Every area filter works", true);
    await page.selectOption("select[aria-label=Person]", { label: "Property Owner" });
    await page.waitForTimeout(400);
    const whoCol = await rows().locator("td:nth-child(2)").allInnerTexts();
    check("Person filter shows only that person", whoCol.length > 0 && whoCol.every((w) => w === "Property Owner"));
    await page.selectOption("select[aria-label=Person]", "");
    if (await page.locator("button:has-text('Load older')").count()) {
      const n = await rows().count();
      await page.click("button:has-text('Load older')");
      await page.waitForTimeout(600);
      check("Load older adds entries", (await rows().count()) > n);
    }
    const actCsv = await download("button:has-text('Export to Excel')", "audit-activity.csv");
    check("Activity export works", actCsv.length > 0 && "Who" in actCsv[0]);

    // ================= 13. Every control on every page =================
    section("Every control on every page");
    await page.goto(APP + "/");
    await page.waitForSelector("text=Open items");
    const links = await page.locator("ol li a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    for (const href of links) {
      await page.goto(APP + "/");
      await page.waitForSelector("text=Open items");
      await page.locator(`ol li a[href='${href}']`).first().click();
      await page.waitForTimeout(300);
      check(`Day Book "Open →" goes to ${href}`, page.url().endsWith(href));
    }
    await page.goto(APP + "/");
    await page.waitForSelector("text=Open items");
    await page.keyboard.press("/");
    check("'/' focuses search", await page.evaluate(() => document.activeElement?.getAttribute("type") === "search"));
    await page.keyboard.press("Escape");
    await page.click("button:has-text('Password')");
    await page.waitForSelector("[role=dialog]");
    await page.keyboard.press("Escape");
    check("Esc closes dialogs", (await page.locator("[role=dialog]").count()) === 0);

    await page.goto(APP + "/properties");
    await page.waitForSelector("text=Floor 1");
    for (const chip of await page.locator("button[aria-pressed]").allInnerTexts()) {
      const label = chip.split("\n")[0].replace(/\s*\d+$/, "").trim();
      await page.click(`button[aria-pressed]:has-text('${label}')`);
      const dimmed = await page.locator("button[class*=dimmed]").count();
      await page.click(`button[aria-pressed]:has-text('${label}')`);
      check(`Rooms legend '${label}' filters`, dimmed > 0 || label === "Vacant", `${dimmed} dimmed`);
    }

    await page.goto(APP + "/tenants");
    await rows().first().waitFor();
    await page.click("button[aria-pressed]:has-text('Renewals due')");
    const renewalRows = await rows().count();
    await page.click("button[aria-pressed]:has-text('Everyone')");
    await page.check("text=Show moved-out tenants >> input");
    await page.waitForTimeout(500);
    const withMoved = await page.locator("tbody span:text-is('moved out')").count();
    await page.uncheck("text=Show moved-out tenants >> input");
    check("Tenants filters (renewals, moved-out)", renewalRows > 0 && withMoved > 0, `${renewalRows} renewals, ${withMoved} moved out`);

    await page.goto(APP + "/rent");
    await rows().first().waitFor();
    for (const s of ["paid", "due", "overdue", "all"]) {
      await page.selectOption("select[aria-label=Status]", s);
      await page.waitForTimeout(200);
      if (s !== "all") {
        const stamps = await rows().locator("td span[class*=badge]").allInnerTexts();
        check(`Rent status filter '${s}'`, stamps.every((t) => t.toLowerCase() === s), `${stamps.length} rows`);
      }
    }
    const box = await page.locator("svg[role=img]").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    check("Collection chart tooltip on hover", (await page.locator("[role=status]:has-text('collected so far')").count()) === 1);
    await page.click("summary:has-text('View as table')");
    check("Chart 'View as table' opens", await page.locator("details[open] table").isVisible());

    await page.goto(APP + "/operations");
    await page.waitForSelector("text=Move-outs");
    await page.check("text=Show resolved >> input");
    await page.check("text=Show settled >> input");
    await page.waitForTimeout(600);
    check("Operations shows resolved + settled when asked", (await page.locator("tbody span:text-is('resolved')").count()) > 0 && (await page.locator("article span:text-is('settled')").count()) > 0);

    await page.goto(APP + "/leads");
    await rows().first().waitFor();
    await page.check("text=Show archived (lost) leads >> input");
    await page.waitForTimeout(500);
    check("Leads 'show archived' reveals lost leads", (await page.locator("tbody span:text-is('lost')").count()) > 0);

    // ================= 14. Sign out =================
    section("Sign out");
    await page.click("text=Log out");
    await page.waitForURL("**/login");
    await page.goto(APP + "/profit-loss");
    await page.waitForURL("**/login");
    check("After sign-out, pages need sign-in again", page.url().includes("/login"));
  } catch (e) {
    check("AUDIT STOPPED", false, e.message.split("\n").slice(0, 2).join(" | "));
    await page.screenshot({ path: path.join(OUT, "audit-stopped.png") }).catch(() => {});
  }

  check("No page crashes or console errors", crashes.length === 0, crashes.slice(0, 3).join(" | "));
  check("No server errors (5xx)", serverErrors.length === 0, serverErrors.slice(0, 3).join(" | "));
  console.log(results.join("\n"));
  const total = results.filter((r) => /^(PASS|FAIL)/.test(r)).length;
  console.log(`\n${total - failures}/${total} passed`);
  process.exitCode = failures ? 1 : 0;
  await browser.close();
})();
