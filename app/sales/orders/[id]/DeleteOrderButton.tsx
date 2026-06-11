"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { Button } from "@/components/ui/button";

export default function DeleteOrderButton({
  orderId,
  iconOnly = false,
}: {
  orderId: string;
  iconOnly?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    if (loading) return;

    const confirmed = window.confirm("האם למחוק את ההזמנה? הפעולה אינה הפיכה.");
    if (!confirmed) return;

    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/orders/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_id: orderId }),
      });

      const json = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean };

      if (!res.ok || !json.ok) {
        setError(json.error ?? "מחיקת הזמנה נכשלה.");
        return;
      }

      emitNavigationStart();
      router.push("/sales");
      router.refresh();
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
        size="sm"
        className={iconOnly ? "h-9 w-9 p-0" : undefined}
        aria-label="מחיקת הזמנה"
        title="מחיקת הזמנה"
        onClick={() => void onDelete()}
        disabled={loading}
      >
        {iconOnly ? <Trash2 className="h-4 w-4" /> : loading ? "מוחק..." : "מחיקת הזמנה"}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
