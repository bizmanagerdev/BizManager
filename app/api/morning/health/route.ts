import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { getMorningToken } from "@/lib/morning/client";

function maskValue(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  if (trimmed.length <= 6) return `${trimmed[0] ?? ""}***`;
  return `${trimmed.slice(0, 3)}***${trimmed.slice(-2)}`;
}

function summarizeSecret(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return {
      masked: null,
      length: 0,
      startsWith: null,
      endsWith: null,
    };
  }

  return {
    masked: maskValue(trimmed),
    length: trimmed.length,
    startsWith: trimmed.slice(0, Math.min(2, trimmed.length)),
    endsWith: trimmed.slice(-Math.min(2, trimmed.length)),
  };
}

function normalizeMorningBaseUrl(value: string | undefined, sandbox: boolean) {
  const trimmed = value?.trim().replace(/\/+$/, "") ?? "";
  if (!trimmed) {
    return sandbox ? "https://api.sandbox.morning.dev" : "https://api.morning.co";
  }

  if (trimmed === "https://api.greeninvoice.co.il/api/v1") {
    return "https://api.morning.co";
  }

  if (trimmed === "https://sandbox.d.greeninvoice.co.il/api/v1") {
    return "https://api.sandbox.morning.dev";
  }

  return trimmed;
}

function normalizeMorningResourceBaseUrl(value: string | undefined, sandbox: boolean) {
  const trimmed = value?.trim().replace(/\/+$/, "") ?? "";
  if (!trimmed) {
    return sandbox
      ? "https://sandbox.d.greeninvoice.co.il/api/v1"
      : "https://api.greeninvoice.co.il/api/v1";
  }

  if (trimmed === "https://api.morning.co") {
    return "https://api.greeninvoice.co.il/api/v1";
  }

  if (trimmed === "https://api.sandbox.morning.dev") {
    return "https://sandbox.d.greeninvoice.co.il/api/v1";
  }

  return trimmed;
}

async function readResponseBody(response: Response) {
  const contentType = response.headers.get("content-type") ?? null;
  const text = await response.text();
  if (!text) {
    return { contentType, body: null as unknown };
  }

  try {
    return {
      contentType,
      body: JSON.parse(text) as unknown,
    };
  } catch {
    return {
      contentType,
      body: text,
    };
  }
}

export async function GET() {
  const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
  if (!access.ok) return access.response;

  const sandbox = process.env.MORNING_SANDBOX === "true";
  const authBaseUrl = normalizeMorningBaseUrl(process.env.MORNING_AUTH_BASE_URL, sandbox);
  const resourceBaseUrl = normalizeMorningResourceBaseUrl(process.env.MORNING_API_BASE_URL, sandbox);
  const authUrl = `${authBaseUrl}/idp/v1/oauth/token`;

  const keyId =
    process.env.MORNING_CLIENT_ID ??
    process.env.MORNING_API_KEY_ID ??
    process.env.MORNING_API_KEY;
  const secret =
    process.env.MORNING_CLIENT_SECRET ??
    process.env.MORNING_API_KEY_SECRET ??
    process.env.MORNING_API_SECRET;
  const trimmedKeyId = keyId?.trim();
  const trimmedSecret = secret?.trim();
  const requestPayload = {
    grant_type: "client_credentials",
    client_id: maskValue(trimmedKeyId),
    client_secret: summarizeSecret(trimmedSecret),
    fields: ["grant_type", "client_id", "client_secret"],
  };

  try {
    await getMorningToken(true);
    return NextResponse.json({
      ok: true,
      sandbox,
      baseUrl: resourceBaseUrl,
      authBaseUrl,
      authUrl,
      keyId: maskValue(keyId),
      hasSecret: Boolean(secret?.trim()),
      requestPayload,
    });
  } catch (error) {
    const hasCredentials = Boolean(trimmedKeyId && trimmedSecret);
    let upstreamStatus: number | null = null;
    let upstreamStatusText: string | null = null;
    let upstreamContentType: string | null = null;
    let upstreamBody: unknown = null;

    if (hasCredentials) {
      try {
        const upstreamResponse = await fetch(authUrl, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            grant_type: "client_credentials",
            client_id: trimmedKeyId,
            client_secret: trimmedSecret,
          }),
          cache: "no-store",
        });
        const upstream = await readResponseBody(upstreamResponse);
        upstreamStatus = upstreamResponse.status;
        upstreamStatusText = upstreamResponse.statusText;
        upstreamContentType = upstream.contentType;
        upstreamBody = upstream.body;
      } catch (upstreamError) {
        upstreamBody =
          upstreamError instanceof Error ? upstreamError.message : "Failed to reach Morning token endpoint.";
      }
    }

    return NextResponse.json(
      {
        ok: false,
        sandbox,
        baseUrl: resourceBaseUrl,
        authBaseUrl,
        authUrl,
        keyId: maskValue(keyId),
        hasSecret: Boolean(secret?.trim()),
        error: error instanceof Error ? error.message : "Morning health check failed.",
        requestPayload,
        upstreamStatus,
        upstreamStatusText,
        upstreamContentType,
        upstreamBody,
      },
      { status: 400 }
    );
  }
}
