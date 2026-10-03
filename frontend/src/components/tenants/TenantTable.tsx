import type { Tenant } from "../../types/contract";
import { StatusBadge } from "../common/StatusBadge";
import { addDaysISO, formatDate, inr, todayISO } from "../../lib/format";
import styles from "../common/Table.module.css";

/** Active, not leaving, and the agreement ends within 30 days (or already has). */
export function needsRenewal(tenant: Tenant): boolean {
  return tenant.isActive && !tenant.notice && tenant.agreementExpiry <= addDaysISO(todayISO(), 30);
}

export function TenantTable({ tenants, onSelect }: { tenants: Tenant[]; onSelect: (tenant: Tenant) => void }) {
  if (tenants.length === 0) {
    return <p className={styles.empty}>No tenants yet. Move someone in from a vacant bed.</p>;
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Phone</th>
            <th>Rent</th>
            <th>Move-in</th>
            <th>Agreement ends</th>
            <th>Documents</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {tenants.map((tenant) => {
            const missingDocs = tenant.documents.filter((d) => !d.fileName).length;
            return (
              <tr key={tenant.id} onClick={() => onSelect(tenant)} style={{ cursor: "pointer" }}>
                <td className={styles.name}>
                  {tenant.name}
                  <span className={styles.sub}>Room {tenant.roomNumber}/{tenant.bedLabel}</span>
                </td>
                <td className={styles.mono}>{tenant.phone}</td>
                <td className={styles.mono}>{inr(tenant.rentAmount)}</td>
                <td className={styles.mono}>{formatDate(tenant.moveInDate)}</td>
                <td>
                  <div className={styles.statusCell}>
                    <span className={styles.mono}>{formatDate(tenant.agreementExpiry)}</span>
                    {needsRenewal(tenant) &&
                      (tenant.agreementExpiry < todayISO() ? (
                        <StatusBadge tone="overdue" label="expired" />
                      ) : (
                        <StatusBadge tone="due" label="renew" />
                      ))}
                  </div>
                </td>
                <td className={styles.nowrap}>{missingDocs === 0 ? "Complete" : `${missingDocs} missing`}</td>
                <td>
                  {!tenant.isActive ? (
                    <StatusBadge tone="lost" label="moved out" />
                  ) : tenant.moveInDate > todayISO() ? (
                    <StatusBadge tone="booked" label={`moving in ${formatDate(tenant.moveInDate).slice(0, 5)}`} />
                  ) : tenant.notice ? (
                    <StatusBadge tone="due" label={`leaving ${formatDate(tenant.notice.plannedMoveOutDate).slice(0, 5)}`} />
                  ) : (
                    <StatusBadge tone="occupied" label="active" />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
