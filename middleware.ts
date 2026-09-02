import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(req: NextRequest) {
  const res = NextResponse.next({ request: req });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return res;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value, options }) => {
          res.cookies.set(name, value, options);
        });
      },
    },
  });

  // getSession(), NOT getUser(). getUser() makes an HTTP call to the Auth
  // server on every invocation — and this middleware runs on every request the
  // matcher below admits: each page, each RSC payload, and each link prefetch
  // Next fires on hover. Switching this to getUser() (2026-09-01) put two
  // sequential Auth round-trips in front of every navigation and made the whole
  // app unusable: /auth/v1/user measured 0.7-5.2s against this project, versus
  // 130-300ms for /rest/v1. Worse, a saturated Auth server answers with
  // { user: null } rather than throwing, so the `!user` branch below started
  // bouncing signed-in users to /login mid-session.
  //
  // Reading the cookie's claims without confirming them is acceptable HERE and
  // only here: this gate decides ROUTING, nothing more. A forged cookie buys a
  // redirect decision, not data — every read is still behind requireProfile()'s
  // role/active checks and the table's RLS policies. Verify the token properly
  // with getClaims() (local JWKS signature check, no round-trip) rather than by
  // reintroducing getUser().
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;

  const path = req.nextUrl.pathname;

  const isPublic =
    path.startsWith("/login") ||
    path.startsWith("/register") ||
    path.startsWith("/forgot-password") ||
    path.startsWith("/reset-password") ||
    path === "/manifest.webmanifest" ||
    path === "/sw.js" ||
    path.startsWith("/icon") ||
    path.startsWith("/api");

  if (user && path.startsWith("/login")) {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  if (!user && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
