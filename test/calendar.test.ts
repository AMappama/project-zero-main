import { describe, expect, it } from "vitest";
import { addDays, addMonths, remainingServiceMonths } from "../src/calendar";

describe("服务月", () => {
  it("六个月从 1 月 1 日算到 7 月 1 日", () => {
    expect(addMonths("2026-01-01", 6)).toBe("2026-07-01");
    expect(addMonths("2026-06-01", 4)).toBe("2026-10-01");
  });

  it("月底按目标月的最后一天截断", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-03-31", 1)).toBe("2026-04-30");
  });

  it("第二个月最后一天暂停时还剩四个月", () => {
    expect(remainingServiceMonths("2026-01-01", "2026-02-28", 6)).toBe(4);
  });

  it("没到服务月最后一天，这个月不算走完", () => {
    expect(remainingServiceMonths("2026-01-01", "2026-02-27", 6)).toBe(5);
    expect(remainingServiceMonths("2026-01-01", "2026-01-01", 6)).toBe(6);
  });

  it("加减天数", () => {
    expect(addDays("2026-07-01", 10)).toBe("2026-07-11");
    expect(addDays("2026-02-01", -1)).toBe("2026-01-31");
  });
});
