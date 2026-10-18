import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    ".vinext/**",
    ".wrangler/**",
    "dist/**",
    "out/**",
    "output/**",
    "outputs/**",
    "tmp/**",
    "backups/**",
    "materials/**",
    "Organised/**",
    "site-dist/**",
    "work/**",
    ".venv/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
