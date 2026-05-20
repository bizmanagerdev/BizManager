"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MorningDocumentType } from "@/lib/morning/types";
import type { MorningSettings } from "@/lib/morning/settings";

type Props = {
  initial: MorningSettings;
};

export default function MorningAutoIssueForm({ initial }: Props) {
  const [autoInvoice, setAutoInvoice] = useState(initial.autoInvoiceOnOrderCompletion);
  const [invoiceType, setInvoiceType] = useState<MorningSettings["invoiceTypeOnCompletion"]>(
    initial.invoiceTypeOnCompletion
  );
  const [autoReceipt, setAutoReceipt] = useState(initial.autoReceiptOnPayment);
  const [receiptType, setReceiptType] = useState<MorningSettings["receiptTypeOnPayment"]>(
    initial.receiptTypeOnPayment
  );
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const response = await fetch("/api/morning/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          autoInvoiceOnOrderCompletion: autoInvoice,
          invoiceTypeOnCompletion: invoiceType,
          autoReceiptOnPayment: autoReceipt,
          receiptTypeOnPayment: receiptType,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "שמירת ההגדרות נכשלה.");
      }
      toast.success("ההגדרות נשמרו.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "שמירת ההגדרות נכשלה.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>חשבונית אוטומטית להזמנה</CardTitle>
          <CardDescription>
            כאשר נוצרת הזמנה חדשה — או כאשר סטטוס הזמנה משתנה ל-״סופקה״ / ״הושלמה״ / ״סגורה״ — תיווצר ב-Morning חשבונית עבור הלקוח.
            כפילויות נחסמות אוטומטית: רק חשבונית אחת תונפק לכל הזמנה (גם אם שני האירועים מתרחשים).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <label className="flex items-center gap-2 rounded-xl border px-3 py-3">
            <input
              type="checkbox"
              checked={autoInvoice}
              onChange={(event) => setAutoInvoice(event.target.checked)}
            />
            <span>הפעל הנפקת חשבונית אוטומטית להזמנה</span>
          </label>

          <div className="space-y-1 rounded-xl border px-3 py-3">
            <div className="font-medium">סוג מסמך להנפקה</div>
            <div className="flex flex-wrap gap-2 pt-1">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="invoiceType"
                  checked={invoiceType === MorningDocumentType.TaxInvoice}
                  onChange={() => setInvoiceType(MorningDocumentType.TaxInvoice)}
                />
                <span>חשבונית מס (305)</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="invoiceType"
                  checked={invoiceType === MorningDocumentType.TaxInvoiceReceipt}
                  onChange={() => setInvoiceType(MorningDocumentType.TaxInvoiceReceipt)}
                />
                <span>חשבונית מס-קבלה (320)</span>
              </label>
            </div>
            <p className="pt-1 text-xs text-muted-foreground">
              חשבונית מס-קבלה מתאימה כשההזמנה משולמת במלואה. חשבונית מס רגילה מתאימה כשעדיין יש יתרה לתשלום.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>קבלה אוטומטית בעת רישום תשלום</CardTitle>
          <CardDescription>
            עם כל תשלום חיובי שנרשם ל-BizH (בהזמנה או פרויקט עם לקוח), תיווצר ב-Morning קבלה.
            תשלומים ללא לקוח מקושר ידולגו.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <label className="flex items-center gap-2 rounded-xl border px-3 py-3">
            <input
              type="checkbox"
              checked={autoReceipt}
              onChange={(event) => setAutoReceipt(event.target.checked)}
            />
            <span>הפעל הנפקת קבלה אוטומטית בעת רישום תשלום</span>
          </label>

          <div className="space-y-1 rounded-xl border px-3 py-3">
            <div className="font-medium">סוג מסמך להנפקה</div>
            <div className="flex flex-wrap gap-2 pt-1">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="receiptType"
                  checked={receiptType === MorningDocumentType.Receipt}
                  onChange={() => setReceiptType(MorningDocumentType.Receipt)}
                />
                <span>קבלה (400)</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="receiptType"
                  checked={receiptType === MorningDocumentType.TaxInvoiceReceipt}
                  onChange={() => setReceiptType(MorningDocumentType.TaxInvoiceReceipt)}
                />
                <span>חשבונית מס-קבלה (320)</span>
              </label>
            </div>
            <p className="pt-1 text-xs text-muted-foreground">
              אם בוחרים חשבונית מס-קבלה גם להזמנה וגם לתשלום — שימו לב שתונפק רק פעם אחת לכל מקור (הזמנה/תשלום).
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "שומר..." : "שמור הגדרות"}
        </Button>
      </div>
    </div>
  );
}
