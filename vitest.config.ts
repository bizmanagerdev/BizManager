import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    // Default stays "node" for lib/api/security tests. Component-render tests
    // (*.test.tsx) opt into a DOM per-file via a `// @vitest-environment jsdom`
    // docblock at the top of the file.
    environment: "node",
    setupFiles: ["./__tests__/setup/jsdom.ts"],
    include: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts", "components/**/*.tsx"],
      exclude: ["lib/supabase/**", "**/*.d.ts"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
