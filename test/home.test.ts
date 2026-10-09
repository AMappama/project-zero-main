import { fresh, closeTestDb } from "./testDb";
import { describe, expect, it } from "vitest";
import type { Fulfillment } from "../src";
import { loadHome } from "../src/home";
import { seedWorkbench, WORKBENCH } from "../src/seed";

async function withDb(run: (crm: Fulfillment) => Promise<void>) {
  const { pool, crm } = await fresh();
  try {
    await run(crm);
  } finally {
    await closeTestDb(pool);
  }
}

async function place(
  db: Fulfillment,
  input: {
    memberId: number;
    orderId: number;
    personId?: number;
    shopId?: number;
    today?: string;
    plannedStart?: string;
    paymentStatus?: "unpaid" | "payable" | "paid";
    contractCheckStatus?: number;
    durationMonths?: number;
    role?: "matchmanager" | "shop_manager" | "director";
    assign?: boolean;
  },
) {
  const today = input.today ?? "2026-09-30";
  const shopId = input.shopId ?? 1;
  await db.registerMember({ id: input.memberId, tenantId: 1, shopId, createdAt: today });
  if (input.personId !== undefined && input.role !== undefined) {
    await db.registerShopRole({ tenantId: 1, shopId, personId: input.personId, role: input.role });
  }
  await db.registerOrderFact({
    id: input.orderId,
    tenantId: 1,
    shopId,
    memberId: input.memberId,
    orderTime: `${input.plannedStart ?? today}T09:00:00`,
    paymentStatus: input.paymentStatus ?? "paid",
    contractCheckStatus: input.contractCheckStatus ?? 1,
    durationMonths: input.durationMonths ?? 6,
    plannedStart: input.plannedStart ?? today,
    activityTotal: 2,
    emotionTotal: 4,
    oneOnOneTotal: 2,
    imageTotal: 1,
  });
  if (input.assign !== false && input.personId !== undefined) {
    await db.assignServicePerson({
      tenantId: 1,
      memberId: input.memberId,
      orderId: input.orderId,
      servicePersonId: input.personId,
      today,
    });
  }
  return today;
}

describe("工作台三块", () => {
  it("种子数据按会员铺开待判断、例外和审核", async () => {
    await withDb(async (db) => {
      await seedWorkbench(db);
      const home = await loadHome(db, { tenantId: WORKBENCH.tenantId, today: WORKBENCH.today });
      const drafts = home.judgement.filter((item) => item.kind === "推荐草稿");
      const libraryIds = (await db.listServiceLibrary({ tenantId: 1, servicePersonId: WORKBENCH.servicePersonId }))
        .map((row) => row.memberId)
        .sort((left, right) => left - right);
      expect(drafts.map((item) => item.memberId).sort((left, right) => (left ?? 0) - (right ?? 0))).toEqual(libraryIds);
      for (const draft of drafts) {
        expect(draft.guestMemberId).not.toBe(draft.memberId);
        expect(libraryIds).toContain(draft.guestMemberId);
        expect((await db.listRecommendations(draft.memberId ?? 0)).some((row) => row.guestMemberId === draft.guestMemberId)).toBe(false);
        expect(draft.detail).toContain("同在服务库，尚未推荐");
      }
      expect(drafts.find((item) => item.memberId === 101)?.guestMemberId).toBe(103);
      expect(home.judgement.filter((item) => item.kind !== "推荐草稿").map((item) => [item.kind, item.memberId, item.title, item.consent])).toEqual([
        ["见面结果", 105, "见面结果到点了", null],
        ["关单建议", 108, "已恋爱，建议关单", null],
      ]);
      expect(home.exceptions.map((item) => [item.kind, item.memberId, item.title, item.facts])).toEqual([
        ["开启缺口", 102, "缺服务人", ["缺服务人"]],
        ["开启缺口", 109, "还不能开启", ["订单", "合同"]],
        ["开启缺口", 110, "计划开始日还没到", ["计划开始日"]],
        ["换人", 111, "落到店长，待换红娘", []],
        ["提前恢复", 115, "可以提前恢复", []],
      ]);
      expect(home.reviews.map((item) => [item.kind, item.memberId, item.level ?? item.title])).toEqual([
        ["关单", 106, "一审"],
        ["赠送", 103, "赠送待审"],
        ["暂停", 116, "暂停待审"],
        ["关单", 117, "二审"],
      ]);
      expect(home.reviews.find((item) => item.kind === "关单" && item.memberId === 106)?.detail).toContain("用户同意关单");
      expect(home.reviews.find((item) => item.memberId === 103)?.detail).toContain("恋爱指导增加 2 次");
      expect((await db.listApplications({ tenantId: 1 })).some((app) => app.orderId === WORKBENCH.loveOrderId)).toBe(false);
      expect((await db.getServiceInstanceByOrder(WORKBENCH.expiryOrderId))?.status).toBe("启用中");
      expect((await db.getServiceInstanceByOrder(WORKBENCH.resumeOrderId))?.status).toBe("暂停");
      expect((await db.getServiceInstanceByOrder(WORKBENCH.exceptionOrderId))?.status).toBe("待启用");
      expect((await db.getServiceInstanceByOrder(WORKBENCH.reviewOrderId))?.status).toBe("启用中");
      expect(await db.memberIdentity(WORKBENCH.judgementMemberId)).toBe("VIP");
      expect(await db.memberIdentity(WORKBENCH.exceptionMemberId)).toBe("待开启");
      expect((await db.getOwnership(WORKBENCH.managerMemberId))?.assignedViaRole).toBe("shop_manager");
    });
  });

  it("开启缺口只点名已经列过的事实", async () => {
    await withDb(async (unpaid) => {
      await place(unpaid, { memberId: 1, orderId: 1, personId: 10, role: "matchmanager", paymentStatus: "unpaid" });
      expect((await loadHome(unpaid, { tenantId: 1, today: "2026-09-30" })).exceptions[0]?.facts).toEqual(["订单"]);
    });

    await withDb(async (contract) => {
      await place(contract, { memberId: 1, orderId: 1, personId: 10, role: "matchmanager", contractCheckStatus: 0 });
      expect((await loadHome(contract, { tenantId: 1, today: "2026-09-30" })).exceptions[0]?.facts).toEqual(["合同"]);
    });

    await withDb(async (future) => {
      await place(future, { memberId: 1, orderId: 1, personId: 10, role: "matchmanager", plannedStart: "2026-12-01" });
      expect((await loadHome(future, { tenantId: 1, today: "2026-09-30" })).exceptions[0]?.facts).toEqual(["计划开始日"]);
    });

    await withDb(async (nobody) => {
      await place(nobody, { memberId: 1, orderId: 1, assign: false });
      expect((await loadHome(nobody, { tenantId: 1, today: "2026-09-30" })).exceptions[0]?.facts).toEqual(["缺服务人"]);
    });

    await withDb(async (confirm) => {
      await confirm.setTenantSettings({ tenantId: 1, autoStartService: false });
      await place(confirm, { memberId: 1, orderId: 1, personId: 10, role: "matchmanager" });
      expect((await loadHome(confirm, { tenantId: 1, today: "2026-09-30" })).exceptions[0]?.facts).toEqual(["确认开启"]);
    });
  });

  it("到期草稿同时出现在待判断和审核，提前关单只进审核", async () => {
    await withDb(async (drafted) => {
      await place(drafted, {
        memberId: 1,
        orderId: 1,
        personId: 10,
        role: "matchmanager",
        plannedStart: "2025-01-01",
        today: "2025-01-01",
      });
      await drafted.openService({ orderId: 1, today: "2025-01-01", openedBy: "system" });
      await drafted.runAutomatic({ today: "2026-09-30", tenantId: 1 });
      const home = await loadHome(drafted, { tenantId: 1, today: "2026-09-30" });
      expect(home.judgement.map((item) => item.kind)).toEqual(["起草关单"]);
      expect(home.reviews.map((item) => [item.kind, item.level])).toEqual([["关单", "一审"]]);
      expect((await drafted.getServiceInstanceByOrder(1))?.status).toBe("启用中");
    });

    await withDb(async (early) => {
      await place(early, { memberId: 1, orderId: 1, personId: 10, role: "matchmanager" });
      await early.openService({ orderId: 1, today: "2026-09-30", openedBy: "system" });
      await early.fileClose({ orderId: 1, reason: "双方同意提前结束", consent: true, today: "2026-09-30" });
      const filed = await loadHome(early, { tenantId: 1, today: "2026-09-30" });
      expect(filed.judgement).toEqual([]);
      expect(filed.reviews.map((item) => item.kind)).toEqual(["关单"]);
    });
  });

  it("已恋爱只进待判断的关单建议，见面结果单独一条", async () => {
    await withDb(async (loved) => {
      await place(loved, { memberId: 1, orderId: 1, personId: 10, role: "matchmanager" });
      await loved.openService({ orderId: 1, today: "2026-09-30", openedBy: "system" });
      await loved.registerMember({ id: 2, tenantId: 1, shopId: 1, createdAt: "2026-09-30" });
      await loved.confirmMeeting({
        tenantId: 1,
        serviceMemberId: 1,
        memberId: 2,
        meetOn: "2026-10-02",
        result: "恋爱",
        today: "2026-09-30",
      });
      await loved.runAutomatic({ today: "2026-09-30", tenantId: 1 });
      const home = await loadHome(loved, { tenantId: 1, today: "2026-09-30" });
      expect(home.judgement.map((item) => item.kind)).toEqual(["关单建议"]);
      expect(home.reviews).toEqual([]);
    });

    await withDb(async (due) => {
      await place(due, { memberId: 1, orderId: 1, personId: 10, role: "matchmanager" });
      await due.openService({ orderId: 1, today: "2026-09-01", openedBy: "system" });
      await due.registerMember({ id: 2, tenantId: 1, shopId: 1, createdAt: "2026-09-01" });
      await due.confirmMeeting({
        tenantId: 1,
        serviceMemberId: 1,
        memberId: 2,
        meetOn: "2026-09-20",
        place: "门店会客室",
        today: "2026-09-20",
      });
      expect((await loadHome(due, { tenantId: 1, today: "2026-09-30" })).judgement.map((item) => item.kind)).toEqual(["见面结果"]);
    });
  });

  it("赠送和暂停进审核，落到店长名下进例外，未到期的暂停可以提前恢复", async () => {
    await withDb(async (gift) => {
      await place(gift, { memberId: 1, orderId: 1, personId: 10, role: "matchmanager" });
      await gift.openService({ orderId: 1, today: "2026-09-30", openedBy: "system" });
      await gift.fileGift({ orderId: 1, reason: "活动次数不够", quotaKind: "活动", quotaAdd: 1, today: "2026-09-30" });
      expect((await loadHome(gift, { tenantId: 1, today: "2026-09-30" })).reviews.map((item) => item.kind)).toEqual(["赠送"]);
      expect((await loadHome(gift, { tenantId: 1, today: "2026-09-30" })).judgement).toEqual([]);
    });

    await withDb(async (staff) => {
      await place(staff, { memberId: 1, orderId: 1, personId: 10, role: "shop_manager", assign: false });
      await staff.runAutomatic({ today: "2026-09-30", tenantId: 1 });
      const staffHome = await loadHome(staff, { tenantId: 1, today: "2026-09-30" });
      expect(staffHome.exceptions.map((item) => item.kind)).toEqual(["换人"]);
      expect((await staff.getServiceInstanceByOrder(1))?.status).toBe("启用中");
    });

    await withDb(async (paused) => {
      await place(paused, {
        memberId: 1,
        orderId: 1,
        personId: 10,
        role: "matchmanager",
        plannedStart: "2026-01-01",
        today: "2026-01-01",
      });
      await paused.openService({ orderId: 1, today: "2026-01-01", openedBy: "system" });
      const applicationId = await paused.filePause({
        orderId: 1,
        reason: "会员出差",
        pauseStart: "2026-02-28",
        pauseEnd: "2026-06-01",
        today: "2026-02-28",
      });
      expect((await loadHome(paused, { tenantId: 1, today: "2026-02-28" })).reviews.map((item) => item.kind)).toEqual(["暂停"]);
      await paused.reviewPause({ applicationId, decision: "通过", today: "2026-02-28" });
      const after = await loadHome(paused, { tenantId: 1, today: "2026-03-15" });
      expect(after.reviews).toEqual([]);
      expect(after.exceptions.map((item) => item.kind)).toEqual(["提前恢复"]);
      const instance = await paused.getServiceInstanceByOrder(1);
      expect(instance?.endedOn).toBe(instance?.totalEnd);
    });
  });

  it("启用中且没有其他待办的会员，按订单各得一张暂停、赠送或提前关单", async () => {
    await withDb(async (db) => {
      await place(db, { memberId: 1, orderId: 11, personId: 10, role: "matchmanager" });
      await place(db, { memberId: 2, orderId: 12, personId: 10 });
      await place(db, { memberId: 3, orderId: 13, personId: 10 });
      await db.openService({ orderId: 11, today: "2026-09-30", openedBy: "system" });
      await db.openService({ orderId: 12, today: "2026-09-30", openedBy: "system" });
      await db.openService({ orderId: 13, today: "2026-09-30", openedBy: "system" });
      const home = await loadHome(db, { tenantId: 1, today: "2026-09-30" });
      expect(home.exceptions.map((item) => [item.kind, item.memberId, item.orderId])).toEqual([
        ["要暂停", 1, 11],
        ["要赠送", 2, 12],
        ["提前关单", 3, 13],
      ]);
      expect(home.judgement).toEqual([]);
      expect(home.reviews).toEqual([]);
    });
  });
});
