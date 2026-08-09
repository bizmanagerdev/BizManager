"use client";
import { toHebrewError } from "@/lib/error-messages";

import { useState } from "react";
import { toast } from "sonner";
import { DownloadIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function BackupCard() {
  const [loading, setLoading] = useState(false);

  async function handleDownload() {
    setLoading(true);
    try {
      const res = await fetch("/api/backup/export");
      if (!res.ok) {
        let msg = "הורדת הגיבוי נכשלה";
        try {
          const j = await res.json();
          if (j?.error) msg = j.error;
        } catch {
          /* non-JSON error body */
        }
        throw new Error(msg);
      }

      const blob = await res.blob();
      const filename =
        res.headers.get("X-Backup-Filename") ||
        `bizmanager-backup-${new Date().toISOString().slice(0, 10)}.xlsx`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success("הגיבוי הורד בהצלחה");
    } catch (e) {
      toast.error(toHebrewError(e, "הורדת הגיבוי נכשלה"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>גיבוי נתונים</CardTitle>
        <CardDescription>הורד עותק מלא של כל נתוני המערכת כקובץ Excel — גיליון לכל טבלה.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          הקובץ כולל לקוחות, הזמנות, פרויקטים, תשלומים, הוצאות, מלאי, נוכחות, שכר ועוד.
          מומלץ להוריד גיבוי באופן קבוע ולשמור עותק מחוץ למערכת.
        </p>
        <Button onClick={handleDownload} disabled={loading}>
          <DownloadIcon />
          {loading ? "מכין גיבוי..." : "הורד גיבוי מלא (Excel)"}
        </Button>
      </CardContent>
    </Card>
  );
}
