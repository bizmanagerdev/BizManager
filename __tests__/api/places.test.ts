import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Google lookup behind the address picker: signed-in people only, the key
// stays on the server, Google is asked in Hebrew for Israel, and a Google
// failure reaches the person as a plain sentence.

const { requireRouteAccess } = vi.hoisted(() => ({ requireRouteAccess: vi.fn() }));
vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));

import { POST as autocomplete } from "@/app/api/places/autocomplete/route";
import { POST as details } from "@/app/api/places/details/route";

const TOKEN = "3f2b6c1e-1111-4a5b-9c7d-0123456789ab";
const google = vi.fn();
const post = (fn: (req: Request) => Promise<Response>, body: unknown) =>
  fn(new Request("http://test/api/places", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  requireRouteAccess.mockReset();
  requireRouteAccess.mockResolvedValue({ ok: true, value: { supabase: {}, user: { id: "auth-1" }, profile: { id: "u1" } } });
  google.mockReset();
  vi.stubGlobal("fetch", google);
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GOOGLE_PLACES_API_KEY;
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("POST /api/places/autocomplete", () => {
  it("is for signed-in people only", async () => {
    requireRouteAccess.mockResolvedValue({ ok: false, response: json({ error: "Unauthorized" }, 401) });
    const res = await post(autocomplete, { input: "יחזקאל", sessionToken: TOKEN });
    expect(res.status).toBe(401);
    expect(google).not.toHaveBeenCalled();
  });

  it("asks Google in Hebrew, in Israel, with the session token and the key in a header", async () => {
    google.mockResolvedValue(
      json({
        suggestions: [
          {
            placePrediction: {
              placeId: "ChIJ-1",
              structuredFormat: { mainText: { text: "יחזקאל הנביא 27" }, secondaryText: { text: "בית שמש, ישראל" } },
              types: ["street_address", "geocode"],
            },
          },
          { placePrediction: { placeId: "ChIJ-2", structuredFormat: { mainText: { text: "חזון איש" } }, types: ["route"] } },
          { placePrediction: { placeId: "ChIJ-3", structuredFormat: { mainText: { text: "אלומה" } }, types: ["locality"] } },
        ],
      })
    );
    const res = await post(autocomplete, { input: " יחזקאל הנביא 27 ", sessionToken: TOKEN });
    const body = await res.json();
    expect(body.suggestions).toEqual([
      { placeId: "ChIJ-1", main: "יחזקאל הנביא 27", secondary: "בית שמש, ישראל", kind: "address" },
      { placeId: "ChIJ-2", main: "חזון איש", secondary: "", kind: "street" },
      { placeId: "ChIJ-3", main: "אלומה", secondary: "", kind: "settlement" },
    ]);
    const [url, init] = google.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://places.googleapis.com/v1/places:autocomplete");
    expect((init.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe("test-key");
    expect(JSON.parse(String(init.body))).toMatchObject({
      input: "יחזקאל הנביא 27",
      sessionToken: TOKEN,
      languageCode: "he",
      includedRegionCodes: ["il", "ps"],
    });
  });

  it("one letter doesn't ask Google", async () => {
    const res = await post(autocomplete, { input: "י", sessionToken: TOKEN });
    expect(await res.json()).toEqual({ suggestions: [] });
    expect(google).not.toHaveBeenCalled();
  });

  it("refuses a call with no session token", async () => {
    const res = await post(autocomplete, { input: "יחזקאל" });
    expect(res.status).toBe(400);
  });

  it("no key on the server says so", async () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    const res = await post(autocomplete, { input: "יחזקאל", sessionToken: TOKEN });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("GOOGLE_PLACES_API_KEY");
  });

  it("Google's refusal reaches the person as a plain sentence", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    google.mockResolvedValue(json({ error: { status: "PERMISSION_DENIED", message: "API key not valid" } }, 403));
    const res = await post(autocomplete, { input: "יחזקאל", sessionToken: TOKEN });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("חיפוש הכתובות לא זמין כרגע. נסו שוב בעוד רגע.");
  });
});

describe("POST /api/places/details", () => {
  it("asks only for the address fields, in the same session, and returns them apart", async () => {
    google.mockResolvedValue(
      json({
        id: "ChIJ-1",
        shortFormattedAddress: "יחזקאל הנביא 27, בית שמש",
        addressComponents: [
          { longText: "27", types: ["street_number"] },
          { longText: "יחזקאל הנביא", types: ["route"] },
          { longText: "בית שמש", types: ["locality", "political"] },
        ],
        location: { latitude: 31.7, longitude: 34.98 },
      })
    );
    const res = await post(details, { placeId: "ChIJ-yechezkel-27", sessionToken: TOKEN });
    expect((await res.json()).address).toMatchObject({ city: "בית שמש", street: "יחזקאל הנביא", houseNumber: "27", lat: 31.7 });
    const [url, init] = google.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/places/ChIJ-yechezkel-27?");
    expect(url).toContain(`sessionToken=${TOKEN}`);
    expect((init.headers as Record<string, string>)["X-Goog-FieldMask"]).toBe(
      "id,formattedAddress,shortFormattedAddress,addressComponents,location"
    );
  });

  it("refuses a malformed place id", async () => {
    const res = await post(details, { placeId: "../x", sessionToken: TOKEN });
    expect(res.status).toBe(400);
    expect(google).not.toHaveBeenCalled();
  });
});
