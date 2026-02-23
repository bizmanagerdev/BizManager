import { Suspense } from "react";
import ResetPasswordClient from "@/app/reset-password/ResetPasswordClient";

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordClient />
    </Suspense>
  );
}

