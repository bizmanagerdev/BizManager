import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";

// Nobody who reads Hebrew ever sees Arabic (owner, 2026-10-28: "for a Hebrew
// worker … there should not be an option of seeing any Arabic on the screen").
// Admin and office are always Hebrew, and so is every worker saved with locale
// "he"; only a worker saved with locale "ar" gets Arabic. The other way round is
// allowed — an Arabic worker may still see Hebrew.
//
// So every Arabic letter in the app's code must sit where only an Arabic reader
// reaches it:
//   - the `ar` side of a { he, ar } dictionary or label object;
//   - behind a language check: `locale === "ar" ? <Arabic> : <Hebrew>`,
//     `if (locale === "ar") { … }`, `locale === "ar" && …`, `case "ar":`, or the
//     other side of `locale !== "ar"` / `locale === "he"`;
//   - in a constant or function used only in one of those places.
// Regular expressions (they match text, never show it) and comments are fine.
// Dates and numbers formatted in Arabic (Intl / toLocale…("ar")) follow the same
// rule.
//
// Worker-written text (tasks, comments, shift notes) is data, not code — the
// screen check e2e/no-arabic-for-hebrew-readers.spec.ts covers it.

const ROOTS = ["app", "components", "lib", "hooks"];
const ROOT_FILES = ["middleware.ts"];
// Files that run outside React and can't check the reader's language: no Arabic at all.
const PLAIN_FILES = ["public/sw.js", "public/manifest.webmanifest"];

// Arabic, Arabic Supplement, Arabic Extended-A, Presentation Forms A and B (up
// to U+FEFC — U+FEFF after it is the byte-order mark the CSV exports start with).
const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-ﻼ]/;
const ARABIC_LOCALE_TAG = /^ar(-|$)/i;
const LOCALE_FORMATTERS = new Set(["toLocaleString", "toLocaleDateString", "toLocaleTimeString"]);

type Reader = "arabic" | "hebrew" | null;

export type Leak = { line: number; text: string };

const flip = (reader: Reader): Reader => (reader === "arabic" ? "hebrew" : reader === "hebrew" ? "arabic" : null);

function stringValue(node: ts.Node): string | null {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null;
}

function keyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  return null;
}

function readerForLocaleLiteral(value: string | null): Reader {
  if (value === "ar") return "arabic";
  if (value === "he") return "hebrew";
  return null;
}

function isExported(node: ts.Node): boolean {
  const statement = ts.isVariableDeclaration(node) ? node.parent.parent : node;
  return (
    ts.canHaveModifiers(statement) &&
    (ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  );
}

/** Every Arabic text in one file that a Hebrew reader could be shown. */
export function findArabicLeaks(fileName: string, sourceText: string): Leak[] {
  const source = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    /\.(js|mjs)$/.test(fileName) ? ts.ScriptKind.JS : fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

  // Every identifier by name, and every `const x = …` initializer, for following
  // a constant to where it's used and a flag (`const arabic = locale === "ar"`)
  // to what it means.
  const identifiers = new Map<string, ts.Identifier[]>();
  const initializers = new Map<string, ts.Expression[]>();
  const index = (node: ts.Node) => {
    if (ts.isIdentifier(node)) identifiers.set(node.text, [...(identifiers.get(node.text) ?? []), node]);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      initializers.set(node.name.text, [...(initializers.get(node.name.text) ?? []), node.initializer]);
    }
    ts.forEachChild(node, index);
  };
  index(source);

  // Who the reader is when `condition` comes out as `outcome` (null: it doesn't say).
  function readerWhen(condition: ts.Expression, outcome: boolean, depth = 0): Reader {
    if (depth > 6) return null;
    if (ts.isParenthesizedExpression(condition)) return readerWhen(condition.expression, outcome, depth + 1);
    if (ts.isPrefixUnaryExpression(condition) && condition.operator === ts.SyntaxKind.ExclamationToken) {
      return readerWhen(condition.operand, !outcome, depth + 1);
    }
    if (ts.isBinaryExpression(condition)) {
      const op = condition.operatorToken.kind;
      const equal = op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsToken;
      const notEqual = op === ts.SyntaxKind.ExclamationEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken;
      if (equal || notEqual) {
        const reader = readerForLocaleLiteral(stringValue(condition.left) ?? stringValue(condition.right));
        return equal === outcome ? reader : flip(reader);
      }
      const left = () => readerWhen(condition.left, outcome, depth + 1);
      const right = () => readerWhen(condition.right, outcome, depth + 1);
      // a && b true → both true; a || b false → both false: either side decides.
      // The other two outcomes only say something when both sides agree.
      const eitherDecides =
        (op === ts.SyntaxKind.AmpersandAmpersandToken && outcome) || (op === ts.SyntaxKind.BarBarToken && !outcome);
      const bothDecide =
        (op === ts.SyntaxKind.AmpersandAmpersandToken && !outcome) || (op === ts.SyntaxKind.BarBarToken && outcome);
      if (eitherDecides) return left() ?? right();
      if (bothDecide) return left() === right() ? left() : null;
      return null;
    }
    if (ts.isIdentifier(condition)) {
      const values = initializers.get(condition.text) ?? [];
      const readers = values.map((value) => readerWhen(value, outcome, depth + 1));
      return readers.length > 0 && readers.every((r) => r === readers[0]) ? readers[0] : null;
    }
    return null;
  }

  // Who can be shown what's at `node`: "arabic" only an Arabic reader, "hebrew"
  // only a Hebrew one, null anyone.
  function readerAt(node: ts.Node, depth = 0): Reader {
    let child: ts.Node = node;
    for (let parent = node.parent; parent; child = parent, parent = parent.parent) {
      if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent)) && child !== parent.name) {
        const reader = readerForLocaleLiteral(keyName(parent.name));
        if (reader) return reader;
      }
      if (ts.isShorthandPropertyAssignment(parent)) {
        const reader = readerForLocaleLiteral(parent.name.text);
        if (reader) return reader;
      }
      if (ts.isConditionalExpression(parent) && child !== parent.condition) {
        const reader = readerWhen(parent.condition, child === parent.whenTrue);
        if (reader) return reader;
      }
      if (ts.isIfStatement(parent) && child !== parent.expression) {
        const reader = readerWhen(parent.expression, child === parent.thenStatement);
        if (reader) return reader;
      }
      if (ts.isBinaryExpression(parent) && child === parent.right) {
        const op = parent.operatorToken.kind;
        if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken) {
          const reader = readerWhen(parent.left, op === ts.SyntaxKind.AmpersandAmpersandToken);
          if (reader) return reader;
        }
      }
      if (ts.isCaseClause(parent) && child !== parent.expression) {
        // `case "he": case "ar": …` falls through from "he" — only a clause no
        // other case falls into decides.
        const clauses = parent.parent.clauses;
        const at = clauses.indexOf(parent);
        const fallsInto = at > 0 && clauses[at - 1].statements.length === 0;
        const reader = readerForLocaleLiteral(stringValue(parent.expression));
        if (reader && !fallsInto) return reader;
      }
      // A constant or a function: it's shown wherever it's used.
      const declared =
        (ts.isVariableDeclaration(parent) && child === parent.initializer && ts.isIdentifier(parent.name) && parent.name) ||
        (ts.isFunctionDeclaration(parent) && parent.name) ||
        null;
      if (declared) return readerOfUses(parent, declared, depth);
    }
    return null;
  }

  function readerOfUses(declaration: ts.Node, name: ts.Identifier, depth: number): Reader {
    // Used from other files, or too deep to follow: can't tell, so anyone.
    if (depth > 4 || isExported(declaration)) return null;
    const uses = (identifiers.get(name.text) ?? []).filter((id) => id !== name);
    if (uses.length === 0) return null;
    const readers = uses.map((use) => readerAt(use, depth + 1));
    return readers.every((r) => r === "arabic") ? "arabic" : null;
  }

  const leaks: Leak[] = [];
  const report = (node: ts.Node, text: string) =>
    leaks.push({ line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, text: text.trim() });

  const visit = (node: ts.Node) => {
    // Shown text: strings, template pieces, JSX text.
    const text =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
        ? node.text
        : null;
    if (text !== null && ARABIC.test(text)) {
      const parent = node.parent;
      const isPattern =
        (ts.isNewExpression(parent) || ts.isCallExpression(parent)) &&
        ts.isIdentifier(parent.expression) &&
        parent.expression.text === "RegExp";
      const isType = ts.isLiteralTypeNode(parent);
      if (!isPattern && !isType && readerAt(node) !== "arabic") report(node, text);
    }

    // Dates and numbers formatted in Arabic: new Intl.X("ar"), x.toLocale…("ar").
    if ((ts.isNewExpression(node) || ts.isCallExpression(node)) && node.arguments?.length) {
      const callee = node.expression;
      const formats =
        (ts.isPropertyAccessExpression(callee) &&
          ((ts.isIdentifier(callee.expression) && callee.expression.text === "Intl") ||
            LOCALE_FORMATTERS.has(callee.name.text))) ||
        false;
      if (formats) {
        const findTags = (arg: ts.Node) => {
          const value = stringValue(arg);
          // The "ar" in `locale === "ar" ? "ar" : "he-IL"` is the check, not the language used.
          const compared = ts.isBinaryExpression(arg.parent) && arg.parent.operatorToken.kind !== ts.SyntaxKind.BarBarToken;
          if (value !== null && !compared && ARABIC_LOCALE_TAG.test(value) && readerAt(arg) !== "arabic") {
            report(arg, `${value} (formatting)`);
          }
          ts.forEachChild(arg, findTags);
        };
        findTags(node.arguments[0]);
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(source);
  return leaks;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) continue;
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

const leaksIn = (file: string, text: string) => findArabicLeaks(file, text).map((leak) => leak.text);

describe("the checker itself", () => {
  it("lets Arabic through where only an Arabic reader gets it", () => {
    const allowed = `
      const dict = { he: { save: "שמירה" }, ar: { save: "حفظ" } };
      const note = { ar: (time: string) => \`الآن \${time}\` };
      function label(locale: "he" | "ar") {
        if (locale === "ar") return "حفظ";
        return "שמירה";
      }
      const a = (locale: string) => (locale === "ar" ? "حفظ" : "שמירה");
      const b = (locale: string) => (locale !== "ar" ? "שמירה" : "حفظ");
      const c = (locale: string) => (locale === "he" ? "שמירה" : "حفظ");
      const d = (locale: string) => locale === "ar" && "حفظ";
      const e = (locale: string) => {
        const arabic = locale === "ar";
        return arabic ? "حفظ" : "שמירה";
      };
      const f = (locale: string) => {
        switch (locale) {
          case "ar":
            return "حفظ";
          default:
            return "שמירה";
        }
      };
      const ITEMS_AR = [{ title: "المهام" }];
      const ITEMS = [{ title: "משימות" }];
      const g = (locale: string) => (locale === "ar" ? ITEMS_AR : ITEMS);
      const h = (locale: string) => new Intl.DateTimeFormat(locale === "ar" ? "ar" : "he-IL");
      const pattern = /[؀-ۿ،]/;
      // Arabic in a comment: مرحبا
      const T = ({ locale }: { locale: string }) => <span>{locale === "ar" ? <b>مرحبا</b> : <b>שלום</b>}</span>;
    `;
    expect(leaksIn("ok.tsx", allowed)).toEqual([]);
  });

  it("catches Arabic a Hebrew reader could see", () => {
    const leaking = `
      export const title = "مرحبا";
      const dict = { he: { save: "حفظ" }, ar: { save: "حفظ" } };
      const a = (locale: string) => (locale === "ar" ? "שמירה" : "حفظ");
      const b = (names: string[]) => names.join("، ");
      const c = (on: boolean) => (on ? "حفظ" : "שמירה");
      const ITEMS_AR = [{ title: "المهام" }];
      export const items = ITEMS_AR;
      const d = (locale: string) => {
        switch (locale) {
          case "he":
          case "ar":
            return "حفظ";
        }
      };
      const e = new Date().toLocaleDateString("ar");
      const Picker = () => <option value="ar">العربية</option>;
    `;
    expect(leaksIn("bad.tsx", leaking)).toEqual([
      "مرحبا",
      "حفظ",
      "حفظ",
      "،",
      "حفظ",
      "المهام",
      "حفظ",
      "ar (formatting)",
      "العربية",
    ]);
  });
});

describe("no Arabic for a Hebrew reader", () => {
  it("every Arabic text in the app's code reaches only an Arabic reader", () => {
    const files = [...ROOTS.flatMap((root) => sourceFiles(root)), ...ROOT_FILES];
    // Parsing all ~1,500 files takes seconds; only those with Arabic or an "ar"
    // formatting tag can leak.
    const mayLeak = (text: string) =>
      ARABIC.test(text) || (/\b(Intl|toLocale\w*String)\b/.test(text) && /["'`]ar["'`-]/.test(text));
    const leaks = files.flatMap((file) => {
      const text = readFileSync(file, "utf8");
      if (!mayLeak(text)) return [];
      return findArabicLeaks(file, text).map(
        (leak) => `${relative(".", file).replace(/\\/g, "/")}:${leak.line}  ${leak.text}`
      );
    });
    // Each line is Arabic a Hebrew reader could see. Move it to the `ar` side of
    // its dictionary, or behind locale === "ar", or translate it to Hebrew.
    expect(leaks).toEqual([]);
  });

  it("files that can't check the reader's language have no Arabic at all", () => {
    const leaks = PLAIN_FILES.filter((file) => ARABIC.test(readFileSync(file, "utf8")));
    expect(leaks).toEqual([]);
  });

  it("no Hebrew dictionary entry is in Arabic", async () => {
    const dir = "lib/i18n/dictionaries";
    const leaks: string[] = [];
    let checked = 0;
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
      const mod = (await import(/* @vite-ignore */ resolve(dir, name))) as Record<string, unknown>;
      for (const [exportName, value] of Object.entries(mod)) {
        const he = (value as { he?: Record<string, unknown> } | null)?.he;
        if (!he || typeof he !== "object") continue;
        checked += 1;
        for (const [key, text] of Object.entries(he)) {
          if (typeof text === "string" && ARABIC.test(text)) leaks.push(`${name} ${exportName}.he.${key}: ${text}`);
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(readdirSync(dir).length);
    expect(leaks).toEqual([]);
  });
});
