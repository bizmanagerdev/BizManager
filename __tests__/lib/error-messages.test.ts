import { describe, it, expect } from "vitest";
import { toHebrewError } from "@/lib/error-messages";

describe("toHebrewError — input shape extraction", () => {
  it("reads .message off an Error instance", () => {
    expect(toHebrewError(new Error("Forbidden"))).toBe("אין הרשאה לבצע פעולה זו.");
  });
  it("accepts a plain string", () => {
    expect(toHebrewError("Not Found")).toBe("המשאב לא נמצא.");
  });
  it("reads .error off a plain object (a typical API error-response shape)", () => {
    expect(toHebrewError({ error: "Unauthorized" })).toBe("יש להתחבר מחדש.");
  });
  it("falls back for null/undefined/an object with no .error", () => {
    expect(toHebrewError(null)).toBe("אירעה שגיאה. נסו שוב.");
    expect(toHebrewError(undefined)).toBe("אירעה שגיאה. נסו שוב.");
    expect(toHebrewError({})).toBe("אירעה שגיאה. נסו שוב.");
  });
  it("falls back for an empty/whitespace-only message", () => {
    expect(toHebrewError("")).toBe("אירעה שגיאה. נסו שוב.");
    expect(toHebrewError("   ")).toBe("אירעה שגיאה. נסו שוב.");
  });
  it("a custom fallback is honored", () => {
    expect(toHebrewError(null, "שגיאה מותאמת.")).toBe("שגיאה מותאמת.");
  });
});

describe("toHebrewError — already-Hebrew text passes through unchanged", () => {
  it("does not run an existing Hebrew message through the tables at all", () => {
    expect(toHebrewError("ההזמנה נמחקה בהצלחה")).toBe("ההזמנה נמחקה בהצלחה");
  });
});

describe("toHebrewError — exact-match table", () => {
  it("a handful of representative exact matches", () => {
    expect(toHebrewError("Failed to fetch")).toBe("אין חיבור לשרת. נסו שוב.");
    expect(toHebrewError("Expense not found")).toBe("ההוצאה לא נמצאה.");
    expect(toHebrewError("Missing due_date for check payment")).toBe("יש להזין תאריך פירעון לצ'ק.");
    expect(toHebrewError("Session is already closed.")).toBe("המשמרת כבר סגורה.");
  });
  it("exact match takes priority over a pattern rule that would ALSO match the same text", () => {
    // "Missing order_id" has its own exact entry AND would also match the
    // generic /^Missing / pattern rule — the specific one must win.
    expect(toHebrewError("Missing order_id")).toBe("חסר מזהה הזמנה.");
    expect(toHebrewError("Missing order_id")).not.toBe("חסר אחד משדות החובה.");
  });
});

describe("toHebrewError — pattern rules", () => {
  it("Postgres constraint violations get specific, actionable wording", () => {
    expect(toHebrewError('duplicate key value violates unique constraint "orders_pkey"')).toBe(
      "הערך כבר קיים במערכת."
    );
    expect(toHebrewError("update or delete violates foreign key constraint")).toBe(
      "לא ניתן לבצע את הפעולה — קיים קישור לרשומה אחרת."
    );
    expect(toHebrewError('null value in column "amount" violates not-null constraint')).toBe(
      "חסר שדה חובה."
    );
  });

  it("a missing DB column (undeployed migration) gets its own actionable message, not a generic fallback", () => {
    expect(toHebrewError('column "vat_rate" does not exist')).toBe(
      "עדכון במסד הנתונים טרם הופעל. יש להריץ את המיגרציה האחרונה ולנסות שוב, או לפנות למפתח."
    );
  });

  it("Supabase auth error text gets translated (was previously a silent 'נכשל' with no explanation)", () => {
    expect(toHebrewError("New password should be different from the old password.")).toBe(
      "הסיסמה החדשה זהה לנוכחית. יש לבחור סיסמה אחרת."
    );
    expect(toHebrewError("Password should be at least 6 characters")).toBe(
      "הסיסמה קצרה מדי — יש לבחור סיסמה ארוכה יותר."
    );
    expect(toHebrewError("Auth session missing")).toBe("החיבור פג. יש להתחבר מחדש ולנסות שוב.");
  });

  it("network/timeout errors are distinguished from each other", () => {
    expect(toHebrewError("Request timed out")).toBe("התשובה מהשרת איחרה. נסו שוב.");
    expect(toHebrewError("ECONNREFUSED")).toBe("אין חיבור לשרת. נסו שוב.");
  });

  it("generic prefix/suffix rules catch unlisted messages in the same shape as the curated ones", () => {
    expect(toHebrewError("Vehicle not found.")).toBe("הפריט המבוקש לא נמצא.");
    expect(toHebrewError("Invalid tag_id")).toBe("אחד הערכים שהוזנו אינו תקין.");
    expect(toHebrewError("Failed to archive document")).toBe("הפעולה נכשלה. נסו שוב.");
    expect(toHebrewError("Notes field is required.")).toBe("יש למלא את כל שדות החובה.");
    expect(toHebrewError("Amount must be positive")).toBe("אחד הערכים אינו בטווח התקין.");
    expect(toHebrewError("Document was not deleted")).toBe("הפעולה לא הושלמה. נסו שוב.");
  });
});

describe("toHebrewError — genuinely unrecognized text falls back, never leaks raw English", () => {
  it("a completely unmatched message returns the fallback, not the raw text", () => {
    expect(toHebrewError("Something exotic went sideways in a way nobody wrote a rule for")).toBe(
      "אירעה שגיאה. נסו שוב."
    );
  });
});
