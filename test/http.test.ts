import { fresh, closeTestDb, tableNames, indexNames, columnNames, expectQueryFail } from "./testDb";
import { describe, expect, it } from "vitest";
import { signIn } from "../src/accounts";
import { handleRequest } from "../src/http";
import { seedWorkbench, WORKBENCH } from "../src/seed";

async function await cookieFor(accountId: number) {
  const signed = await signIn(accountId);
  if (!signed) throw new Error("没有这个账号");
  return `session=${signed.token}`;
}

async function seeded() {
  const { crm } = await fresh();
  await seedWorkbench(crm);
  return crm;
}

describe("履约 HTTP", () => {
  it("查询工作台、身份、服务库、过期 VIP 和处理中", async () => {
    const db = await seeded();
    const home = await handleRequest(db, { method: "GET", url: "/api/home?tenantId=1&today=2026-09-30" });
    expect(home.status).toBe(200);
    const body = home.body as { judgement: unknown[]; exceptions: unknown[]; reviews: unknown[] };
    expect(body.judgement).toHaveLength(14);
    expect(body.exceptions).toHaveLength(5);
    expect(body.reviews).toHaveLength(4);

    const meetings = await handleRequest(db, { method: "GET", url: "/api/meetings?tenantId=1&today=2026-09-30" });
    expect((meetings.body as { meetings: { serviceMemberId: number }[] }).meetings.map((row) => row.serviceMemberId).sort()).toEqual([
      105, 108,
    ]);

    const identity = await handleRequest(db, { method: "GET", url: "/api/members/101/identity" });
    expect(identity.body).toEqual({ memberId: 101, identity: "VIP" });

    const library = await handleRequest(db, { method: "GET", url: "/api/service-library?tenantId=1&servicePersonId=20" });
    expect((library.body as { memberId: number }[]).map((row) => row.memberId).sort((a, b) => a - b)).toEqual([
      101, 103, 105, 106, 108, 110, 112, 113, 114, 115, 116, 117,
    ]);

    const overdue = await handleRequest(db, { method: "GET", url: "/api/overdue-vip?tenantId=1" });
    expect(overdue.body).toEqual([]);

    const progress = await handleRequest(db, { method: "GET", url: "/api/in-progress?tenantId=1" });
    expect((progress.body as { type: string }[]).map((row) => row.type).sort()).toEqual(["关单", "关单", "暂停", "赠送"]);
  });

  it("缺服务人时开启失败，错误里写明缺服务人", async () => {
    const db = await seeded();
    const opened = await handleRequest(db, {
      method: "POST",
      url: "/api/actions/open-service",
      body: { orderId: WORKBENCH.exceptionOrderId, today: WORKBENCH.today, openedBy: "system" },
    });
    expect(opened.status).toBe(400);
    expect(opened.body).toEqual({ error: "缺服务人", missing: ["缺服务人"] });
    expect((await db.getServiceInstanceByOrder(WORKBENCH.exceptionOrderId))?.status).toBe("待启用");
  });

  it("赠送通过走同一写入，只加总量", async () => {
    const db = await seeded();
    const before = (await handleRequest(db, { method: "GET", url: "/api/home" })).body as {
      reviews: { kind: string; applicationId: number }[];
    };
    const gift = before.reviews.find((item) => item.kind === "赠送");
    const blocked = await handleRequest(db, {
      method: "POST",
      url: "/api/actions/review-gift",
      cookie: await cookieFor(1),
      body: { applicationId: gift?.applicationId, decision: "通过", today: WORKBENCH.today },
    });
    expect(blocked.status).toBe(403);
    const reviewed = await handleRequest(db, {
      method: "POST",
      url: "/api/actions/review-gift",
      cookie: await cookieFor(2),
      body: { applicationId: gift?.applicationId, decision: "通过", today: WORKBENCH.today },
    });
    expect(reviewed.status).toBe(200);
    const instance = await db.getServiceInstanceByOrder(WORKBENCH.reviewOrderId);
    expect(instance?.status).toBe("启用中");
    expect(instance?.emotionTotal).toBe(6);
    expect(instance?.emotionUsed).toBe(0);
    const after = await handleRequest(db, { method: "GET", url: "/api/in-progress?tenantId=1" });
    expect((after.body as { type: string }[]).map((row) => row.type).sort()).toEqual(["关单", "关单", "暂停"]);
  });

  it("关单缺同意或缺关单人时，错误点名那一项，一审不改实例", async () => {
    const db = await seeded();
    const matchmaker = await cookieFor(1);
    const reviewer = await cookieFor(2);
    const filed = await handleRequest(db, {
      method: "POST",
      url: "/api/actions/file-close",
      cookie: matchmaker,
      body: { orderId: WORKBENCH.judgementOrderId, reason: "", today: WORKBENCH.today },
    });
    expect(filed).toMatchObject({ status: 400, body: { error: "关单需要原因" } });

    const created = await handleRequest(db, {
      method: "POST",
      url: "/api/actions/file-close",
      cookie: matchmaker,
      body: { orderId: WORKBENCH.judgementOrderId, reason: "到期", today: WORKBENCH.today },
    });
    expect(created.status).toBe(200);
    const applicationId = created.body as number;
    await handleRequest(db, {
      method: "POST",
      url: "/api/actions/review-close-first",
      cookie: reviewer,
      body: { applicationId, decision: "通过", today: WORKBENCH.today },
    });
    expect((await db.getServiceInstanceByOrder(WORKBENCH.judgementOrderId))?.status).toBe("启用中");

    const missingConsent = await handleRequest(db, {
      method: "POST",
      url: "/api/actions/review-close-second",
      cookie: reviewer,
      body: { applicationId, decision: "通过", today: WORKBENCH.today, closedBy: WORKBENCH.reviewerId },
    });
    expect(missingConsent).toMatchObject({ status: 400, body: { error: "关单需要用户是否同意" } });

    await handleRequest(db, {
      method: "POST",
      url: "/api/actions/set-close-consent",
      cookie: matchmaker,
      body: { applicationId, consent: true },
    });
    const missingCloser = await handleRequest(db, {
      method: "POST",
      url: "/api/actions/review-close-second",
      cookie: reviewer,
      body: { applicationId, decision: "通过", today: WORKBENCH.today },
    });
    expect(missingCloser).toMatchObject({ status: 400, body: { error: "关单需要关单人" } });
    expect((await db.getServiceInstanceByOrder(WORKBENCH.judgementOrderId))?.status).toBe("启用中");
  });

  it("两个账号按权限看到待判断、例外和审核", async () => {
    const db = await seeded();
    const accounts = await handleRequest(db, { method: "GET", url: "/api/accounts" });
    expect(accounts.body).toEqual([
      { id: 1, name: "林晓", personId: 20, permissions: ["红娘"] },
      { id: 2, name: "苏衡", personId: 20, permissions: ["红娘", "审核人"] },
    ]);
    expect((accounts.body as { permissions: string[] }[]).some((account) => account.permissions.join() === "审核人")).toBe(false);

    const matchmaker = (await handleRequest(db, { method: "GET", url: "/api/home", cookie: await cookieFor(1) })).body as {
      judgement: unknown[];
      exceptions: unknown[];
      reviews: unknown[];
    };
    expect(matchmaker.judgement.length).toBeGreaterThan(0);
    expect(matchmaker.exceptions.length).toBeGreaterThan(0);
    expect(matchmaker.reviews).toEqual([]);

    const both = (await handleRequest(db, { method: "GET", url: "/api/home", cookie: await cookieFor(2) })).body as {
      judgement: unknown[];
      exceptions: unknown[];
      reviews: { kind: string }[];
    };
    expect(both.judgement.length).toBe(matchmaker.judgement.length);
    expect(both.exceptions.length).toBe(matchmaker.exceptions.length);
    expect(both.reviews.map((item) => item.kind).sort()).toEqual(["关单", "关单", "暂停", "赠送"]);
  });
});
