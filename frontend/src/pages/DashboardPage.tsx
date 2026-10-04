import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchDashboard } from "../api/client";
import type { DashboardSummary, DecisionItem } from "../types/contract";
import { StatTile } from "../components/common/StatTile";
import { StatusBadge, type BadgeTone } from "../components/common/StatusBadge";
import { DuesAgeing } from "../components/dashboard/DuesAgeing";
import { inr, inrCompact, relativeDay } from "../lib/format";
import { useAuthStore } from "../store/authStore";
import styles from "./DashboardPage.module.css";

const TIER_STAMP: Record<DecisionItem["tier"], { tone: BadgeTone; label: string }> = {
  1: { tone: "overdue", label: "urgent" },
  2: { tone: "due", label: "today" },
  3: { tone: "new", label: "this week" },
};

const UPCOMING_LABEL: Record<DashboardSummary["nextSevenDays"][number]["kind"], string> = {
  "move-in": "Move-in",
  "move-out": "Move-out",
  inspection: "Inspection",
  "agreement-expiry": "Agreement",
  "follow-up": "Follow-up",
};


export function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboard()
      .then(setSummary)
      .catch(() => setError("Could not load the dashboard. Try refreshing."));
  }, []);

  if (error) return <div className={styles.error}>{error}</div>;
  if (!summary) return <div className={styles.loading}>Loading dashboard…</div>;

  const queue = summary.decisionQueue;
  const collectedPct = summary.billedThisMonth ? Math.round((summary.collectedThisMonth / summary.billedThisMonth) * 100) : 0;
  const todayMoves = [
    ...summary.moveInsToday.map((m) => ({ ...m, kind: "in" as const })),
    ...summary.moveOutsToday.map((m) => ({ ...m, kind: "out" as const })),
  ];

  return (
    <div>
      <p className={styles.eyebrow}>Day book</p>
      <h1 className={styles.pageTitle}>
        {summary.totalBeds === 0 ? "Let's set up your PG" : queue.length === 0 ? "All clear today" : `${queue.length} open item${queue.length === 1 ? "" : "s"} on today's page`}
      </h1>
      <p className={styles.pageSubtitle}>Biggest rupee risk at the top. Paid-up rooms and routine work never make this list.</p>

      {summary.totalBeds === 0 && <GettingStarted />}

      <div className={styles.tiles}>
        <StatTile
          label="Occupancy"
          value={`${summary.occupancyPct}%`}
          sub={
            summary.vacantBeds > 0
              ? `${summary.vacantBeds} empty · ${inrCompact(summary.vacantRentPerMonth)}/mo not coming in`
              : `All ${summary.totalBeds} beds let`
          }
        />
        <StatTile
          label="Collected this month"
          value={inrCompact(summary.collectedThisMonth)}
          sub={`${collectedPct}% of ${inrCompact(summary.billedThisMonth)} billed`}
        />
        <StatTile
          label="Overdue"
          value={inrCompact(summary.overdueAmount)}
          sub={summary.overdueResidents === 0 ? "Everyone is paid up" : `${summary.overdueResidents} resident${summary.overdueResidents > 1 ? "s" : ""}`}
        />
        <StatTile
          label="Complaints"
          value={summary.urgentComplaints > 0 ? `${summary.urgentComplaints} urgent` : `${summary.openComplaints} open`}
          sub={
            summary.oldestUrgentHours !== null
              ? `${summary.openComplaints} open · oldest urgent ${summary.oldestUrgentHours}h`
              : `${summary.openComplaints} open · nothing urgent`
          }
        />
      </div>

      <div className={styles.columns}>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Open items</h2>
          {queue.length === 0 ? (
            <p className={styles.empty}>Nothing open. Every room is paid up and every complaint handled.</p>
          ) : (
            <ol className={styles.queue}>
              {queue.map((item, i) => (
                <li key={i} className={`${styles.queueItem} ${styles[`tier${item.tier}`]}`}>
                  <div className={styles.queueText}>
                    <span className={styles.queueTitle}>{item.title}</span>
                    <span className={styles.queueDetail}>{item.detail}</span>
                  </div>
                  <StatusBadge tone={TIER_STAMP[item.tier].tone} label={TIER_STAMP[item.tier].label} />
                  <Link className={styles.queueAction} to={item.link}>
                    Open →
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </section>

        <div className={styles.sideColumn}>
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>Unpaid rent by age</h2>
            <p className={styles.panelSub}>{inr(summary.overdueAmount)} outstanding past due date</p>
            <DuesAgeing buckets={summary.duesAgeing} />
            <Link className={styles.panelLink} to="/rent">Go to Rent Tracker →</Link>
          </section>

          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>Today's moves</h2>
            {todayMoves.length === 0 ? (
              <p className={styles.empty}>No move-ins or move-outs today.</p>
            ) : (
              <ul className={styles.list}>
                {todayMoves.map((m) => (
                  <li key={`${m.kind}-${m.tenantId}`}>
                    <StatusBadge tone={m.kind === "in" ? "booked" : "lost"} label={m.kind === "in" ? "in" : "out"} />{" "}
                    <strong>{m.name}</strong> — Room {m.roomNumber}/{m.bedLabel}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>Coming up this week</h2>
            {summary.nextSevenDays.length === 0 ? (
              <p className={styles.empty}>A quiet week ahead.</p>
            ) : (
              <ul className={styles.upcoming}>
                {summary.nextSevenDays.map((e, i) => (
                  <li key={i}>
                    <span className={styles.upcomingDay}>{relativeDay(e.date)}</span>
                    <span>
                      <span className={styles.upcomingKind}>{UPCOMING_LABEL[e.kind]}</span> {e.title}
                      <span className={styles.upcomingDetail}>{e.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/** First-run checklist, shown until the first bed exists. Each step links to
 * the page that does it; nothing here is stored. */
function GettingStarted() {
  const isOwner = useAuthStore((s) => s.user?.role === "owner");
  return (
    <section className={`${styles.panel} ${styles.setup}`}>
      <h2 className={styles.panelTitle}>Getting started</h2>
      <ol className={styles.setupSteps}>
        <li>
          <Link to="/properties">Rooms &amp; Beds</Link>: check your property name, then <strong>+ Add rooms</strong> (all
          rooms of a floor at once, e.g. 101–110 with beds A, B, C).
        </li>
        <li>
          <Link to="/tenants">Tenants</Link>: add each resident with <strong>+ Move in tenant</strong>, or bring them all in at
          once with <strong>Import from Excel</strong>.
        </li>
        <li>
          <Link to="/leads">Leads</Link>: note enquiries as they come in, so follow-ups don't slip.
        </li>
        {isOwner && (
          <li>
            <Link to="/staff">Staff Access</Link>: give your staff their own logins, and change your own password from
            the <strong>Password</strong> button at the top right.
          </li>
        )}
      </ol>
    </section>
  );
}
