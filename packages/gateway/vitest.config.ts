import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // stdio 冒烟测试 spawn 子进程，超时放宽
    testTimeout: 20_000,
  },
});
