import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import {
  fetchMorningTokenResponse,
  getMorningToken,
  MORNING_TOKEN_REQUEST_FORMATS,
} from "@/lib/morning/client";
import {
  normalizeMorningAuthBaseUrl,
  normalizeMorningResourceBaseUrl,
} from "@/lib/morning/config";

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

export async function GET() {
  const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
  if (!access.ok) return access.response;

  const sandbox = process.env.MORNING_SANDBOX === "true";
  const authBaseUrl = normalizeMorningAuthBaseUrl(process.env.MORNING_AUTH_BASE_URL, sandbox);
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
    primaryContentType: "application/x-www-form-urlencoded",
    fallbackContentType: "application/json",
    fieldNames: ["grant_type", "client_id", "client_secret"],
    grant_type: "client_credentials",
    client_id: maskValue(trimmedKeyId),
    client_secret: summarizeSecret(trimmedSecret),
    requestFormats: MORNING_TOKEN_REQUEST_FORMATS,
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
    let upstreamRequestFormat: string | null = null;

    if (hasCredentials) {
      try {
        const upstreamAttempt = await fetchMorningTokenResponse({
          sandbox,
          authBaseUrl,
          authUrl,
          resourceBaseUrl,
          keyId: trimmedKeyId ?? "",
          keySecret: trimmedSecret ?? "",
        });
        upstreamStatus = upstreamAttempt.response.status;
        upstreamStatusText = upstreamAttempt.response.statusText;
        upstreamContentType = upstreamAttempt.response.headers.get("content-type");
        upstreamBody = upstreamAttempt.json;
        upstreamRequestFormat = upstreamAttempt.format;
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
        upstreamRequestFormat,
        upstreamBody,
      },
      { status: 400 }
    );
  }
}
