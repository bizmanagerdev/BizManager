import { Suspense } from "react";
import RegisterClient from "@/app/register/RegisterClient";

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterClient />
    </Suspense>
  );
}

