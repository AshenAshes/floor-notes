import { configDefaults, defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      obsidian: resolve(__dirname, "./tests/mocks/obsidian.ts")
    }
  },
  test: {
    environment: "jsdom",
    globals: true,
    exclude: [...configDefaults.exclude, "**/.claude/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/**",
        ".claude/**",
        "dist/**",
        "esbuild.config.mjs",
        "eslint.config.mjs",
        "stylelint.config.mjs",
        "vitest.config.ts",
        "scripts/**",
        "tests/**"
      ]
    }
  }
});
