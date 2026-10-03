import { useEffect, useMemo, useRef, useState } from "react";
import { fetchRentSummary, listPayments, listTransactions, recordPayment } from "../api/client";
import type { ManualPaymentMethod, PaymentStatus, PaymentTransaction, RentRecord, RentSummary } from "../types/contract";
import { RentTable } from "../components/rent/RentTable";
import { RecordPaymentModal } from "../components/rent/RecordPaymentModal";
import { CollectionChart } from "../components/rent/CollectionChart";
import { StatTile } from "../components/common/StatTile";
import { currentMonthISO, formatDate, inr, inrCompact, monthLabel } from "../lib/format";
import pageStyles from "./PageLayout.module.css";
import styles from "./RentTrackerPage.module.css";

const METHOD_LABEL: Record<PaymentTransaction["method"], string> = {
  cash: "Cash",
  upi: "UPI",
  bank: "Bank transfer",
  other: "Other",
  deposit: "From deposit",
};

export function RentTrackerPage() {
  const currentMonth = currentMonthISO();
  const [records, setRecords] = useState<RentRecord[]>([]);
  const [summary, setSummary] = useState<RentSummary | null>(null);
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [periodFilter, setPeriodFilter] = useState<string>(currentMonth);
  const [statusFilter, setStatusFilter] = useState<PaymentStatus | "all">("all");
  const [selectedRecord, setSelectedRecord] = useState<RentRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const period = periodFilter === "all" ? null : periodFilter;
  const latestSummaryRequest = useRef(0);

  function loadSummary() {
    const requestId = ++latestSummaryRequest.current;
    Promise.all([fetchRentSummary(period), listTransactions({ periodMonth: period ?? undefined, limit: 8 })])
      .then(([s, txs]) => {
        // Switching months quickly can land answers out of order; only the latest request counts.
        if (requestId !== latestSummaryRequest.current) return;
        setSummary(s);
        setTransactions(txs);
      })
      .catch(() => {
        if (requestId === latestSummaryRequest.current) setError("Could not load the rent summary.");
      });
  }

  useEffect(() => {
    setIsLoading(true);
    listPayments()
      .then((data) => {
        setRecords(data);
        setError(null);
      })
      .catch(() => setError("Could not load rent records."))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(loadSummary, [periodFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const periods = useMemo(() => {
    const set = new Set(records.map((r) => r.periodMonth));
    set.add(currentMonth);
    return [...set].sort().reverse();
  }, [records, currentMonth]);

  // Unpaid first (overdue, then due), so what needs chasing is at the top.
  const filtered = useMemo(() => {
    const rank: Record<PaymentStatus, number> = { overdue: 0, due: 1, paid: 2 };
    return records
      .filter((r) => (period === null || r.periodMonth === period) && (statusFilter === "all" || r.status === statusFilter))
      .sort((a, b) => rank[a.status] - rank[b.status] || a.dueDate.localeCompare(b.dueDate));
  }, [records, period, statusFilter]);

  async function handleRecordPayment(
    paymentId: number,
    data: { amount: number; paidDate: string; method: ManualPaymentMethod; note: string },
    idempotencyKey: string
  ) {
    const updated = await recordPayment(paymentId, data, idempotencyKey);
    setRecords((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    loadSummary();
  }

  const collectedPct = summary && summary.billed ? Math.round((summary.collected / summary.billed) * 100) : 0;
  // Until the new month's figures arrive, `summary` still describes the previous
  // selection (e.g. "All months"). Keep showing it, faded, but never feed it to
  // the chart as if it were this month.
  const summaryIsCurrent = summary !== null && summary.periodMonth === period;

  return (
    <div>
      <div className={pageStyles.header}>
        <div>
          <h1 className={pageStyles.title}>Rent Tracker</h1>
          <p className={pageStyles.subtitle}>Computed from move-in dates and the payment log — never hand-maintained.</p>
        </div>
      </div>

      <div className={pageStyles.filterBar}>
        <select className={styles.select} value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value)} aria-label="Month">
          <option value="all">All months</option>
          {periods.map((p) => (
            <option key={p} value={p}>{monthLabel(p)}</option>
          ))}
        </select>
        <select className={styles.select} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as PaymentStatus | "all")} aria-label="Status">
          <option value="all">All statuses</option>
          <option value="paid">Paid</option>
          <option value="due">Due</option>
          <option value="overdue">Overdue</option>
        </select>
      </div>

      {summary && (
        <div className={`${styles.tiles} ${summaryIsCurrent ? "" : styles.stale}`}>
          <StatTile
            label={summary.periodMonth ? `Collected — ${monthLabel(summary.periodMonth)}` : "Collected — all time"}
            value={inrCompact(summary.collected)}
            sub={`${collectedPct}% of ${inrCompact(summary.billed)} billed`}
          />
          <StatTile
            label="Still to collect"
            value={inrCompact(summary.outstanding)}
            sub={`${summary.dueCount} not yet due · ${summary.overdueCount} overdue`}
          />
          <StatTile
            label="Overdue"
            value={inrCompact(summary.overdueAmount)}
            sub={summary.overdueCount === 0 ? "Nothing past due" : `${summary.overdueCount} payment${summary.overdueCount > 1 ? "s" : ""} past due date`}
          />
          <StatTile label="Deposits held" value={inrCompact(summary.depositsHeld)} sub="Across current residents" />
        </div>
      )}

      <div className={styles.columns}>
        <section className={pageStyles.panel}>
          <h2 className={pageStyles.panelTitle}>Collection {period ? `— ${monthLabel(period)}` : ""}</h2>
          {!period ? (
            <p className={pageStyles.muted}>Pick a single month to see how collection built up day by day.</p>
          ) : summaryIsCurrent ? (
            <CollectionChart summary={summary} />
          ) : (
            <p className={pageStyles.muted}>Loading {monthLabel(period)}…</p>
          )}
        </section>

        <div className={styles.side}>
          <section className={pageStyles.panel}>
            <h2 className={pageStyles.panelTitle}>Recent collections</h2>
            {transactions.length === 0 ? (
              <p className={pageStyles.muted}>No payments recorded{period ? " for this month" : ""} yet.</p>
            ) : (
              <ul className={styles.receipts}>
                {transactions.map((tx) => (
                  <li key={tx.id}>
                    <span className={styles.receiptName}>
                      {tx.tenantName}
                      <span className={styles.receiptMeta}>
                        Room {tx.roomNumber}/{tx.bedLabel} · {METHOD_LABEL[tx.method]} · {formatDate(tx.paidDate)}
                      </span>
                    </span>
                    <span className={styles.receiptAmount}>{inr(tx.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={`${pageStyles.panel} ${styles.notConnected}`}>
            <h2 className={pageStyles.panelTitle}>UPI &amp; bank transfers</h2>
            <p className={pageStyles.muted}>
              Not connected yet. Once a payment method is agreed, incoming transfers will be matched to residents here
              automatically, and receipts sent on WhatsApp. Until then, record payments by hand below.
            </p>
          </section>
        </div>
      </div>

      <h2 className={pageStyles.sectionTitle} style={{ marginTop: "var(--space-6)" }}>
        Payments {period ? `— ${monthLabel(period)}` : "— all months"}
      </h2>
      {error && <p className={pageStyles.error}>{error}</p>}
      {isLoading ? (
        <p className={pageStyles.loading}>Loading rent records…</p>
      ) : (
        <RentTable records={filtered} onRecordPayment={setSelectedRecord} />
      )}

      {selectedRecord && (
        <RecordPaymentModal
          record={selectedRecord}
          onClose={() => setSelectedRecord(null)}
          onSubmit={(data, key) => handleRecordPayment(selectedRecord.id, data, key)}
        />
      )}
    </div>
  );
}
