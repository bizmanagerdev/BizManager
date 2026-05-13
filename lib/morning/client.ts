import { findMorningClientCandidatesForCustomerRecord, type LocalCustomerForMatching } from "@/lib/morning/matching";
import { resolveMorningConfig, type MorningConfig } from "@/lib/morning/config";
import { MorningClient, MorningClientMatchCandidate, MorningCreateDocumentPayload, MorningDocumentResult } from "@/lib/morning/types";

type MorningCustomerRow = LocalCustomerForMatching & {
  address?: string | null;
};

let cachedToken: { value: string; expiresAt: number } | null = null;

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

function pickIsoDate(obj: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      const millis = value > 10_000_000_000 ? value : value * 1000;
      const parsed = new Date(millis);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
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
    issuedAt: pickIsoDate(row, ["issueDate", "date", "creationDate", "createdAt"]),
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

type MorningTokenRequestFormat = "form" | "json";

export const MORNING_TOKEN_REQUEST_FORMATS: MorningTokenRequestFormat[] = ["form", "json"];

function buildMorningTokenRequestInit(config: MorningConfig, format: MorningTokenRequestFormat): RequestInit {
  if (format === "form") {
    return {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.keyId,
        client_secret: config.keySecret,
      }).toString(),
      cache: "no-store",
    };
  }

  return {
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
  };
}

export async function fetchMorningTokenResponse(
  config: MorningConfig,
  formats: MorningTokenRequestFormat[] = MORNING_TOKEN_REQUEST_FORMATS
) {
  let lastAttempt:
    | {
        format: MorningTokenRequestFormat;
        response: Response;
        json: Record<string, unknown>;
      }
    | null = null;

  for (const format of formats) {
    const response = await fetch(config.authUrl, buildMorningTokenRequestInit(config, format));
    const json = await morningJson(response);
    lastAttempt = { format, response, json };
    if (response.ok) return lastAttempt;
  }

  if (lastAttempt) return lastAttempt;
  throw new Error("Morning token request was not attempted.");
}

export async function getMorningToken(forceRefresh = false) {
  const config = resolveMorningConfig();
  if (!forceRefresh && cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.value;
  }

  const { response, json } = await fetchMorningTokenResponse(config);
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
  const config = resolveMorningConfig();
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
