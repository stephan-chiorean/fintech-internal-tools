import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // AGENTS.md rules, enforced: tools use only the foundation's public entry points.
    files: ["src/tools/**"],
    ignores: ["src/tools/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["better-sqlite3", "node:sqlite", "@/foundation/db", "@/foundation/db/*"],
              message: "Tools never touch the database. Write through the action pipeline (@/foundation/pipeline).",
            },
            {
              group: ["@/foundation/permissions", "@/foundation/permissions/*", "@/foundation/policy/*"],
              message: "Tools never check permissions. Name a permission from policy.config.ts in defineAction.",
            },
            {
              group: ["@/foundation/*/*"],
              message: "Use the foundation's public entry points, e.g. @/foundation/pipeline or @/foundation/data.",
            },
          ],
        },
      ],
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
