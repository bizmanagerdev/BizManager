import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Honor the leading-underscore convention for intentionally-unused
      // identifiers (args, destructured vars, caught errors).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // The icon palette (components/ui/icons.ts) is the ONLY place allowed to
      // touch lucide directly. Everything else imports icons by meaning, so a
      // glyph can be swapped app-wide from one line. See the palette's header.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "lucide-react",
              message:
                'ייבא אייקונים מלוח האייקונים: import { EditIcon } from "@/components/ui/icons"',
            },
          ],
        },
      ],
    },
  },
  {
    // The palette itself is the one door to lucide.
    files: ["components/ui/icons.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    files: ["app/**/sales/orders/[[]id[]]/page.tsx"],
    rules: {
      "@next/next/no-img-element": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
