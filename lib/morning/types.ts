export enum MorningDocumentType {
  Quote = 10,
  TaxInvoice = 305,
  Receipt = 400,
  TaxInvoiceReceipt = 320,
}

export type MorningClient = {
  id: string;
  name: string;
  companyName?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  taxId?: string | null;
  registrationNumber?: string | null;
  address?: string | null;
  city?: string | null;
  zip?: string | null;
  raw?: Record<string, unknown>;
};

export type MorningDocumentLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  vatType?: "include" | "exclude" | "none";
  sku?: string | null;
};

// Morning payment type codes:
//   0 = other/unpaid, 1 = cash, 2 = check, 3 = credit card, 4 = bank transfer
export type MorningPaymentMethodCode = 0 | 1 | 2 | 3 | 4;

export type MorningPaymentLine = {
  type: MorningPaymentMethodCode;
  date: string; // YYYY-MM-DD
  price: number;
  currency?: string;
  // Optional check/transfer reference number
  accountId?: string | null;
  bankName?: string | null;
  branchNumber?: string | null;
  accountNumber?: string | null;
  chequeNumber?: string | null;
};

export type MorningCreateDocumentPayload = {
  clientId: string;
  type: MorningDocumentType;
  description?: string | null;
  remarks?: string | null;
  currency?: string;
  externalId?: string | null;
  lines: MorningDocumentLine[];
  payments?: MorningPaymentLine[];
  // Optional ISO date (YYYY-MM-DD). Defaults to today on the server.
  date?: string | null;
  // Optional links to related Morning documents (e.g. receipt → original invoice).
  linkedDocumentIds?: string[];
};

export function mapBizPaymentMethodToMorning(method: string | null | undefined): MorningPaymentMethodCode {
  const normalized = (method ?? "").trim().toLowerCase();
  if (normalized === "cash") return 1;
  if (normalized === "check" || normalized === "cheque") return 2;
  if (normalized === "credit_card" || normalized === "credit-card" || normalized === "card") return 3;
  if (normalized === "bank_transfer" || normalized === "bank-transfer" || normalized === "transfer") return 4;
  return 0;
}

export type MorningDocumentResult = {
  id: string;
  number: string | null;
  type: number;
  status: string;
  amount: number | null;
  currency: string;
  morningUrl: string | null;
  pdfUrl: string | null;
  issuedAt?: string | null;
  raw: Record<string, unknown>;
};

export type MorningClientMatchCandidate = {
  morningClientId: string;
  morningClientName: string;
  score: number;
  reason: string;
  canAutoMatch: boolean;
  email?: string | null;
  phone?: string | null;
  taxId?: string | null;
};

export type MorningLocalDocument = {
  id: string;
  morning_document_id: string;
  morning_document_number: string | null;
  document_type: number;
  document_type_label: string;
  status: string;
  customer_id: string | null;
  order_id: string | null;
  project_id: string | null;
  payment_id: string | null;
  document_id: string | null;
  morning_client_id: string | null;
  amount: number | string | null;
  currency: string | null;
  morning_url: string | null;
  pdf_url: string | null;
  issued_at: string | null;
  closed_at: string | null;
};
