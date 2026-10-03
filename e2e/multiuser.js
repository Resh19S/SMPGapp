// Several people signed in at once, in separate browsers, doing conflicting
// things at the same moment. Proves the screen tells each person the truth
// and the data stays correct. Run on a freshly seeded scratch app.
const { chromium } = require("playwright-core");
const { APP, API, CHROME, OWNER, STAFF } = require("./config");

const RAVI = { username: "ravi", password: "ravi1234" };
const results = [];
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

async function api(method, p, body, token) {
  const res = await fetch(API + p, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const crashes = [];
  async function person(creds, label) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    page.on("pageerror", (e) => crashes.push(`${label}: ${String(e).split("\n")[0]}`));
    await page.goto(APP + "/login");
    await page.fill("#username", creds.username);
    await page.fill("#password", creds.password);
    await page.click("button[type=submit]");
    await page.waitForSelector("text=Open items");
    return { page, context, token: await page.evaluate(() => sessionStorage.getItem("token")) };
  }
  const rows = (page) => page.locator("div[class*=tableWrap] tbody tr");

  try {
    // Owner, front desk and Ravi all signed in at the same time.
    const [owner, desk, ravi] = await Promise.all([person(OWNER, "owner"), person(STAFF, "desk"), person(RAVI, "ravi")]);
    check("Three people signed in at once", !!(owner.token && desk.token && ravi.token));
    const ownerTabTwo = await person(OWNER, "owner-tab-2");
    check("Same person signed in on two devices", !!ownerTabTwo.token);

    // 1. Both staff record the same rent at the same moment.
    const period = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).slice(0, 7);
    const target = (await api("GET", "/payments?status=overdue", null, owner.token)).body[0];
    const paidBefore = (await api("GET", "/payments", null, owner.token)).body
      .filter((r) => r.tenantId === target.tenantId)
      .reduce((sum, r) => sum + r.amountPaid, 0);
    for (const p of [desk.page, ravi.page]) {
      await p.goto(APP + "/rent");
      await rows(p).first().waitFor();
      await p.selectOption("select[aria-label=Month]", "all");
      await p.waitForTimeout(500);
      await p.selectOption("select[aria-label=Status]", "overdue");
      await p.waitForTimeout(300);
      await rows(p).filter({ hasText: target.tenantName }).filter({ hasText: target.roomNumber }).first().locator("button:has-text('Record payment')").click();
      await p.waitForSelector("#paid-amount");
    }
    await Promise.all([desk.page.click("button:has-text('Mark as paid')"), ravi.page.click("button:has-text('Mark as paid')")]);
    await Promise.all([desk.page.waitForTimeout(1500), ravi.page.waitForTimeout(1500)]);
    // Both clicked the same row (whichever month the screen listed first): the
    // resident's total paid must rise by ONE month's rent, not two.
    const paidAfter = (await api("GET", "/payments", null, owner.token)).body
      .filter((r) => r.tenantId === target.tenantId)
      .reduce((sum, r) => sum + r.amountPaid, 0);
    check("Same rent paid by two staff at once → counted once", paidAfter - paidBefore === target.amountDue, `paid ₹${paidAfter - paidBefore} (one month = ₹${target.amountDue})`);
    const deskErr = await desk.page.locator("[role=dialog] div[class*=error]").count();
    const raviErr = await ravi.page.locator("[role=dialog] div[class*=error]").count();
    check("The slower one is told it's already paid (no silent double)", deskErr + raviErr === 1, `errors shown: desk ${deskErr}, ravi ${raviErr}`);
    for (const p of [desk.page, ravi.page]) await p.keyboard.press("Escape");

    // 2. Both staff move different people into the same empty bed at once.
    const bed = (await api("GET", "/beds", null, owner.token)).body.find((b) => b.rentState === "vacant");
    for (const [p, name, phone] of [[desk.page, "Race Person One", "9811122201"], [ravi.page, "Race Person Two", "9811122202"]]) {
      await p.goto(APP + "/tenants");
      await rows(p).first().waitFor();
      await p.click("text=+ Move in tenant");
      await p.fill("#tenant-name", name);
      await p.fill("#tenant-phone", phone);
      await p.selectOption("#tenant-bed", String(bed.id));
      await p.fill("#tenant-deposit", "5000");
    }
    await Promise.all([desk.page.click("[role=dialog] button[type=submit]"), ravi.page.click("[role=dialog] button[type=submit]")]);
    await Promise.all([desk.page.waitForTimeout(1500), ravi.page.waitForTimeout(1500)]);
    const inBed = (await api("GET", "/tenants", null, owner.token)).body.filter((t) => t.bedId === bed.id);
    check("Same bed booked by two staff at once → one resident", inBed.length === 1, inBed.map((t) => t.name).join(", "));
    const occupiedMsg = (await desk.page.locator("text=already occupied").count()) + (await ravi.page.locator("text=already occupied").count());
    check("The other sees 'Bed is already occupied'", occupiedMsg === 1);
    for (const p of [desk.page, ravi.page]) await p.keyboard.press("Escape");

    // 3. Different edits to the same resident at once both survive.
    const resident = inBed[0];
    const [renewRes, editRes] = await Promise.all([
      api("POST", `/tenants/${resident.id}/renewals`, { newExpiry: "2028-06-30", newRent: 9999, effectiveFrom: period }, owner.token),
      api("PATCH", `/tenants/${resident.id}`, { phone: "9811122299" }, desk.token),
    ]);
    const merged = (await api("GET", `/tenants/${resident.id}`, null, owner.token)).body;
    check("Owner renews while staff edits phone → both kept", renewRes.status === 201 && editRes.status === 200 && merged.phone === "9811122299" && merged.agreementExpiry === "2028-06-30");

    // 4. Live monitoring: owner watches Activity while staff work.
    await owner.page.goto(APP + "/activity");
    await rows(owner.page).first().waitFor();
    await desk.page.goto(APP + "/operations");
    await desk.page.waitForSelector("text=Move-outs");
    await desk.page.click("text=+ Log complaint");
    await desk.page.fill("#c-title", "Multiuser fan noise");
    await desk.page.click("[role=dialog] button[type=submit]");
    await desk.page.waitForSelector("text=Multiuser fan noise");
    await owner.page.click("button:has-text('Refresh')");
    await owner.page.waitForTimeout(600);
    const top = await rows(owner.page).first().innerText();
    check("Owner sees staff's action appear in Activity", top.includes("Front Desk Staff") && top.includes("Multiuser fan noise"), top.replace(/\s+/g, " ").slice(0, 80));
    await owner.page.goto(APP + "/operations");
    await owner.page.waitForSelector("text=Multiuser fan noise");
    check("…and on their Operations page", true);

    // 5. Changing your password on one device signs out the other.
    await ownerTabTwo.page.click("button:has-text('Password')");
    await ownerTabTwo.page.fill("#pw-current", OWNER.password);
    await ownerTabTwo.page.fill("#pw-new", "owner-temp-pass-9");
    await ownerTabTwo.page.fill("#pw-confirm", "owner-temp-pass-9");
    await ownerTabTwo.page.click("[role=dialog] button[type=submit]");
    await ownerTabTwo.page.waitForSelector("text=Password changed");
    await ownerTabTwo.page.keyboard.press("Escape");
    await owner.page.goto(APP + "/rent");
    await owner.page.waitForURL("**/login?expired=1", { timeout: 8000 }).catch(() => {});
    check("Password change on device B signs out device A", owner.page.url().includes("/login"));
    await ownerTabTwo.page.goto(APP + "/rent");
    await ownerTabTwo.page.waitForSelector("text=Rent Tracker");
    check("…while device B stays signed in", !ownerTabTwo.page.url().includes("/login"));
    // put the owner password back for other runs
    const back = await api("POST", "/auth/change-password", { currentPassword: "owner-temp-pass-9", newPassword: OWNER.password }, await ownerTabTwo.page.evaluate(() => sessionStorage.getItem("token")));
    check("(owner password restored)", back.status === 200);

    // 6. Deactivating someone mid-session throws them out on their next click.
    const ownerToken = back.body.token;
    const raviId = (await api("GET", "/staff", null, ownerToken)).body.find((s) => s.username === "ravi").id;
    await api("PATCH", `/staff/${raviId}/deactivate`, null, ownerToken);
    await ravi.page.goto(APP + "/tenants");
    await ravi.page.waitForURL("**/login?expired=1", { timeout: 8000 }).catch(() => {});
    check("Deactivated mid-session → back to sign-in", ravi.page.url().includes("/login"));
    const raviLogin = await api("POST", "/auth/login", RAVI);
    check("…and can't sign in again", raviLogin.status === 401);

    // 7. A staff member can't reach owner pages even by typing the address.
    for (const pathName of ["/profit-loss", "/activity", "/staff"]) {
      await desk.page.goto(APP + pathName);
      await desk.page.waitForTimeout(400);
      check(`Staff typing ${pathName} is redirected`, !desk.page.url().endsWith(pathName));
    }
    const forged = await api("GET", "/reports/pnl", null, desk.token);
    check("…and the server refuses them too (403)", forged.status === 403);

    // Final integrity check after all the racing.
    const all = (await api("GET", "/payments", null, ownerToken)).body;
    check("No rent month over-paid anywhere", all.every((r) => r.amountPaid <= r.amountDue));
  } catch (e) {
    check("MULTI-USER RUN STOPPED", false, e.message.split("\n").slice(0, 2).join(" | "));
  }
  check("No page crashes in any browser", crashes.length === 0, crashes.slice(0, 3).join(" | "));
  console.log(results.join("\n"));
  console.log(`\n${results.length - failures}/${results.length} passed`);
  process.exitCode = failures ? 1 : 0;
  await browser.close();
})();
