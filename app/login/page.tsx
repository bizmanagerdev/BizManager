import LoginClient from "@/app/login/LoginClient";

// Fully static: the form is in the prerendered HTML. LoginClient reads
// ?email= after mount rather than with useSearchParams(), which would bail the
// page out to client-side rendering (blank until JS loads).
export default function LoginPage() {
  return <LoginClient />;
}
