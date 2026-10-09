import { fresh, closeTestDb } from "./testDb";
import { describe, expect, it } from "vitest";
import { signIn } from "../src/accounts";
import { handleRequest } from "../src/http";
import { seedDemoProfiles } from "../src/profiles";
import { seedWorkbench } from "../src/seed";

async function cookieFor(accountId: number) {
  const signed = await signIn(accountId);
  if (!signed) throw new Error("没有这个账号");
  return `session=${signed.token}`;
}

describe("画像和建议只预览", () => {
  it("手填画像不改身份，关闭模型时文案和匹配说明都不写库", async () => {
    process.env.AI_ENABLED = "0";
    const { pool, crm } = await fresh();
    try {
      await seedWorkbench(crm);
      await seedDemoProfiles(pool);
      const cookie = await cookieFor(1);
      const beforeMember = await crm.getMember(101);
      const beforeRecommendations = await crm.listRecommendations(101);
      const suggested = await handleRequest(
        crm,
        {
          method: "POST",
          url: "/api/actions/suggest-recommendation-copy",
          cookie,
          body: { memberId: 101, guestMemberId: 103, facts: ["同在服务库"], today: "2026-09-30" },
        },
        { pool },
      );
      expect(suggested.status).toBe(200);
      expect(suggested.body).toMatchObject({ source: "local", notice: null });
      expect(await crm.listRecommendations(101)).toEqual(beforeRecommendations);

      const saved = await handleRequest(
        crm,
        {
          method: "PUT",
          url: "/api/members/101/profile",
          cookie,
          body: { name: "周晚宁", age: 31, city: "", today: "2026-09-30" },
        },
        { pool },
      );
      expect(saved.status).toBe(200);
      expect(saved.body).toMatchObject({ memberId: 101, name: "周晚宁", age: 31, city: null, source: "manual" });
      expect(await crm.getMember(101)).toEqual(beforeMember);

      const fit = await handleRequest(
        crm,
        { method: "POST", url: "/api/suggest-staff-fit", cookie, body: { tenantId: 1 } },
        { pool },
      );
      expect(fit.body).toEqual({ available: false });
    } finally {
      await closeTestDb(pool);
    }
  });

  it("画像是红娘权限范围，未登录读不到", async () => {
    const { pool, crm } = await fresh();
    try {
      await seedWorkbench(crm);
      await seedDemoProfiles(pool);

      const list = await handleRequest(crm, { method: "GET", url: "/api/member-profiles" }, { pool });
      expect(list.status).toBe(401);

      const single = await handleRequest(crm, { method: "GET", url: "/api/members/101/profile" }, { pool });
      expect(single.status).toBe(401);

      const write = await handleRequest(
        crm,
        { method: "PUT", url: "/api/members/101/profile", body: { name: "周晚宁", today: "2026-09-30" } },
        { pool },
      );
      expect(write.status).toBe(401);

      const cookie = await cookieFor(1);
      const allowed = await handleRequest(crm, { method: "GET", url: "/api/member-profiles", cookie }, { pool });
      expect(allowed.status).toBe(200);
      expect((allowed.body as { memberId: number }[]).map((row) => row.memberId)).toContain(101);
    } finally {
      await closeTestDb(pool);
    }
  });
});
