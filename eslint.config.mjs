import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  eslintConfigPrettier,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["*.config.mjs", "*.config.ts"],
        },
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      "@typescript-eslint/explicit-function-return-type": "warn",
      "@typescript-eslint/strict-boolean-expressions": "error",
      "curly": "error",
    },
  },
  {
    files: ["*.config.mjs", "*.config.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "curly": "error",
    },
  }
);
