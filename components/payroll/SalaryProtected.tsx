"use client";

type SalaryProtectedProps = {
  unlocked: boolean;
  hasPasswordConfigured: boolean;
  canUnlock: boolean;
  title?: string;
  description?: string;
  onUnlockSuccess?: () => void | Promise<void>;
  children: React.ReactNode;
  fallback?: React.ReactNode;
};

export default function SalaryProtected({ canUnlock, children, fallback }: SalaryProtectedProps) {
  // Salary values are admin-only. Non-admin viewers (e.g. office) cannot unlock,
  // so they see the protected fallback instead of the real figure.
  if (!canUnlock) return <>{fallback ?? null}</>;
  return <>{children}</>;
}
