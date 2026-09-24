import { describe, it, expect } from "vitest";
import {
  splitFileNameForDisplay,
  formatFileSize,
  stripCopyMarkers,
  isDocumentCategory,
  getDocumentCategoryLabel,
  inferDefaultDocumentCategory,
  DEFAULT_DOCUMENT_CATEGORY,
  isOpaqueDocumentName,
  buildDocumentDisplayName,
  stripFileExtension,
  isFilenameLikeName,
} from "@/lib/documents";

describe("isDocumentCategory", () => {
  it("accepts a value from the controlled list", () => {
    expect(isDocumentCategory("חשבונית")).toBe(true);
  });
  it("rejects free text, null, and undefined", () => {
    expect(isDocumentCategory("משהו אחר")).toBe(false);
    expect(isDocumentCategory(null)).toBe(false);
    expect(isDocumentCategory(undefined)).toBe(false);
  });
});

describe("getDocumentCategoryLabel", () => {
  it("translates a system-generated code to Hebrew", () => {
    expect(getDocumentCategoryLabel("order_delivery_image")).toBe("צילום משלוח");
    expect(getDocumentCategoryLabel("card_statement")).toBe("דף חיוב אשראי");
  });
  it("translates a Morning document type id", () => {
    expect(getDocumentCategoryLabel("morning_305")).toBe("חשבונית מס");
    expect(getDocumentCategoryLabel("morning_999")).toBe("מסמך מורנינג"); // unknown id, generic fallback
  });
  it("passes a controlled Hebrew value straight through", () => {
    expect(getDocumentCategoryLabel("קבלה")).toBe("קבלה");
  });
  it("passes free text straight through (not a controlled/system value)", () => {
    expect(getDocumentCategoryLabel("משהו שהמשתמש כתב")).toBe("משהו שהמשתמש כתב");
  });
  it("shows a placeholder for empty/null/whitespace", () => {
    expect(getDocumentCategoryLabel(null)).toBe("ללא קטגוריה");
    expect(getDocumentCategoryLabel(undefined)).toBe("ללא קטגוריה");
    expect(getDocumentCategoryLabel("   ")).toBe("ללא קטגוריה");
  });
});

describe("inferDefaultDocumentCategory", () => {
  it("defaults an image file to צילום", () => {
    for (const name of ["photo.jpg", "scan.PNG", "shot.heic"]) {
      expect(inferDefaultDocumentCategory(name)).toBe("צילום");
    }
  });
  it("defaults anything else (pdf, no extension, unset) to the generic category", () => {
    expect(inferDefaultDocumentCategory("invoice.pdf")).toBe(DEFAULT_DOCUMENT_CATEGORY);
    expect(inferDefaultDocumentCategory("no-extension")).toBe(DEFAULT_DOCUMENT_CATEGORY);
    expect(inferDefaultDocumentCategory(null)).toBe(DEFAULT_DOCUMENT_CATEGORY);
    expect(inferDefaultDocumentCategory(undefined)).toBe(DEFAULT_DOCUMENT_CATEGORY);
  });
});

describe("isOpaqueDocumentName", () => {
  it("treats camera and messaging filenames as meaningless", () => {
    for (const name of [
      "1001262226.jpg",
      "834091",
      "IMG_4821.HEIC",
      "img-221.png",
      "PXL_20260918.jpg",
      "WhatsApp Image 2026-09-18 at 15.30.jpeg",
      "Screenshot_20260918.png",
      "photo.jpg",
      "scan1.pdf",
      "2026-09-18.pdf",
      "",
      "   ",
    ]) {
      expect(isOpaqueDocumentName(name), name).toBe(true);
    }
  });

  it("keeps a name a person actually typed", () => {
    for (const name of [
      "חוזה שכירות דירת בן יהודה",
      "פוליסת ביטוח רכב 55-123-45",
      "נסח טאבו.pdf",
      "invoice-mekorot-september.pdf",
    ]) {
      expect(isOpaqueDocumentName(name), name).toBe(false);
    }
  });

  it("handles the extension-first shape the archive produces", () => {
    // Stored as "jpg.1001262226" — the base is still just digits.
    expect(isOpaqueDocumentName("jpg.1001262226")).toBe(true);
  });
});

describe("buildDocumentDisplayName", () => {
  it("keeps a real title untouched", () => {
    expect(buildDocumentDisplayName("חוזה שכירות", "חוזה/הסכם", "דירת בן יהודה")).toBe("חוזה שכירות");
  });

  it("names an unnamed file by what it is and who it is for", () => {
    expect(
      buildDocumentDisplayName("1001262226.jpg", "order_delivery_image", "בית הכנסת מאורות משה")
    ).toBe("צילום משלוח · בית הכנסת מאורות משה");
  });

  it("falls back cleanly when only one side is known", () => {
    expect(buildDocumentDisplayName("IMG_1.jpg", "ביטוח", null)).toBe("ביטוח");
    expect(buildDocumentDisplayName("IMG_1.jpg", "", "רכב 55-123-45")).toBe("רכב 55-123-45");
  });

  it("never returns an empty string", () => {
    expect(buildDocumentDisplayName("", "", "")).toBe("מסמך");
  });
});

describe("stripFileExtension", () => {
  it("drops the extension so a Latin suffix does not land mid-RTL", () => {
    expect(stripFileExtension("הלר בית 6.xlsx")).toBe("הלר בית 6");
    expect(stripFileExtension("tnuot iski 7.pdf")).toBe("tnuot iski 7");
  });

  it("leaves a name that merely contains a dot", () => {
    expect(stripFileExtension("הלר בית 7.26")).toBe("הלר בית 7.26");
  });

  it("never returns empty", () => {
    expect(stripFileExtension(".pdf")).toBe(".pdf");
    expect(stripFileExtension("  ")).toBe("");
  });

  it("is applied to a real title by buildDocumentDisplayName", () => {
    expect(buildDocumentDisplayName("חוזה שכירות.pdf", "חוזה/הסכם", "דירה")).toBe("חוזה שכירות");
  });
});

describe("isFilenameLikeName", () => {
  it("recognizes machine-generated document names", () => {
    for (const name of [
      "ShipmentInvoice-Customer_No96992_Invoice_No1-471_260915_013257",
      "file (8)",
      "file",
      "camera-1783586409627",
      "tnuot_iski_7.pdf",
    ]) {
      expect(isFilenameLikeName(name), name).toBe(true);
    }
  });

  it("leaves anything a person plausibly typed", () => {
    for (const name of [
      "חוזה שכירות דירת בן יהודה",
      "הלר בית 7.26",
      "Invoice March",
      "Q3 report",
    ]) {
      expect(isFilenameLikeName(name), name).toBe(false);
    }
  });
});

describe("buildDocumentDisplayName — filename vs description", () => {
  it("prefers type + entity over a machine filename", () => {
    expect(
      buildDocumentDisplayName(
        "ShipmentInvoice-Customer_No96992_Invoice_No1-471_260915_013257",
        "חשבונית",
        "ייבוא מכולה מניו יארק"
      )
    ).toBe("חשבונית · ייבוא מכולה מניו יארק");
  });

  it("keeps the filename when there is nothing better to say", () => {
    // The "(8)" goes with the copy markers now — it is the download folder's
    // bookkeeping, not part of what anyone called this file.
    expect(buildDocumentDisplayName("file (8).pdf", "", "")).toBe("file");
  });

  it("still keeps a human title even when a type and entity exist", () => {
    expect(buildDocumentDisplayName("חוזה שכירות", "חוזה/הסכם", "דירה")).toBe("חוזה שכירות");
  });
});


// A name that arrived through a phone carries the phone's bookkeeping: the
// "(2)" a download folder appends, and the counter a camera roll or share sheet
// glues onto the end of a word.
describe("stripCopyMarkers", () => {
  it("removes a parenthesised copy counter anywhere in the name", () => {
    expect(stripCopyMarkers("חשבונית (2)")).toBe("חשבונית");
    expect(stripCopyMarkers("חשבונית (2) סופית")).toBe("חשבונית סופית");
  });

  it("removes a counter glued onto a word", () => {
    expect(stripCopyMarkers("הנשיא1")).toBe("הנשיא");
    expect(stripCopyMarkers("הנשיא1 ברקוביטש")).toBe("הנשיא ברקוביטש");
  });

  it("leaves a number that is part of what the thing is called", () => {
    // The reason the rule is "attached to a word" and not "any trailing digits":
    // these are addresses, years and amounts, and losing them loses the name.
    expect(stripCopyMarkers("הלר בית 7.26")).toBe("הלר בית 7.26");
    expect(stripCopyMarkers("פינוי לוי אשכול 14")).toBe("פינוי לוי אשכול 14");
    expect(stripCopyMarkers("מסמך 2024")).toBe("מסמך 2024");
  });

  it("never returns an empty name", () => {
    expect(stripCopyMarkers("(3)")).toBe("(3)");
  });
});

// The header used to read "רשיון רכב 131357_260820_927" — a camera's filename
// with a label glued to the front. The Hebrew was enough to convince the check
// a person had typed it, so the description it should have shown never won.
describe("isFilenameLikeName — a machine id next to Hebrew", () => {
  it("sees through a label glued onto a camera filename", () => {
    expect(isFilenameLikeName("רשיון רכב 131357_260820_927")).toBe(true);
    expect(buildDocumentDisplayName("רשיון רכב 131357_260820_927.pdf", "תעודה/רישיון", "טנדר אפור")).toBe(
      "תעודה/רישיון · טנדר אפור"
    );
  });

  it("still trusts a name a person actually typed", () => {
    expect(isFilenameLikeName("הלר בית 7.26")).toBe(false);
    expect(isFilenameLikeName("חוזה שכירות מרכז קהילתי")).toBe(false);
    expect(isFilenameLikeName("פינוי לוי אשכול 14")).toBe(false);
  });
});

describe("splitFileNameForDisplay", () => {
  // In a right-to-left paragraph an unmarked Latin run gets reordered, so
  // "1104276.jpg" renders as ".jpg1104276" — the extension leads.
  it("marks a wholly Latin name as one left-to-right run", () => {
    expect(splitFileNameForDisplay("1104299.jpg")).toEqual({ rtl: "", ltr: "1104299.jpg" });
    expect(splitFileNameForDisplay("file (8).pdf")).toEqual({ rtl: "", ltr: "file (8).pdf" });
    expect(splitFileNameForDisplay("ShipmentInvoice-Customer_No96992.pdf")).toEqual({
      rtl: "",
      ltr: "ShipmentInvoice-Customer_No96992.pdf",
    });
  });

  it("keeps a Hebrew head in the page direction and isolates the Latin tail", () => {
    expect(splitFileNameForDisplay("רשיון רכב 131357_260820_927.pdf")).toEqual({
      rtl: "רשיון רכב",
      ltr: "131357_260820_927.pdf",
    });
  });

  it("leaves a wholly Hebrew name alone", () => {
    expect(splitFileNameForDisplay("חוזה שכירות")).toEqual({ rtl: "חוזה שכירות", ltr: "" });
  });
});

describe("formatFileSize", () => {
  it("uses the unit a person would say it in", () => {
    expect(formatFileSize(900)).toBe("900B");
    expect(formatFileSize(2048)).toBe("2.0KB");
    expect(formatFileSize(2.4 * 1024 * 1024)).toBe("2.4MB");
    expect(formatFileSize(300 * 1024 * 1024)).toBe("300MB");
  });

  it("says nothing when the size is unknown", () => {
    expect(formatFileSize(null)).toBeNull();
    expect(formatFileSize(Number.NaN)).toBeNull();
    expect(formatFileSize(-1)).toBeNull();
  });
});
