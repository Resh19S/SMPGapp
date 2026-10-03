import { useState, type ChangeEvent } from "react";
import { Modal } from "../common/Modal";
import formStyles from "../common/Form.module.css";
import tableStyles from "../common/Table.module.css";
import { ApiError, importTenants } from "../../api/client";
import type { TenantImportResult, TenantImportRow } from "../../types/contract";
import { downloadCsv, normalizeDate, parseCsv } from "../../lib/csv";
import styles from "./ImportTenantsModal.module.css";

// Sheet columns, in template order. Header matching is case/space-insensitive.
const COLUMNS: { header: string; key: keyof TenantImportRow; example: string }[] = [
  { header: "Name", key: "name", example: "Rohan Deshmukh" },
  { header: "Phone", key: "phone", example: "9822011223" },
  { header: "Room", key: "roomNumber", example: "101" },
  { header: "Bed", key: "bedLabel", example: "A" },
  { header: "Move-in date", key: "moveInDate", example: "01/06/2026" },
  { header: "Rent due day", key: "rentDueDay", example: "5" },
  { header: "Rent", key: "rentAmount", example: "9500" },
  { header: "Deposit", key: "depositAmount", example: "9500" },
  { header: "Agreement ends", key: "agreementExpiry", example: "30/04/2027" },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

function toRows(cells: string[][]): { rows: TenantImportRow[]; missing: string[] } {
  const [header, ...body] = cells;
  const index = new Map(header.map((h, i) => [norm(h), i]));
  const missing = COLUMNS.filter((c) => c.key !== "rentAmount" && !index.has(norm(c.header))).map((c) => c.header);
  const rows = body.map((line) => {
    const get = (h: string) => (line[index.get(norm(h)) ?? -1] ?? "").trim();
    const rent = get("Rent");
    return {
      name: get("Name"),
      phone: get("Phone"),
      roomNumber: get("Room"),
      bedLabel: get("Bed"),
      moveInDate: normalizeDate(get("Move-in date")),
      rentDueDay: Number(get("Rent due day")),
      ...(rent ? { rentAmount: Number(rent.replace(/[₹,\s]/g, "")) } : {}),
      depositAmount: Number(get("Deposit").replace(/[₹,\s]/g, "") || "0"),
      agreementExpiry: normalizeDate(get("Agreement ends")),
    } as TenantImportRow;
  });
  return { rows, missing };
}

/** Upload an existing register (Excel → Save as CSV). Checked first, then imported all at once. */
export function ImportTenantsModal({ onClose, onImported }: { onClose: () => void; onImported: (count: number) => void }) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<TenantImportRow[]>([]);
  const [check, setCheck] = useState<TenantImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  function downloadTemplate() {
    downloadCsv("tenant-import-template", COLUMNS.map((c) => c.header), [COLUMNS.map((c) => c.example)]);
  }

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setCheck(null);
    setRows([]);
    setFileName(file.name);
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Please upload a .csv file — in Excel: File → Save As → CSV (Comma delimited).");
      return;
    }
    const cells = parseCsv(await file.text());
    if (cells.length < 2) {
      setError("The file has no rows under the header.");
      return;
    }
    const { rows: parsed, missing } = toRows(cells);
    if (missing.length) {
      setError(`Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Download the template to see the layout.`);
      return;
    }
    if (parsed.length > 500) {
      setError("That's more than 500 rows — split the sheet into smaller files.");
      return;
    }
    setRows(parsed);
    setIsBusy(true);
    try {
      setCheck(await importTenants(parsed, true));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not check the file.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleImport() {
    setIsBusy(true);
    setError(null);
    try {
      const result = await importTenants(rows, false);
      if (result.ok) {
        onImported(result.created);
        onClose();
      } else {
        setCheck(result); // something changed since the check (e.g. a bed got taken)
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not import. Nothing was saved.");
    } finally {
      setIsBusy(false);
    }
  }

  const errorsByRow = new Map<number, string[]>();
  check?.errors.forEach((e) => errorsByRow.set(e.row, [...(errorsByRow.get(e.row) ?? []), e.message]));

  return (
    <Modal title="Import tenants from Excel" onClose={onClose} width={760}>
      <ol className={styles.steps}>
        <li>
          <button type="button" className={styles.linkButton} onClick={downloadTemplate}>Download the template</button>{" "}
          and fill one row per resident (dates as DD/MM/YYYY). Rooms and beds must already exist in Rooms &amp; Beds.
        </li>
        <li>In Excel: <em>File → Save As → CSV</em>, then choose the file here.</li>
        <li>We check every row first. Nothing is saved until every row is correct.</li>
      </ol>

      <label className={styles.filePick}>
        <input type="file" accept=".csv,text/csv" onChange={handleFile} />
        <span className={formStyles.buttonSecondary}>Choose CSV file…</span>
        <span className={styles.fileName}>{fileName ?? "No file chosen"}</span>
      </label>

      {error && <div className={formStyles.error}>{error}</div>}
      {isBusy && <p className={formStyles.hint}>Checking…</p>}

      {check && rows.length > 0 && (
        <>
          <p className={check.ok ? styles.ok : styles.bad} role="status">
            {check.ok
              ? `All ${rows.length} rows look good — ready to import.`
              : `${errorsByRow.size} of ${rows.length} rows need fixing. Correct them in Excel and choose the file again.`}
          </p>
          <div className={`${tableStyles.tableWrap} ${styles.preview}`}>
            <table className={tableStyles.table}>
              <thead>
                <tr><th>#</th><th>Name</th><th>Room/Bed</th><th>Move-in</th><th>Rent</th><th>Problem</th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const problems = errorsByRow.get(i + 1);
                  return (
                    <tr key={i} className={problems ? styles.rowBad : undefined}>
                      <td className={tableStyles.mono}>{i + 1}</td>
                      <td className={tableStyles.name}>{r.name || "—"}</td>
                      <td className={tableStyles.mono}>{r.roomNumber}/{r.bedLabel}</td>
                      <td className={tableStyles.mono}>{r.moveInDate}</td>
                      <td className={tableStyles.mono}>{r.rentAmount ?? "listed"}</td>
                      <td className={styles.problem}>{problems ? problems.join(" · ") : "✓"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className={formStyles.actions}>
        <button type="button" className={formStyles.buttonSecondary} onClick={onClose}>Cancel</button>
        <button type="button" className={formStyles.buttonPrimary} disabled={!check?.ok || isBusy} onClick={handleImport}>
          {isBusy ? "Working…" : check?.ok ? `Import ${rows.length} tenants` : "Import"}
        </button>
      </div>
    </Modal>
  );
}
