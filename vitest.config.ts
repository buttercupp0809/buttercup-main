import { defineConfig } from "vitest/config";
import path from "node:path";

// Aliases mirror the tsconfig paths so tests can `import "@/lib/..."` and
// `import "@buttercupp/database"` even without a full build in dev.
const alias = {
  "@": path.resolve(__dirname, "frontend"),
  "@buttercupp/database": path.resolve(__dirname, "packages/database/src/index.ts"),
  "@buttercupp/shared": path.resolve(__dirname, "packages/shared/src/index.ts"),
};

export default defineConfig({
  resolve: { alias },
  // Use React's automatic JSX runtime so .tsx tests (and the frontend source
  // they import) do not require an explicit `import React from "react"`.
  // Matches Next.js's default and frontend/tsconfig.json ("jsx": "preserve").
  esbuild: { jsx: "automatic" },
  test: {
    setupFiles: ["./vitest.setup.ts"],
    // Force node env so tests that touch node:crypto / bcryptjs / Prisma work.
    // We do not have jsdom-flavoured frontend unit tests yet; when we do, opt
    // them in individually with `// @vitest-environment jsdom`.
    environment: "node",
    include: [
      "packages/**/*.test.ts",
      "backend/**/*.test.ts",
      "frontend/**/*.test.ts",
      "frontend/**/*.test.tsx",
    ],
    exclude: ["node_modules/**", "**/dist/**", "**/.next/**", "e2e/**"],
  },
});
