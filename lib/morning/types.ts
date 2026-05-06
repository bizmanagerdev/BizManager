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

export type MorningCreateDocumentPayload = {
  clientId: string;
  type: MorningDocumentType;
  description?: string | null;
  remarks?: string | null;
  currency?: string;
  externalId?: string | null;
  lines: MorningDocumentLine[];
};

export type MorningDocumentResult = {
  id: string;
  number: string | null;
  type: number;
  status: string;
  amount: number | null;
  currency: string;
  morningUrl: string | null;
  pdfUrl: string | null;
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
