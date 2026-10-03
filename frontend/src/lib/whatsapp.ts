// WhatsApp click-to-chat links (wa.me). These open WhatsApp on the staff
// member's own phone/desktop with the message typed in — they press Send.
// No WhatsApp Business API, no per-message cost, nothing sent automatically.
import type { Receipt, RentRecord } from "../types/contract";
import { formatDate, inr, monthLabel } from "./format";

export function whatsappLink(phone: string, text: string): string {
  const digits = phone.replace(/\D/g, "").slice(-10);
  return `https://wa.me/91${digits}?text=${encodeURIComponent(text)}`;
}

function firstName(name: string): string {
  return name.split(" ")[0];
}

export function rentReminderText(record: RentRecord, propertyName: string): string {
  const balance = record.amountDue - record.amountPaid;
  const when = record.status === "overdue" ? `was due on ${formatDate(record.dueDate)}` : `is due on ${formatDate(record.dueDate)}`;
  return [
    `Hi ${firstName(record.tenantName)}, a gentle reminder from ${propertyName}.`,
    `Rent for ${monthLabel(record.periodMonth)} (Room ${record.roomNumber}/${record.bedLabel}) ${when}.`,
    record.amountPaid > 0 ? `Received so far: ${inr(record.amountPaid)}. Balance: ${inr(balance)}.` : `Amount: ${inr(balance)}.`,
    `Please ignore if you've already paid. Thank you!`,
  ].join("\n");
}

export function receiptText(receipt: Receipt): string {
  return [
    `${receipt.propertyName} — Rent receipt ${receipt.receiptNumber}`,
    `Received ${inr(receipt.amount)} from ${receipt.tenantName} (Room ${receipt.roomNumber}/${receipt.bedLabel})`,
    `for ${monthLabel(receipt.periodMonth)}, on ${formatDate(receipt.paidDate)}.`,
    receipt.balance > 0 ? `Balance for the month: ${inr(receipt.balance)}.` : `${monthLabel(receipt.periodMonth)} is fully paid. Thank you!`,
  ].join("\n");
}
