"use client";

import { useEffect } from "react";

export default function PwaRegistration() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    void navigator.serviceWorker.register("/sw.js");
  }, []);

  return null;
}
