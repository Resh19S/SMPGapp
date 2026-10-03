// Layout QA: every page + dialog at three laptop widths. Flags horizontal page
// scroll, clipped text, boxes leaking out of their card, and overlapping
// siblings. Screenshots go to output/layout/. Scratch app only — see README.
// Known false positive: the receipt's rotated stamp reports an "overlap".
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

const { APP, CHROME, OUT: BASE_OUT } = require("./config");
const OUT = path.join(BASE_OUT, "layout");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const WIDTHS = [1440, 1280, 1024];
const only = process.argv[2]; // optional: run one width

// Runs in the page. Returns human-readable problems.
function detect() {
  const problems = [];
  const label = (el) => {
    const cls = typeof el.className === "string" ? el.className.split(" ").filter(Boolean).map((c) => c.replace(/^_|_[a-z0-9]{5}_\d+$/g, "")).join(".") : "";
    const text = (el.innerText || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 40);
    return `<${el.tagName.toLowerCase()}${cls ? "." + cls : ""}>${text ? ` "${text}"` : ""}`;
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0";
  };
  const inScroller = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll)/.test(cs.overflowX + cs.overflowY) && p !== document.documentElement && p !== document.body) return true;
    }
    return false;
  };
  const floating = (el) => {
    for (let p = el; p; p = p.parentElement) {
      const pos = getComputedStyle(p).position;
      if (pos === "absolute" || pos === "fixed") return true;
    }
    return false;
  };

  // 1. Page scrolls sideways.
  if (document.documentElement.scrollWidth > window.innerWidth + 1) {
    problems.push(`page scrolls sideways (${document.documentElement.scrollWidth}px > ${window.innerWidth}px)`);
  }

  const all = [...document.querySelectorAll("body *")].filter(visible);

  // 2. Clipped text: content wider than its box, clipped, with no ellipsis.
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (["INPUT", "SELECT", "TEXTAREA", "svg", "path"].includes(el.tagName)) continue;
    const clips = cs.overflowX === "hidden" || cs.overflowX === "clip";
    if (clips && el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== "ellipsis" && el.innerText?.trim()) {
      problems.push(`clipped text in ${label(el)} (${el.scrollWidth} > ${el.clientWidth})`);
    }
  }

  // 3. Leaking boxes: a descendant sticking out of its card/panel/dialog/tile.
  const containers = all.filter((el) => {
    const cs = getComputedStyle(el);
    const bordered = parseFloat(cs.borderTopWidth) > 0 && parseFloat(cs.borderLeftWidth) > 0;
    return bordered && el.getBoundingClientRect().width > 120 && !["INPUT", "SELECT", "TEXTAREA", "BUTTON", "A"].includes(el.tagName);
  });
  for (const box of containers) {
    const br = box.getBoundingClientRect();
    for (const child of box.querySelectorAll("*")) {
      if (!visible(child) || floating(child) || inScroller(child) && !inScroller(box)) continue;
      if (["svg", "path", "line", "circle", "text", "g"].includes(child.tagName)) continue;
      const cr = child.getBoundingClientRect();
      if (cr.right > br.right + 1.5 || cr.left < br.left - 1.5) {
        problems.push(`${label(child)} leaks out of ${label(box)} by ${Math.round(Math.max(cr.right - br.right, br.left - cr.left))}px`);
        break; // one report per container is enough
      }
    }
  }

  // 4. Overlapping siblings in flex/grid rows (e.g. buttons on top of text).
  for (const parent of all) {
    const cs = getComputedStyle(parent);
    if (!/(flex|grid)/.test(cs.display)) continue;
    const kids = [...parent.children].filter((k) => visible(k) && !floating(k) && getComputedStyle(k).position !== "absolute");
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i].getBoundingClientRect();
        const b = kids[j].getBoundingClientRect();
        const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (overlapX > 2 && overlapY > 2) problems.push(`${label(kids[i])} overlaps ${label(kids[j])}`);
      }
    }
  }
  return [...new Set(problems)];
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  process.exitCode = 0;
  const report = {};
  const crashes = [];

  for (const width of WIDTHS.filter((w) => !only || String(w) === only)) {
    const page = await browser.newPage({ viewport: { width, height: 860 }, locale: "en-IN" });
    page.on("pageerror", (e) => crashes.push(`${width}: ${String(e).split("\n")[0]}`));
    const shot = async (name) => {
      await page.waitForTimeout(350);
      const problems = await page.evaluate(detect);
      report[`${width} ${name}`] = problems;
      await page.screenshot({ path: path.join(OUT, `${width}-${name}.png`), fullPage: true });
    };

    await page.goto(APP + "/login");
    await shot("login");
    await page.fill("#username", "owner");
    await page.fill("#password", "owner123");
    await page.click("button[type=submit]");
    await page.waitForURL(APP + "/");
    await page.waitForSelector("text=Open items");

    const pages = [
      ["daybook", "/", "text=Open items"],
      ["leads", "/leads", "tbody tr"],
      ["rooms", "/properties", "text=Floor 1"],
      ["tenants", "/tenants", "tbody tr"],
      ["renewals", "/tenants?filter=renewals", "tbody tr"],
      ["rent", "/rent", "text=Recent collections"],
      ["operations", "/operations", "text=Move-outs"],
      ["pnl", "/profit-loss", "text=Statement"],
      ["staff", "/staff", "tbody tr"],
    ];
    for (const [name, url, ready] of pages) {
      await page.goto(APP + url);
      await page.waitForSelector(ready);
      await page.waitForTimeout(600); // badges + charts settle
      await shot(name);
    }

    // Dialogs and overlays.
    const dialogs = [
      ["dlg-add-lead", "/leads", async () => page.click("text=+ Add lead")],
      ["dlg-lead-movein", "/leads", async () => page.locator("button:has-text('Move in')").first().click()],
      ["dlg-move-in", "/tenants", async () => page.click("text=+ Move in tenant")],
      ["dlg-tenant", "/tenants", async () => page.locator("div[class*=tableWrap] tbody tr").first().click()],
      ["dlg-tenant-renew", "/tenants?filter=renewals", async () => {
        await page.locator("div[class*=tableWrap] tbody tr").first().click();
        await page.click("text=Renew agreement");
      }],
      ["dlg-tenant-notice", "/tenants", async () => {
        await page.locator("div[class*=tableWrap] tbody tr").nth(4).click();
        await page.click("text=Record move-out notice");
      }],
      ["dlg-import", "/tenants", async () => {
        await page.click("text=Import from Excel");
        const csv = [
          "Name,Phone,Room,Bed,Move-in date,Rent due day,Rent,Deposit,Agreement ends",
          "Good Row,9822044556,101,C,01/09/2026,5,9500,9500,31/08/2027",
          "Bad Phone With A Rather Long Name,12345,999,Z,01/09/2026,5,,9500,01/01/2026",
        ].join("\n");
        await page.setInputFiles("input[type=file]", { name: "tenants.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
        await page.waitForSelector("text=rows need fixing");
      }],
      ["dlg-record-payment", "/rent", async () => page.locator("button:has-text('Record payment')").first().click()],
      ["dlg-add-rooms", "/properties", async () => {
        await page.click("text=+ Add rooms");
        await page.fill("#bulk-rooms", "401-408");
        await page.fill("#bulk-rent", "11000");
      }],
      ["dlg-add-bed", "/properties", async () => page.click("text=+ Add one bed")],
      ["dlg-bed", "/properties", async () => page.locator("button[aria-label^='Room 101 bed A']").click()],
      ["dlg-complaint", "/operations", async () => page.click("text=+ Log complaint")],
      ["dlg-password", "/", async () => page.click("button:has-text('Password')")],
      ["dlg-reset-password", "/staff", async () => page.locator("button:has-text('Reset password')").first().click()],
      ["search-open", "/", async () => {
        await page.fill("input[type=search]", "ar");
        await page.waitForSelector("[role=listbox] li[role=option]");
      }],
    ];
    for (const [name, url, open] of dialogs) {
      await page.goto(APP + url);
      await page.waitForTimeout(700);
      try {
        await open();
        await shot(name);
      } catch (e) {
        report[`${width} ${name}`] = [`COULD NOT OPEN: ${String(e).split("\n")[0]}`];
      }
      await page.keyboard.press("Escape");
    }

    // Receipt page.
    await page.goto(APP + "/rent");
    await page.waitForSelector("text=Recent collections");
    await page.locator("a[href^='/receipts/']").first().click();
    await page.waitForSelector("text=Rent receipt");
    await shot("receipt");
    await page.close();
  }

  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  const flagged = Object.entries(report).filter(([, p]) => p.length);
  for (const [k, p] of flagged) console.log(`\n## ${k}\n  - ${p.join("\n  - ")}`);
  console.log(`\n${Object.keys(report).length} screens checked, ${flagged.length} with findings, ${crashes.length} crashes`);
  if (crashes.length) console.log(crashes.join("\n"));
  await browser.close();
})();
