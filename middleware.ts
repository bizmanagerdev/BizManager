// import { NextResponse, type NextRequest } from "next/server";
// import { createServerClient } from "@supabase/ssr";

// export async function middleware(req: NextRequest) {
//   let res = NextResponse.next({ request: req });

//   const supabase = createServerClient(
//     process.env.NEXT_PUBLIC_SUPABASE_URL!,
//     process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
//     {
//       cookies: {
//         getAll: () => req.cookies.getAll(),
//         setAll: (cookiesToSet) => {
//           cookiesToSet.forEach(({ name, value, options }) => {
//             res.cookies.set(name, value, options);
//           });
//         },
//       },
//     }
//   );

//   // IMPORTANT: use getUser() (verified auth check)
//   const {
//     data: { user },
//   } = await supabase.auth.getUser();

//   const path = req.nextUrl.pathname;

//   // If logged in and trying to view /login, send to dashboard
//   if (user && path.startsWith("/login")) {
//     const url = req.nextUrl.clone();
//     url.pathname = "/dashboard";
//     return NextResponse.redirect(url);
//   }

//   // Protect private routes
//   const isPrivate =
//     path.startsWith("/dashboard") ||
//     path.startsWith("/projects") ||
//     path.startsWith("/sales") ||
//     path.startsWith("/inventory") ||
//     path.startsWith("/payroll");

//   if (!user && isPrivate) {
//     const url = req.nextUrl.clone();
//     url.pathname = "/login";
//     return NextResponse.redirect(url);
//   }

//   return res;
// }

// export const config = {
//   matcher: ["/login", "/dashboard/:path*", "/projects/:path*", "/sales/:path*", "/inventory/:path*", "/payroll/:path*"], 
// };
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function middleware(_req: NextRequest) {
  return NextResponse.next();
}