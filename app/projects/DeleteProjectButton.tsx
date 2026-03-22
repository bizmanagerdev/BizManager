"use client";

import { type ReactNode, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function DeleteProjectButton({
  projectId,
  projectName,
  redirectTo,
  onDeleted,
  size = "sm",
  className,
  children,
  ariaLabel,
}: {
  projectId: string;
  projectName?: string;
  redirectTo?: string;
  onDeleted?: () => void;
  size?: "default" | "sm" | "lg" | "icon" | "icon-sm";
  className?: string;
  children?: ReactNode;
  ariaLabel?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    if (loading) return;

    const label = projectName?.trim() || "הפרויקט";
    const confirmed = window.confirm(`למחוק את ${label}? הפעולה אינה הפיכה.`);
    if (!confirmed) return;

    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/projects/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: projectId }),
      });

      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
        warning?: string;
      };

      if (!res.ok || !json.ok) {
        setError(json.error ?? "מחיקת פרויקט נכשלה.");
        return;
      }

      onDeleted?.();

      if (redirectTo) {
        router.push(redirectTo);
      }

      router.refresh();

      if (json.warning) {
        setError(json.warning);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "שגיאה לא ידועה");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="destructive"
        size={size}
        onClick={() => void onDelete()}
        disabled={loading}
        className={className}
        aria-label={ariaLabel}
        title={ariaLabel}
      >
        {loading ? "מוחק..." : children ?? "מחיקת פרויקט"}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
