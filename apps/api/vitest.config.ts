import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The integration tests share one real database. Each file uses its own
    // made-up days and accounts, but some things are global: a puzzle picked
    // for a test day draws from every character, including a temporary one
    // another file adds. Running files one at a time rules that out.
    fileParallelism: false,
  },
});
