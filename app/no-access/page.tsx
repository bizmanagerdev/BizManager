import { Button } from "@/components/ui/button";

export default function NoAccessPage() {
  return (
    <div style={{ padding: 24 }}>
      <h1>אין גישה</h1>
      <p>
        לחשבון שלך אין גישה לאזור הזה. אם זה נראה כמו טעות, פני או פנה למנהל
        המערכת.
      </p>
      <form action="/api/auth/logout" method="post" style={{ marginTop: 16 }}>
        <Button type="submit">מעבר לדף ההתחברות</Button>
      </form>
    </div>
  );
}
