import { findMorningClientCandidatesForCustomerRecord, type LocalCustomerForMatching } from "@/lib/morning/matching";
import { MorningClient, MorningClientMatchCandidate, MorningCreateDocumentPayload, MorningDocumentResult } from "@/lib/morning/types";

const DEFAULT_AUTH_BASE_URL = "https://api.morning.co";
const DEFAULT_SANDBOX_AUTH_BASE_URL = "https://api.sandbox.morning.dev";
const DEFAULT_RESOURCE_BASE_URL = "https://api.greeninvoice.co.il/api/v1";
const DEFAULT_SANDBOX_RESOURCE_BASE_URL = "https://sandbox.d.greeninvoice.co.il/api/v1";

type MorningConfig = {
  resourceBaseUrl: string;
  authUrl: string;
  keyId: string;
  keySecret: string;
  sandbox: boolean;
};

type MorningCustomerRow = LocalCustomerForMatching & {
  address?: string | null;
};

let cachedToken: { value: string; expiresAt: number } | null = null;

function normalizeMorningAuthBaseUrl(value: string | undefined, sandbox: boolean) {
  const trimmed = value?.trim().replace(/\/+$/, "") ?? "";
  if (!trimmed) {
    return sandbox ? DEFAULT_SANDBOX_AUTH_BASE_URL : DEFAULT_AUTH_BASE_URL;
  }

  if (trimmed === "https://api.greeninvoice.co.il/api/v1") {
    return DEFAULT_AUTH_BASE_URL;
  }

  if (trimmed === "https://sandbox.d.greeninvoice.co.il/api/v1") {
    return DEFAULT_SANDBOX_AUTH_BASE_URL;
  }

  return trimmed;
}

function normalizeMorningResourceBaseUrl(value: string | undefined, sandbox: boolean) {
  const trimmed = value?.trim().replace(/\/+$/, "") ?? "";
  if (!trimmed) {
    return sandbox ? DEFAULT_SANDBOX_RESOURCE_BASE_URL : DEFAULT_RESOURCE_BASE_URL;
  }

  if (trimmed === "https://api.morning.co") {
    return DEFAULT_RESOURCE_BASE_URL;
  }

  if (trimmed === "https://api.sandbox.morning.dev") {
    return DEFAULT_SANDBOX_RESOURCE_BASE_URL;
  }

  return trimmed;
}

function requireConfig(): MorningConfig {
  const sandbox = process.env.MORNING_SANDBOX === "true";
  const keyId =
    process.env.MORNING_CLIENT_ID?.trim() ??
    process.env.MORNING_API_KEY_ID?.trim() ??
    process.env.MORNING_API_KEY?.trim() ??
    "";
  const keySecret =
    process.env.MORNING_CLIENT_SECRET?.trim() ??
    process.env.MORNING_API_KEY_SECRET?.trim() ??
    process.env.MORNING_API_SECRET?.trim() ??
    "";
  if (!keyId || !keySecret) {
    throw new Error("הגדרת Morning חסרה בשרת.");
  }

  const authBaseUrl = normalizeMorningAuthBaseUrl(process.env.MORNING_AUTH_BASE_URL, sandbox);
  const resourceBaseUrl = normalizeMorningResourceBaseUrl(process.env.MORNING_API_BASE_URL, sandbox);

  return {
    resourceBaseUrl,
    authUrl: `${authBaseUrl}/idp/v1/oauth/token`,
    keyId,
    keySecret,
    sandbox,
  };
}

function ensureObject(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function pickString(obj: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

function pickNumber(obj: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function normalizeMorningClient(input: unknown): MorningClient {
  const row = ensureObject(input);
  const emails = Array.isArray(row.emails) ? row.emails : [];
  const firstEmail = emails.find((value) => typeof value === "string" && value.trim()) as string | undefined;

  return {
    id: pickString(row, ["id", "_id"]) ?? "",
    name: pickString(row, ["name", "contact", "company"]) ?? "ללא שם",
    companyName: pickString(row, ["companyName", "company_name", "businessName"]),
    email: pickString(row, ["email"]) ?? firstEmail ?? null,
    phone: pickString(row, ["phone", "telephone"]),
    mobile: pickString(row, ["mobile", "cellphone", "cell_phone"]),
    taxId: pickString(row, ["taxId", "tax_id", "vatNumber", "vat_number"]),
    registrationNumber: pickString(row, ["registrationNumber", "registration_number", "companyNumber", "company_number"]),
    address: pickString(row, ["address", "street"]),
    city: pickString(row, ["city"]),
    zip: pickString(row, ["zip", "zip_code"]),
    raw: row,
  };
}

function normalizeMorningDocument(input: unknown): MorningDocumentResult {
  const row = ensureObject(input);
  const url = ensureObject(row.url);

  return {
    id: pickString(row, ["id", "_id", "documentId"]) ?? "",
    number: pickString(row, ["number", "documentNumber", "numbering"]),
    type: pickNumber(row, ["type", "documentType"]) ?? 0,
    status:
      pickString(row, ["state"]) ??
      (typeof row.status === "number" ? String(row.status) : pickString(row, ["status"])) ??
      "created",
    amount: pickNumber(row, ["amountLocal", "amount", "sum", "total"]),
    currency: pickString(row, ["currency"]) ?? "ILS",
    morningUrl: pickString(url, ["he", "origin", "en"]) ?? pickString(row, ["viewUrl", "documentUrl"]),
    pdfUrl: pickString(row, ["pdfUrl", "pdf", "downloadUrl"]),
    raw: row,
  };
}

async function morningJson(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

function extractMorningErrorMessage(json: Record<string, unknown>, fallback: string) {
  const direct = pickString(json, ["error_description", "error", "message"]);
  if (direct) return direct;

  const data = ensureObject(json.data);
  const dataMessage = pickString(data, ["error", "error_description", "message"]);
  if (dataMessage) return dataMessage;

  const nestedError = ensureObject(json.error);
  const nestedMessage = pickString(nestedError, ["message", "description", "error"]);
  if (nestedMessage) return nestedMessage;

  const raw = typeof json.raw === "string" ? json.raw.trim() : "";
  return raw || fallback;
}

export async function getMorningToken(forceRefresh = false) {
  const config = requireConfig();
  if (!forceRefresh && cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.value;
  }

  const response = await fetch(config.authUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: config.keyId,
      client_secret: config.keySecret,
    }),
    cache: "no-store",
  });

  const json = await morningJson(response);
  if (!response.ok) {
    throw new Error(extractMorningErrorMessage(json, "קבלת טוקן מ-Morning נכשלה."));
  }

  const token =
    pickString(json, ["accessToken", "token", "access_token"]) ??
    pickString(ensureObject(json.data), ["accessToken", "token", "access_token"]);
  if (!token) {
    throw new Error("Morning לא החזיר טוקן תקין.");
  }

  const expiresAt =
    pickNumber(json, ["expiresAt"]) ??
    pickNumber(ensureObject(json.data), ["expiresAt"]);
  const expiresIn =
    (expiresAt !== null ? Math.max(0, expiresAt - Math.floor(Date.now() / 1000)) : null) ??
    pickNumber(json, ["expires_in", "expiresIn"]) ??
    pickNumber(ensureObject(json.data), ["expires_in", "expiresIn"]) ??
    3600;

  cachedToken = {
    value: token,
    expiresAt: Date.now() + expiresIn * 1000,
  };

  return token;
}

export async function morningFetch<T = Record<string, unknown>>(
  path: string,
  init?: RequestInit & { retryOnAuth?: boolean }
) {
  const config = requireConfig();
  const token = await getMorningToken();
  const url = `${config.resourceBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;

  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (response.status === 401 && init?.retryOnAuth !== false) {
    const freshToken = await getMorningToken(true);
    const retry = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${freshToken}`,
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
    const retryJson = await morningJson(retry);
    if (!retry.ok) {
      throw new Error(extractMorningErrorMessage(retryJson, "קריאה ל-Morning נכשלה."));
    }
    return retryJson as T;
  }

  const json = await morningJson(response);
  if (!response.ok) {
    throw new Error(extractMorningErrorMessage(json, "קריאה ל-Morning נכשלה."));
  }

  return json as T;
}

function extractCollection(json: Record<string, unknown>) {
  const directArrays = [json.items, json.rows, json.clients, json.data, json.results];
  for (const value of directArrays) {
    if (Array.isArray(value)) return value;
  }

  const data = ensureObject(json.data);
  const nestedArrays = [data.items, data.rows, data.clients, data.results];
  for (const value of nestedArrays) {
    if (Array.isArray(value)) return value;
  }

  return [];
}

function buildMorningClientPayload(customer: MorningCustomerRow) {
  return {
    name: customer.invoiceName?.trim() || customer.name.trim(),
    companyName: customer.name.trim(),
    email: customer.email?.trim() || undefined,
    phone: customer.phone?.trim() || undefined,
    mobile: customer.phone?.trim() || undefined,
    taxId: customer.registrationNumber?.trim() || undefined,
    registrationNumber: customer.registrationNumber?.trim() || undefined,
    address: customer.address?.trim() || undefined,
  };
}

export async function listMorningClients() {
  const json = await morningFetch<Record<string, unknown>>("/clients/search", {
    method: "POST",
    body: JSON.stringify({ page: 1, pageSize: 500 }),
  });
  return extractCollection(json).map(normalizeMorningClient).filter((client) => client.id);
}

export async function getMorningClient(id: string) {
  const json = await morningFetch<Record<string, unknown>>(`/clients/${encodeURIComponent(id)}`, {
    method: "GET",
  });
  return normalizeMorningClient(ensureObject(json.data ?? json));
}

export async function createMorningClientFromCustomerRecord(customer: MorningCustomerRow) {
  const json = await morningFetch<Record<string, unknown>>("/clients", {
    method: "POST",
    body: JSON.stringify(buildMorningClientPayload(customer)),
  });
  return normalizeMorningClient(ensureObject(json.data ?? json));
}

export async function updateMorningClientFromCustomerRecord(
  morningClientId: string,
  customer: MorningCustomerRow
) {
  const json = await morningFetch<Record<string, unknown>>(`/clients/${encodeURIComponent(morningClientId)}`, {
    method: "PUT",
    body: JSON.stringify(buildMorningClientPayload(customer)),
  });
  return normalizeMorningClient(ensureObject(json.data ?? json));
}

export async function findMorningClientCandidatesForCustomer(customer: MorningCustomerRow) {
  const clients = await listMorningClients();
  return findMorningClientCandidatesForCustomerRecord(customer, clients);
}

function mapLines(lines: MorningCreateDocumentPayload["lines"]) {
  return lines.map((line) => ({
    description: line.description,
    quantity: line.quantity,
    price: line.unitPrice,
    currency: "ILS",
    vatType: line.vatType ?? "include",
    sku: line.sku ?? undefined,
  }));
}

export async function createMorningDocument(payload: MorningCreateDocumentPayload) {
  const json = await morningFetch<Record<string, unknown>>("/documents", {
    method: "POST",
    body: JSON.stringify({
      type: payload.type,
      client: {
        id: payload.clientId,
      },
      currency: payload.currency ?? "ILS",
      remarks: payload.remarks ?? undefined,
      description: payload.description ?? undefined,
      externalId: payload.externalId ?? undefined,
      income: mapLines(payload.lines),
    }),
  });
  return normalizeMorningDocument(ensureObject(json.data ?? json));
}

export async function getMorningDocument(id: string) {
  const json = await morningFetch<Record<string, unknown>>(`/documents/${encodeURIComponent(id)}`, {
    method: "GET",
  });
  return normalizeMorningDocument(ensureObject(json.data ?? json));
}

export async function closeOrCancelMorningDocument(id: string) {
  const attempts = [
    { path: `/documents/${encodeURIComponent(id)}/close`, method: "POST" },
    { path: `/documents/${encodeURIComponent(id)}/cancel`, method: "POST" },
  ];

  let lastError: Error | null = null;
  for (const attempt of attempts) {
    try {
      const json = await morningFetch<Record<string, unknown>>(attempt.path, { method: attempt.method });
      return normalizeMorningDocument(ensureObject(json.data ?? json));
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("סגירת מסמך ב-Morning נכשלה.");
    }
  }

  throw lastError ?? new Error("סגירת מסמך ב-Morning נכשלה.");
}

export type { MorningCustomerRow, MorningClientMatchCandidate };
