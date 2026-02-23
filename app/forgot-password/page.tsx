import { Suspense } from "react";
import ForgotPasswordClient from "@/app/forgot-password/ForgotPasswordClient";

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotPasswordClient />
    </Suspense>
  );
}

