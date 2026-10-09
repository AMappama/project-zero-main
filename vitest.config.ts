import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/calendar.test.ts", "test/http.test.ts"],
    exclude: ["test/fulfillment.test.ts", "test/home.test.ts"],
    testTimeout: 120_000,
  },
});
