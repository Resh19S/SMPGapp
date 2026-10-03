import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Modal } from "../common/Modal";
import formStyles from "../common/Form.module.css";
import { ApiError } from "../../api/client";
import styles from "./TenantDetailModal.module.css";
import type { Tenant } from "../../types/contract";
import { addDaysISO, formatDate, inr, todayISO } from "../../lib/format";
import { RenewalPanel } from "./RenewalPanel";
import { whatsappLink } from "../../lib/whatsapp";

const NOTICE_STATUS_LABEL = { notice: "notice given", "inspection-scheduled": "inspection booked", settled: "settled" };

export function TenantDetailModal({
  tenant,
  onClose,
  onUploadDocument,
  onGiveNotice,
  onRenew,
}: {
  tenant: Tenant;
  onClose: () => void;
  onUploadDocument: (documentId: number, fileName: string) => Promise<void>;
  onGiveNotice: (noticeDate: string, plannedMoveOutDate: string) => Promise<void>;
  onRenew: (data: { newExpiry: string; newRent: number; effectiveFrom: string }) => Promise<void>;
}) {
  const fileInputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const [uploadingId, setUploadingId] = useState<number | null>(null);
  const [showNotice, setShowNotice] = useState(false);
  const [noticeDate, setNoticeDate] = useState(todayISO);
  const [moveOutDate, setMoveOutDate] = useState(() => addDaysISO(todayISO(), 30));
  const [error, setError] = useState<string | null>(null);

  async function handleFileSelected(documentId: number, file: File | undefined) {
    if (!file) return;
    setUploadingId(documentId);
    try {
      await onUploadDocument(documentId, file.name);
    } catch {
      setError("Could not record the upload. Please try again.");
    } finally {
      setUploadingId(null);
    }
  }

  async function handleConfirmNotice() {
    setError(null);
    try {
      await onGiveNotice(noticeDate, moveOutDate);
      setShowNotice(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record the notice. Please try again.");
    }
  }

  return (
    <Modal title={tenant.name} onClose={onClose} width={520}>
      {error && <div className={formStyles.error}>{error}</div>}

      <dl className={styles.detailGrid}>
        <div>
          <dt>Phone</dt>
          <dd className={styles.contact}>
            <span className={styles.mono}>{tenant.phone}</span>
            <a className={styles.contactLink} href={`tel:+91${tenant.phone}`}>Call</a>
            <a className={styles.contactLink} href={whatsappLink(tenant.phone, `Hi ${tenant.name.split(" ")[0]}, `)} target="_blank" rel="noreferrer">
              WhatsApp
            </a>
          </dd>
        </div>
        <div><dt>Room / Bed</dt><dd>{tenant.roomNumber} / {tenant.bedLabel}</dd></div>
        <div><dt>Move-in</dt><dd className={styles.mono}>{formatDate(tenant.moveInDate)}</dd></div>
        <div><dt>Rent due day</dt><dd>Day {tenant.rentDueDay} of each month</dd></div>
        <div><dt>Rent</dt><dd className={styles.mono}>{inr(tenant.rentAmount)}/month</dd></div>
        <div><dt>Deposit</dt><dd className={styles.mono}>{inr(tenant.depositAmount)}</dd></div>
      </dl>

      <RenewalPanel key={tenant.agreementExpiry} tenant={tenant} onRenew={onRenew} />

      <h3 className={styles.sectionTitle}>Documents</h3>
      <ul className={styles.docList}>
        {tenant.documents.map((doc) => (
          <li key={doc.id} className={styles.docRow}>
            <span>{doc.label}</span>
            {doc.fileName ? (
              <span className={styles.docFile}>{doc.fileName}</span>
            ) : (
              <span className={styles.docMissing}>Not uploaded</span>
            )}
            <input
              ref={(el) => { fileInputRefs.current[doc.id] = el; }}
              type="file"
              className={styles.hiddenInput}
              onChange={(e) => handleFileSelected(doc.id, e.target.files?.[0])}
            />
            <button
              type="button"
              className={formStyles.buttonSecondary}
              disabled={uploadingId === doc.id}
              onClick={() => fileInputRefs.current[doc.id]?.click()}
            >
              {uploadingId === doc.id ? "Saving…" : doc.fileName ? "Replace" : "Upload"}
            </button>
          </li>
        ))}
      </ul>

      {tenant.isActive && tenant.notice && (
        <p className={styles.movedOutNotice}>
          Leaving on {formatDate(tenant.notice.plannedMoveOutDate)} · {NOTICE_STATUS_LABEL[tenant.notice.status]}.{" "}
          <Link to="/operations">Inspection and deposit settlement in Operations →</Link>
        </p>
      )}
      {tenant.isActive && !tenant.notice && (
        <div className={styles.moveOutSection}>
          {!showNotice ? (
            <button type="button" className={formStyles.buttonDanger} onClick={() => setShowNotice(true)}>
              Record move-out notice
            </button>
          ) : (
            <div>
              <div className={formStyles.row}>
                <div className={formStyles.field}>
                  <label className={formStyles.label} htmlFor="notice-date">Notice given on</label>
                  <input id="notice-date" type="date" className={formStyles.input} value={noticeDate} onChange={(e) => setNoticeDate(e.target.value)} />
                </div>
                <div className={formStyles.field}>
                  <label className={formStyles.label} htmlFor="move-out-date">Leaving on</label>
                  <input id="move-out-date" type="date" className={formStyles.input} value={moveOutDate} onChange={(e) => setMoveOutDate(e.target.value)} />
                </div>
              </div>
              <p className={formStyles.hint}>The bed stays occupied and rent keeps accruing until the move-out is settled.</p>
              <div className={formStyles.actions} style={{ marginTop: "var(--space-3)" }}>
                <button type="button" className={formStyles.buttonSecondary} onClick={() => setShowNotice(false)}>Cancel</button>
                <button type="button" className={formStyles.buttonDanger} onClick={handleConfirmNotice}>Record notice</button>
              </div>
            </div>
          )}
        </div>
      )}
      {!tenant.isActive && tenant.moveOutDate && (
        <p className={styles.movedOutNotice}>Moved out on {formatDate(tenant.moveOutDate)}.</p>
      )}
    </Modal>
  );
}
