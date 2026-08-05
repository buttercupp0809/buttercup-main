// ButterCupp root ESLint flat config.
// Includes a custom rule that flags the em dash character (U+2014) in source
// files, including inside comments. Per CLAUDE.md, em dashes are never used.

import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

const EM_DASH = "\u2014";

const noEmDashPlugin = {
  rules: {
    "no-em-dash": {
      meta: {
        type: "problem",
        docs: { description: "Disallow the em dash character (U+2014)." },
        schema: [],
        messages: {
          emDash:
            "Em dash (U+2014) is banned. Use commas, periods, or parentheses instead.",
        },
      },
      create(context) {
        return {
          "Program:exit"() {
            const src = context.sourceCode ?? context.getSourceCode();
            const text = src.getText();
            let idx = text.indexOf(EM_DASH);
            while (idx !== -1) {
              const loc = src.getLocFromIndex(idx);
              context.report({
                loc: { start: loc, end: { line: loc.line, column: loc.column + 1 } },
                messageId: "emDash",
              });
              idx = text.indexOf(EM_DASH, idx + 1);
            }
          },
        };
      },
    },
  },
};

export default [
  {
    ignores: [
      "node_modules/**",
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "packages/database/prisma/migrations/**",
    ],
  },
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      buttercupp: noEmDashPlugin,
    },
    rules: {
      "buttercupp/no-em-dash": "error",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];
