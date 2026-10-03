import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, fetchReceipt } from "../api/client";
import type { Receipt } from "../types/contract";
import { formatDate, inr, monthLabel } from "../lib/format";
import { receiptText, whatsappLink } from "../lib/whatsapp";
import styles from "./ReceiptPage.module.css";

const METHOD: Record<Receipt["method"], string> = {
  cash: "Cash",
  upi: "UPI",
  bank: "Bank transfer",
  other: "Other",
  deposit: "Adjusted from deposit",
};

/** A rent receipt to print, save as PDF (browser print → Save as PDF), or send on WhatsApp. */
export function ReceiptPage() {
  const { id } = useParams();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const txId = Number(id);
    if (!Number.isInteger(txId) || txId <= 0) {
      setError("That receipt link isn't valid.");
      return;
    }
    fetchReceipt(txId)
      .then(setReceipt)
      .catch((err) => setError(err instanceof ApiError && err.status === 404 ? "Receipt not found." : "Could not load the receipt."));
  }, [id]);

  if (error) {
    return (
      <div className={styles.page}>
        <p className={styles.error}>{error}</p>
        <Link to="/rent">← Back to Rent Tracker</Link>
      </div>
    );
  }
  if (!receipt) return <div className={styles.page}><p className={styles.loading}>Loading receipt…</p></div>;

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <Link to="/rent" className={styles.back}>← Rent Tracker</Link>
        <div className={styles.toolbarActions}>
          <a className={styles.whatsapp} href={whatsappLink(receipt.tenantPhone, receiptText(receipt))} target="_blank" rel="noreferrer">
            Send on WhatsApp
          </a>
          <button className={styles.print} onClick={() => window.print()}>
            Print / Save PDF
          </button>
        </div>
      </div>

      <article className={styles.receipt} aria-label={`Receipt ${receipt.receiptNumber}`}>
        <header className={styles.head}>
          <div>
            <h1 className={styles.property}>{receipt.propertyName}</h1>
            {receipt.propertyAddress && <p className={styles.address}>{receipt.propertyAddress}</p>}
          </div>
          <div className={styles.stamp}>
            <span>Rent receipt</span>
            <strong>{receipt.receiptNumber}</strong>
          </div>
        </header>

        <p className={styles.lead}>
          Received with thanks from <strong>{receipt.tenantName}</strong>, Room {receipt.roomNumber}/{receipt.bedLabel},
          the sum of
        </p>
        <p className={styles.amount}>{inr(receipt.amount)}</p>

        <dl className={styles.details}>
          <div><dt>For</dt><dd>Rent — {monthLabel(receipt.periodMonth)}</dd></div>
          <div><dt>Date received</dt><dd>{formatDate(receipt.paidDate)}</dd></div>
          <div><dt>Paid by</dt><dd>{METHOD[receipt.method]}</dd></div>
          {receipt.note && <div><dt>Reference</dt><dd>{receipt.note}</dd></div>}
          <div><dt>Month's rent</dt><dd>{inr(receipt.monthRent)}</dd></div>
          <div><dt>Paid so far</dt><dd>{inr(receipt.paidSoFar)}</dd></div>
          <div className={styles.balanceRow}>
            <dt>Balance for the month</dt>
            <dd>{receipt.balance > 0 ? inr(receipt.balance) : "Nil — fully paid"}</dd>
          </div>
        </dl>

        <footer className={styles.foot}>
          <span>{receipt.receivedBy ? `Received by ${receipt.receivedBy}` : ""}</span>
          <span>Computer-generated receipt; no signature required.</span>
        </footer>
      </article>
    </div>
  );
}
