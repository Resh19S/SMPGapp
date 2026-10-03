import type { Bed, BedRentState } from "../../types/contract";
import { inr, todayISO } from "../../lib/format";
import styles from "./BedGrid.module.css";

export const RENT_STATE_LABEL: Record<BedRentState, string> = {
  paid: "Paid",
  due: "Due later",
  "due-today": "Due today",
  late: "Late",
  reserved: "Moving in",
  vacant: "Vacant",
};

export const RENT_STATE_ORDER: BedRentState[] = ["late", "due-today", "due", "paid", "reserved", "vacant"];

function daysSince(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const [ty, tm, td] = todayISO().split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(y, m - 1, d)) / 86_400_000);
}

function stampText(bed: Bed): string {
  if (bed.rentState === "late") return `${bed.daysLate}d late`;
  if (bed.rentState === "vacant" && bed.vacantSince) return `Vacant ${daysSince(bed.vacantSince)}d`;
  return RENT_STATE_LABEL[bed.rentState];
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    map.set(k, [...(map.get(k) ?? []), item]);
  }
  return map;
}

/** Every bed as a brass key tag, coloured by its money state — the grid answers
 * "who owes what" without opening anything. Beds filtered out by the legend
 * stay in place but fade, so the floor plan never reflows. */
export function BedGrid({
  beds,
  highlight,
  focusRoom,
  onSelect,
}: {
  beds: Bed[];
  highlight: BedRentState | null;
  focusRoom: string | null; // from search: outline this room and scroll to it
  onSelect: (bed: Bed) => void;
}) {
  if (beds.length === 0) {
    return <p className={styles.empty}>No rooms set up yet. Add a bed to get started.</p>;
  }

  const floors = groupBy(beds, (b) => b.floor);

  return (
    <div className={styles.floors}>
      {[...floors.entries()].map(([floor, floorBeds]) => {
        const rooms = groupBy(floorBeds, (b) => b.roomNumber);
        const vacant = floorBeds.filter((b) => b.rentState === "vacant").length;
        return (
          <section key={floor} className={styles.floor}>
            <header className={styles.floorHeader}>
              <h2 className={styles.floorTitle}>{floor === 0 ? "Ground floor" : `Floor ${floor}`}</h2>
              <span className={styles.floorMeta}>
                {rooms.size} rooms · {floorBeds.length} beds{vacant > 0 ? ` · ${vacant} vacant` : ""}
              </span>
            </header>
            <div className={styles.rooms}>
              {[...rooms.entries()].map(([roomNumber, roomBeds]) => (
                <div
                  key={roomNumber}
                  id={`room-${roomNumber}`}
                  className={`${styles.room} ${focusRoom === roomNumber ? styles.roomFocus : ""}`}
                >
                  <div className={styles.roomHeader}>Room {roomNumber}</div>
                  <div className={styles.bedRow}>
                    {roomBeds.map((bed) => {
                      const dimmed = highlight !== null && bed.rentState !== highlight;
                      return (
                        <button
                          key={bed.id}
                          className={`${styles.tag} ${styles[bed.rentState]} ${dimmed ? styles.dimmed : ""}`}
                          onClick={() => onSelect(bed)}
                          aria-label={`Room ${bed.roomNumber} bed ${bed.bedLabel}: ${stampText(bed)}${bed.currentTenant ? `, ${bed.currentTenant.name}` : ""}${bed.outstanding > 0 ? `, ${inr(bed.outstanding)} outstanding` : ""}`}
                        >
                          <span className={styles.tagHole} />
                          <span className={styles.bedLabel}>{bed.bedLabel}</span>
                          <span className={styles.stamp}>{stampText(bed)}</span>
                          <span className={styles.tenantName}>{bed.currentTenant?.name.split(" ")[0] ?? "—"}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
