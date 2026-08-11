import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      // TypeScript's own checker covers undefined identifiers; the core rule
      // does not know about DOM/Node globals under a flat config.
      "no-undef": "off",
      // A leading underscore marks a parameter kept for interface conformance,
      // e.g. an unimplemented adapter that must still match the signature.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
