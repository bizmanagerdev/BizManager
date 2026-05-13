const DEFAULT_AUTH_BASE_URL = "https://api.morning.co";
const DEFAULT_SANDBOX_AUTH_BASE_URL = "https://api.sandbox.morning.dev";
const DEFAULT_RESOURCE_BASE_URL = "https://api.greeninvoice.co.il/api/v1";
const DEFAULT_SANDBOX_RESOURCE_BASE_URL = "https://sandbox.d.greeninvoice.co.il/api/v1";

export type MorningConfig = {
  resourceBaseUrl: string;
  authBaseUrl: string;
  authUrl: string;
  keyId: string;
  keySecret: string;
  sandbox: boolean;
};

function trimBaseUrl(value: string | undefined) {
  return value?.trim().replace(/\/+$/, "") ?? "";
}

function isProdResourceUrl(value: string) {
  return (
    value === "https://api.greeninvoice.co.il/api" ||
    value === "https://api.greeninvoice.co.il/api/v1" ||
    value === "https://www.greeninvoice.co.il/api" ||
    value === "https://www.greeninvoice.co.il/api/v1" ||
    value === "https://greeninvoice.co.il/api" ||
    value === "https://greeninvoice.co.il/api/v1"
  );
}

function isSandboxResourceUrl(value: string) {
  return (
    value === "https://sandbox.d.greeninvoice.co.il/api" ||
    value === "https://sandbox.d.greeninvoice.co.il/api/v1"
  );
}

export function normalizeMorningAuthBaseUrl(value: string | undefined, sandbox: boolean) {
  const trimmed = trimBaseUrl(value);
  if (!trimmed) {
    return sandbox ? DEFAULT_SANDBOX_AUTH_BASE_URL : DEFAULT_AUTH_BASE_URL;
  }

  if (isProdResourceUrl(trimmed) || trimmed === DEFAULT_AUTH_BASE_URL) {
    return DEFAULT_AUTH_BASE_URL;
  }

  if (isSandboxResourceUrl(trimmed) || trimmed === DEFAULT_SANDBOX_AUTH_BASE_URL) {
    return DEFAULT_SANDBOX_AUTH_BASE_URL;
  }

  return trimmed;
}

export function normalizeMorningResourceBaseUrl(value: string | undefined, sandbox: boolean) {
  const trimmed = trimBaseUrl(value);
  if (!trimmed) {
    return sandbox ? DEFAULT_SANDBOX_RESOURCE_BASE_URL : DEFAULT_RESOURCE_BASE_URL;
  }

  if (trimmed === DEFAULT_AUTH_BASE_URL) {
    return DEFAULT_RESOURCE_BASE_URL;
  }

  if (trimmed === DEFAULT_SANDBOX_AUTH_BASE_URL) {
    return DEFAULT_SANDBOX_RESOURCE_BASE_URL;
  }

  if (trimmed === "https://api.greeninvoice.co.il/api") {
    return DEFAULT_RESOURCE_BASE_URL;
  }

  if (isProdResourceUrl(trimmed)) {
    return DEFAULT_RESOURCE_BASE_URL;
  }

  if (trimmed === "https://sandbox.d.greeninvoice.co.il/api") {
    return DEFAULT_SANDBOX_RESOURCE_BASE_URL;
  }

  if (isSandboxResourceUrl(trimmed)) {
    return DEFAULT_SANDBOX_RESOURCE_BASE_URL;
  }

  return trimmed;
}

export function resolveMorningConfig(): MorningConfig {
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
    authBaseUrl,
    authUrl: `${authBaseUrl}/idp/v1/oauth/token`,
    keyId,
    keySecret,
    sandbox,
  };
}

