import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "main.js",
      "styles.css",
      "esbuild.config.mjs",
      "eslint.config.mjs",
      "vitest.config.ts",
      "stylelint.config.mjs",
      "scripts/**",
      "scratch/**",
      "dist/**",
      "src/locales/**"
    ]
  },
  ...obsidianmd.configs.recommendedWithLocalesEn,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.json",
        sourceType: "module"
      }
    },
    rules: {
      "obsidianmd/prefer-active-doc": "error",
      "obsidianmd/settings-tab/prefer-setting-definitions": "off",
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": ["error", { "allow": ["warn", "error", "debug"] }]
    }
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      "obsidianmd/no-nodejs-modules": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "obsidianmd/no-tfile-tfolder-cast": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "obsidianmd/prefer-active-doc": "off",
      "obsidianmd/prefer-create-el": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "obsidianmd/no-global-this": "off"
    }
  }
);
