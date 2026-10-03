import { useState } from "react";
import { ApiError } from "../../api/client";
import type { Tenant } from "../../types/contract";
import { currentMonthISO, formatDate, inr, monthLabel, shiftPeriod, todayISO } from "../../lib/format";
import formStyles from "../common/Form.module.css";
import styles from "./TenantDetailModal.module.css";

const HIKES = [0, 5, 10];

/** Leave-and-licence agreements in India usually run 11 months. */
function addMonthsISO(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1 + months, d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function roundTo50(n: number): number {
  return Math.round(n / 50) * 50;
}

export function RenewalPanel({
  tenant,
  onRenew,
}: {
  tenant: Tenant;
  onRenew: (data: { newExpiry: string; newRent: number; effectiveFrom: string }) => Promise<void>;
}) {
  const baseDate = tenant.agreementExpiry > todayISO() ? tenant.agreementExpiry : todayISO();
  const defaultEffective = (() => {
    const afterExpiry = shiftPeriod(tenant.agreementExpiry.slice(0, 7), 1);
    return afterExpiry < currentMonthISO() ? currentMonthISO() : afterExpiry;
  })();

  const [isOpen, setIsOpen] = useState(false);
  const [newExpiry, setNewExpiry] = useState(() => addMonthsISO(baseDate, 11));
  const [newRent, setNewRent] = useState(String(tenant.rentAmount));
  const [effectiveFrom, setEffectiveFrom] = useState(defaultEffective);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const rent = Number(newRent);
  const change = tenant.rentAmount ? ((rent - tenant.rentAmount) / tenant.rentAmount) * 100 : 0;
  const canRenew = tenant.isActive && (!tenant.notice || tenant.notice.status === "settled");

  async function handleSubmit() {
    setError(null);
    if (!rent || rent <= 0) {
      setError("Enter the rent for the renewed agreement.");
      return;
    }
    setIsSubmitting(true);
    try {
      await onRenew({ newExpiry, newRent: rent, effectiveFrom });
      setIsOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not renew. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className={styles.renewal}>
      <h3 className={styles.sectionTitle}>Agreement</h3>
      <p className={styles.renewalSummary}>
        Runs to <strong>{formatDate(tenant.agreementExpiry)}</strong> · rent {inr(tenant.rentAmount)}/month
        {tenant.upcomingRent !== null && tenant.upcomingRentFrom && (
          <> · <strong>{inr(tenant.upcomingRent)}</strong> from {monthLabel(tenant.upcomingRentFrom)}</>
        )}
      </p>

      {canRenew && !isOpen && (
        <button type="button" className={formStyles.buttonSecondary} onClick={() => setIsOpen(true)}>
          Renew agreement
        </button>
      )}

      {isOpen && (
        <div className={styles.renewalForm}>
          {error && <div className={formStyles.error}>{error}</div>}
          <div className={formStyles.row}>
            <div className={formStyles.field}>
              <label className={formStyles.label} htmlFor="renew-expiry">New end date</label>
              <input id="renew-expiry" type="date" className={formStyles.input} value={newExpiry} onChange={(e) => setNewExpiry(e.target.value)} />
            </div>
            <div className={formStyles.field}>
              <label className={formStyles.label} htmlFor="renew-from">New rent starts</label>
              <input id="renew-from" type="month" className={formStyles.input} min={currentMonthISO()} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
            </div>
          </div>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="renew-rent">Rent (₹/month)</label>
            <div className={styles.hikeRow}>
              <input id="renew-rent" type="number" min="1" className={formStyles.input} value={newRent} onChange={(e) => setNewRent(e.target.value)} />
              {HIKES.map((pct) => (
                <button
                  key={pct}
                  type="button"
                  className={styles.hikeChip}
                  aria-pressed={rent === roundTo50(tenant.rentAmount * (1 + pct / 100))}
                  onClick={() => setNewRent(String(roundTo50(tenant.rentAmount * (1 + pct / 100))))}
                >
                  {pct === 0 ? "Same" : `+${pct}%`}
                </button>
              ))}
            </div>
          </div>
          {rent > 0 && (
            <p className={formStyles.hint}>
              {rent === tenant.rentAmount
                ? `Rent stays ${inr(rent)}.`
                : `${inr(tenant.rentAmount)} → ${inr(rent)} (${change > 0 ? "+" : ""}${change.toFixed(1)}%) from ${monthLabel(effectiveFrom)}.`}{" "}
              A new agreement slot is added to Documents for the signed copy.
            </p>
          )}
          <div className={formStyles.actions}>
            <button type="button" className={formStyles.buttonSecondary} onClick={() => setIsOpen(false)}>Cancel</button>
            <button type="button" className={formStyles.buttonPrimary} onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? "Renewing…" : "Confirm renewal"}
            </button>
          </div>
        </div>
      )}

      {tenant.renewals.length > 0 && (
        <ul className={styles.renewalHistory} aria-label="Renewal history">
          {tenant.renewals.map((r) => (
            <li key={r.id}>
              <span className={styles.mono}>{formatDate(r.renewedAt.slice(0, 10))}</span>
              <span>
                Extended to {formatDate(r.newExpiry)}
                {r.newRent !== r.previousRent
                  ? ` · ${inr(r.previousRent)} → ${inr(r.newRent)} from ${monthLabel(r.effectivePeriod)}`
                  : " · rent unchanged"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
