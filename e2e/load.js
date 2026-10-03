// Load test: many people using the app at the same moment, straight against
// the API. Each virtual user signs in, then loops through realistic reads and
// writes. Reports speed (p50/p95/max) per action and checks that nothing got
// double-counted. Run on a freshly seeded scratch app.
//
//   USERS=50 SECONDS=60 node load.js               realistic: 1.5–4 s "thinking" between clicks
//   MODE=stress USERS=30 SECONDS=30 node load.js   no pauses — each user ≈ 5–10 real people
const { API, OWNER } = require("./config");

const USERS = Number(process.env.USERS ?? 30);
const SECONDS = Number(process.env.SECONDS ?? 30);
const MODE = process.env.MODE ?? "realistic";
const think = () => (MODE === "stress" ? Promise.resolve() : new Promise((r) => setTimeout(r, 1500 + Math.random() * 2500)));

const timings = {}; // action -> [ms]
const statuses = {}; // action -> {status: count}

async function call(action, method, path, body, token, extraHeaders = {}) {
  const started = performance.now();
  let status = 0;
  let json = null;
  try {
    const res = await fetch(API + path, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extraHeaders },
      body: body ? JSON.stringify(body) : undefined,
    });
    status = res.status;
    const text = await res.text();
    json = text ? JSON.parse(text) : null;
  } catch {
    status = -1; // network error / refused
  }
  (timings[action] ??= []).push(performance.now() - started);
  (statuses[action] ??= {})[status] = ((statuses[action] ??= {})[status] ?? 0) + 1;
  return { status, json };
}

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];

(async () => {
  // Setup: create the virtual staff accounts.
  const owner = await call("setup", "POST", "/auth/login", OWNER);
  const ownerToken = owner.json.token;
  const users = [];
  for (let i = 0; i < USERS; i++) {
    const username = `load${Date.now().toString(36)}${i}`;
    await call("setup", "POST", "/staff", { name: `Load User ${i}`, username, password: "load-pass-123", role: "staff" }, ownerToken);
    users.push({ username, password: "load-pass-123" });
  }
  const before = (await call("setup", "GET", "/payments", null, ownerToken)).json;

  console.log(`${USERS} users × ${SECONDS}s against ${API} (${MODE}) …`);
  const deadline = Date.now() + SECONDS * 1000;
  let paymentsAccepted = 0;
  let retriesAnsweredOnce = 0;

  await Promise.all(
    users.map(async (u, i) => {
      // Everyone signs in at the same instant.
      const login = await call("login", "POST", "/auth/login", u);
      const token = login.json?.token;
      if (!token) return;
      while (Date.now() < deadline) {
        await think();
        const roll = Math.random();
        if (roll < 0.25) await call("dashboard", "GET", "/dashboard", null, token);
        else if (roll < 0.4) await call("beds", "GET", "/beds", null, token);
        else if (roll < 0.55) await call("rent list", "GET", "/payments?status=overdue", null, token);
        else if (roll < 0.65) await call("search", "GET", `/search?q=${pick(["ar", "10", "98", "sh", "ki"])}`, null, token);
        else if (roll < 0.72) await call("tenants", "GET", "/tenants", null, token);
        else if (roll < 0.8) {
          await call("add lead", "POST", "/leads", { name: `Load Lead ${i}`, phone: `98${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, source: "google" }, token);
        } else if (roll < 0.95) {
          // Everyone fights over the same few unpaid months, ₹500 at a time —
          // the worst case for double-counting.
          const unpaid = (await call("rent list", "GET", "/payments?status=overdue", null, token)).json ?? [];
          if (!unpaid.length) continue;
          const target = pick(unpaid.slice(0, 3));
          const key = `${u.username}-${Date.now()}-${Math.random()}`;
          const first = await call("record payment", "POST", `/payments/${target.id}/transactions`, { amount: 500, paidDate: target.dueDate > new Date().toISOString().slice(0, 10) ? new Date().toISOString().slice(0, 10) : target.dueDate, method: "cash" }, token, { "Idempotency-Key": key });
          if (first.status === 201) {
            paymentsAccepted++;
            // A "network retry" of the same click must not pay twice.
            const retry = await call("payment retry", "POST", `/payments/${target.id}/transactions`, { amount: 500, paidDate: target.dueDate, method: "cash" }, token, { "Idempotency-Key": key });
            if (retry.status === 201) retriesAnsweredOnce++;
          }
        } else await call("counts", "GET", "/dashboard/counts", null, token);
      }
    })
  );

  // ---- Report ----
  const totalCalls = Object.entries(timings).filter(([a]) => a !== "setup").reduce((n, [, xs]) => n + xs.length, 0);
  console.log(`\n${totalCalls} requests in ${SECONDS}s ≈ ${(totalCalls / SECONDS).toFixed(1)} requests/second`);
  console.log("\naction            calls   p50 ms   p95 ms   max ms   statuses");
  for (const [action, xs] of Object.entries(timings).filter(([a]) => a !== "setup")) {
    const st = Object.entries(statuses[action]).map(([s, n]) => `${s}×${n}`).join(" ");
    console.log(`${action.padEnd(16)} ${String(xs.length).padStart(6)} ${pct(xs, 50).toFixed(0).padStart(8)} ${pct(xs, 95).toFixed(0).padStart(8)} ${Math.max(...xs).toFixed(0).padStart(8)}   ${st}`);
  }

  // ---- Integrity after the storm ----
  const after = (await call("verify", "GET", "/payments", null, ownerToken)).json;
  const overPaid = after.filter((r) => r.amountPaid > r.amountDue + 0.001);
  const paidDelta = after.reduce((s, r) => s + r.amountPaid, 0) - before.reduce((s, r) => s + r.amountPaid, 0);
  const serverErrors = Object.entries(statuses).filter(([a]) => a !== "setup").reduce((n, [, st]) => n + Object.entries(st).filter(([s]) => Number(s) >= 500 || Number(s) === -1).reduce((m, [, c]) => m + c, 0), 0);
  const checks = [
    ["No server errors or dropped connections", serverErrors === 0, `${serverErrors}`],
    ["Every sign-in succeeded", (statuses.login?.[200] ?? 0) === USERS, `${statuses.login?.[200] ?? 0}/${USERS}`],
    ["No month over-paid", overPaid.length === 0, `${overPaid.length}`],
    ["Money in = accepted payments × ₹500 (nothing double-counted)", Math.abs(paidDelta - paymentsAccepted * 500) < 0.01, `₹${paidDelta} vs ${paymentsAccepted}×₹500`],
    ["Every retry answered from the first attempt", retriesAnsweredOnce === paymentsAccepted, `${retriesAnsweredOnce}/${paymentsAccepted}`],
  ];
  console.log("");
  for (const [name, ok, detail] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}  — ${detail}`);
  process.exitCode = checks.every(([, ok]) => ok) ? 0 : 1;
})();
