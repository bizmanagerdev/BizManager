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

export default function SalaryProtected({ children }: SalaryProtectedProps) {
  return <>{children}</>;
}
