"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function DeleteOrderButton({ orderId }: { orderId: string }) {
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
      <Button type="button" variant="destructive" size="sm" onClick={() => void onDelete()} disabled={loading}>
        {loading ? "מוחק..." : "מחיקת הזמנה"}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
