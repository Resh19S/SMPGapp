import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, createExpense, deleteExpense, fetchProfitAndLoss, listExpenses } from "../api/client";
import type { Expense, ExpenseCategory, ProfitAndLoss } from "../types/contract";
import { StatTile } from "../components/common/StatTile";
import { NetTrendChart } from "../components/pnl/NetTrendChart";
import { currentMonthISO, formatDate, inr, inrCompact, monthLabel, shiftPeriod, todayISO } from "../lib/format";
import { downloadCsv } from "../lib/csv";
import formStyles from "../components/common/Form.module.css";
import pageStyles from "./PageLayout.module.css";
import styles from "./ProfitLossPage.module.css";

export const EXPENSE_CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: "lease", label: "Building lease" },
  { value: "electricity", label: "Electricity" },
  { value: "water", label: "Water" },
  { value: "internet", label: "Internet" },
  { value: "salaries", label: "Staff salaries" },
  { value: "food", label: "Food & groceries" },
  { value: "cleaning", label: "Cleaning & supplies" },
  { value: "maintenance", label: "Repairs & maintenance" },
  { value: "taxes", label: "Taxes & fees" },
  { value: "other", label: "Other" },
];
const CATEGORY_LABEL = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c.value, c.label])) as Record<ExpenseCategory, string>;

function signed(amount: number): string {
  return `${amount < 0 ? "−" : ""}${inr(Math.abs(amount))}`;
}

export function ProfitLossPage() {
  const thisMonth = currentMonthISO();
  const months = Array.from({ length: 12 }, (_, i) => shiftPeriod(thisMonth, -i));
  const [period, setPeriod] = useState(thisMonth);
  const [pnl, setPnl] = useState<ProfitAndLoss | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [spentOn, setSpentOn] = useState(todayISO);
  const [category, setCategory] = useState<ExpenseCategory>("electricity");
  const [amount, setAmount] = useState("");
  const [paidTo, setPaidTo] = useState("");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const latestRequest = useRef(0);

  function load(p: string) {
    const requestId = ++latestRequest.current;
    Promise.all([fetchProfitAndLoss(p), listExpenses(p)])
      .then(([report, list]) => {
        if (requestId !== latestRequest.current) return; // an older month's answer arrived late
        setPnl(report);
        setExpenses(list);
        setError(null);
      })
      .catch(() => setError("Could not load profit & loss."));
  }

  useEffect(() => load(period), [period]);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const value = Number(amount);
    if (!value || value <= 0) {
      setFormError("Enter the amount spent.");
      return;
    }
    setIsSaving(true);
    try {
      await createExpense({ spentOn, category, amount: value, paidTo: paidTo.trim(), description: description.trim() });
      setAmount("");
      setPaidTo("");
      setDescription("");
      const addedPeriod = spentOn.slice(0, 7);
      if (addedPeriod === period) load(period);
      else setPeriod(addedPeriod); // jump to the month the expense landed in
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not save the expense.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(expense: Expense) {
    if (!window.confirm(`Delete ${inr(expense.amount)} ${CATEGORY_LABEL[expense.category].toLowerCase()} on ${formatDate(expense.spentOn)}?`)) return;
    try {
      await deleteExpense(expense.id);
      load(period);
    } catch {
      setError("Could not delete the expense.");
    }
  }

  const delta = pnl?.previous ? pnl.net - pnl.previous.net : null;

  function exportCsv() {
    if (!pnl) return;
    downloadCsv(`profit-and-loss-${pnl.periodMonth}`, ["Section", "Item", "Date", "Paid to", "Amount (₹)"], [
      ...pnl.incomeLines.map((l) => ["Income", l.label, "", "", l.amount]),
      ["Income", "Total income", "", "", pnl.incomeTotal],
      ...expenses.map((x) => ["Expense", `${CATEGORY_LABEL[x.category]}${x.description ? ` — ${x.description}` : ""}`, formatDate(x.spentOn), x.paidTo, x.amount]),
      ["Expense", "Total expenses", "", "", pnl.expenseTotal],
      [pnl.net < 0 ? "Net loss" : "Net profit", monthLabel(pnl.periodMonth), "", "", pnl.net],
    ]);
  }

  return (
    <div>
      <div className={pageStyles.header}>
        <div>
          <h1 className={pageStyles.title}>Profit &amp; Loss</h1>
          <p className={pageStyles.subtitle}>Owner only. Money that actually came in against what went out — deposits aren't income until they're kept.</p>
        </div>
        <div className={pageStyles.headerActions}>
          <button className={pageStyles.secondaryAction} onClick={exportCsv} disabled={!pnl}>
            Export to Excel
          </button>
          <select className={styles.select} value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Month">
            {months.map((m) => (
              <option key={m} value={m}>{monthLabel(m)}</option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className={pageStyles.error}>{error}</p>}

      {pnl && (
        <>
          <div className={styles.tiles}>
            <StatTile label="Income" value={inrCompact(pnl.incomeTotal)} sub={pnl.collectionRatePct !== null ? `${pnl.collectionRatePct}% of ${inrCompact(pnl.rentBilled)} rent collected` : "No rent billed"} />
            <StatTile label="Expenses" value={inrCompact(pnl.expenseTotal)} sub={`${expenses.length} entr${expenses.length === 1 ? "y" : "ies"}`} />
            <StatTile
              label={pnl.net < 0 ? "Net loss" : "Net profit"}
              value={`${pnl.net < 0 ? "−" : ""}${inrCompact(Math.abs(pnl.net))}`}
              sub={delta === null ? "" : `${delta >= 0 ? "▲" : "▼"} ${inr(Math.abs(delta))} vs ${monthLabel(pnl.previous!.periodMonth).split(" ")[0]}`}
            />
            <StatTile label="Margin" value={pnl.marginPct === null ? "—" : `${pnl.marginPct}%`} sub="Net as a share of income" />
          </div>

          <div className={styles.columns}>
            <section className={`${pageStyles.panel} ${styles.statement}`} aria-label="Statement">
              <h2 className={pageStyles.panelTitle}>
                Statement — {monthLabel(pnl.periodMonth)}
                {pnl.periodMonth === thisMonth && <span className={styles.mtd}> · month to date ({formatDate(todayISO()).slice(0, 5)})</span>}
              </h2>
              {pnl.periodMonth === thisMonth && (
                <p className={styles.mtdNote}>
                  The month isn't over: fixed costs like the lease are usually paid early, while rent keeps arriving — the
                  figures settle by month end.
                </p>
              )}
              <table className={styles.ledger}>
                <tbody>
                  <tr className={styles.groupRow}><th colSpan={2}>Income</th></tr>
                  {pnl.incomeLines.map((l) => (
                    <tr key={l.key}><td>{l.label}</td><td>{inr(l.amount)}</td></tr>
                  ))}
                  <tr className={styles.subtotal}><td>Total income</td><td>{inr(pnl.incomeTotal)}</td></tr>

                  <tr className={styles.groupRow}><th colSpan={2}>Expenses</th></tr>
                  {pnl.expenseLines.length === 0 ? (
                    <tr><td className={styles.none} colSpan={2}>No expenses logged for this month yet.</td></tr>
                  ) : (
                    pnl.expenseLines.map((l) => (
                      <tr key={l.key}><td>{l.label}</td><td>{inr(l.amount)}</td></tr>
                    ))
                  )}
                  <tr className={styles.subtotal}><td>Total expenses</td><td>{inr(pnl.expenseTotal)}</td></tr>

                  <tr className={`${styles.net} ${pnl.net < 0 ? styles.netLoss : ""}`}>
                    <td>{pnl.net < 0 ? "Net loss" : "Net profit"}</td>
                    <td>{signed(pnl.net)}</td>
                  </tr>
                </tbody>
              </table>
            </section>

            <div className={styles.side}>
              <section className={pageStyles.panel}>
                <h2 className={pageStyles.panelTitle}>Log an expense</h2>
                <form onSubmit={handleAdd}>
                  {formError && <div className={formStyles.error}>{formError}</div>}
                  <div className={formStyles.row}>
                    <div className={formStyles.field}>
                      <label className={formStyles.label} htmlFor="exp-cat">Category</label>
                      <select id="exp-cat" className={formStyles.select} value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)}>
                        {EXPENSE_CATEGORIES.map((c) => (
                          <option key={c.value} value={c.value}>{c.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className={formStyles.field}>
                      <label className={formStyles.label} htmlFor="exp-amount">Amount (₹)</label>
                      <input id="exp-amount" type="number" min="1" className={formStyles.input} value={amount} onChange={(e) => setAmount(e.target.value)} required />
                    </div>
                  </div>
                  <div className={formStyles.row}>
                    <div className={formStyles.field}>
                      <label className={formStyles.label} htmlFor="exp-date">Paid on</label>
                      <input id="exp-date" type="date" max={todayISO()} className={formStyles.input} value={spentOn} onChange={(e) => setSpentOn(e.target.value)} required />
                    </div>
                    <div className={formStyles.field}>
                      <label className={formStyles.label} htmlFor="exp-to">Paid to</label>
                      <input id="exp-to" className={formStyles.input} value={paidTo} onChange={(e) => setPaidTo(e.target.value)} placeholder="e.g. MSEDCL" />
                    </div>
                  </div>
                  <div className={formStyles.field}>
                    <label className={formStyles.label} htmlFor="exp-desc">Note (optional)</label>
                    <input id="exp-desc" className={formStyles.input} value={description} onChange={(e) => setDescription(e.target.value)} />
                  </div>
                  <button type="submit" className={formStyles.buttonPrimary} disabled={isSaving}>
                    {isSaving ? "Saving…" : "Add expense"}
                  </button>
                </form>
              </section>

              <section className={pageStyles.panel}>
                <h2 className={pageStyles.panelTitle}>Expenses — {monthLabel(period)}</h2>
                {expenses.length === 0 ? (
                  <p className={pageStyles.muted}>Nothing logged yet.</p>
                ) : (
                  <ul className={styles.expenseList}>
                    {expenses.map((x) => (
                      <li key={x.id}>
                        <span className={styles.expenseText}>
                          {CATEGORY_LABEL[x.category]}
                          <span className={styles.expenseMeta}>
                            {formatDate(x.spentOn)}{x.paidTo ? ` · ${x.paidTo}` : ""}{x.description ? ` · ${x.description}` : ""}
                          </span>
                        </span>
                        <span className={styles.expenseAmount}>{inr(x.amount)}</span>
                        <button className={styles.delete} onClick={() => handleDelete(x)} aria-label={`Delete ${CATEGORY_LABEL[x.category]} ${inr(x.amount)}`}>
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>

          <section className={pageStyles.panel} style={{ marginTop: "var(--space-4)" }}>
            <h2 className={pageStyles.panelTitle}>Net profit — last 6 months</h2>
            <NetTrendChart months={pnl.trend} selected={period} onSelect={setPeriod} />
          </section>
        </>
      )}
    </div>
  );
}
