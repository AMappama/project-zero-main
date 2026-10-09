import { fresh, closeTestDb, tableNames, indexNames, columnNames, expectQueryFail } from "./testDb";
import { describe, expect, it } from "vitest";
import type { Fulfillment } from "../src";

const TENANT = 1;
const SHOP = 1;

async function seed(
  crm: Fulfillment,
  opts: {
    memberId?: number;
    orderId?: number;
    personId?: number;
    shopId?: number;
    today?: string;
    orderTime?: string;
    plannedStart?: string;
    durationMonths?: number;
    paymentStatus?: "unpaid" | "payable" | "paid";
    contractCheckStatus?: number;
    registerMember?: boolean;
    registerRole?: boolean;
    assign?: boolean;
    open?: boolean;
  } = {},
) {
  const today = opts.today ?? "2026-01-01";
  const memberId = opts.memberId ?? 1;
  const orderId = opts.orderId ?? 1;
  const personId = opts.personId ?? 10;
  const shopId = opts.shopId ?? SHOP;
  if (opts.registerMember !== false) {
    await crm.registerMember({ id: memberId, tenantId: TENANT, shopId, createdAt: today });
  }
  if (opts.registerRole !== false) {
    await crm.registerShopRole({ tenantId: TENANT, shopId, personId, role: "matchmanager" });
  }
  await crm.registerOrderFact({
    id: orderId,
    tenantId: TENANT,
    shopId,
    memberId,
    orderTime: opts.orderTime ?? today,
    paymentStatus: opts.paymentStatus ?? "paid",
    contractCheckStatus: opts.contractCheckStatus ?? 1,
    durationMonths: opts.durationMonths ?? 6,
    plannedStart: opts.plannedStart ?? today,
    activityTotal: 2,
    emotionTotal: 4,
    oneOnOneTotal: 2,
    imageTotal: 1,
  });
  if (opts.assign !== false) {
    await crm.assignServicePerson({ tenantId: TENANT, memberId, orderId, servicePersonId: personId, today });
  }
  const opened = opts.open === false ? null : await crm.openService({ orderId, today, openedBy: "system" });
  return { today, memberId, orderId, personId, shopId, opened };
}

describe("表和约束", () => {
  it("只有履约主表，没有服务期、次数、暂停历史、过期池、诚意库", async () => {
    const { pool } = await fresh();
    const tables = await tableNames(pool);
    expect(tables).toEqual(
      expect.arrayContaining([
        "members",
        "service_instances",
        "service_ownerships",
        "applications",
        "recommendations",
        "meetings",
        "notes",
        "tasks",
        "close_vip_contract",
        "outbox_events",
        "deal_assignments",
        "tenant_settings",
      ]),
    );
    for (const forbidden of [
      "service_period",
      "service_period_bak",
      "pre_service_period",
      "vip_package_info",
      "vip_suspend_history",
      "overdue_vip_list",
      "sincerity_member",
      "member_care",
      "abandon_record",
      "process_record",
    ]) {
      expect(tables).not.toContain(forbidden);
    }
    const indexes = await indexNames(pool);
    expect(indexes).toEqual(
      expect.arrayContaining(["idx_instances_completed", "idx_close_approved", "idx_ownership_active_member"]),
    );
    const instanceColumns = await columnNames(pool, "service_instances");
    expect(instanceColumns).toContain("image_used");
    expect(instanceColumns.some((name) => name.includes("dum"))).toBe(false);
    expect(await columnNames(pool, "members")).not.toContain("progress");
    expect(await columnNames(pool, "applications")).not.toContain("放弃");
    expect(instanceColumns).not.toContain("real_name");
  });

  it("启用中必须有起止，一笔订单只有一条实例，身份缓存不能人手改", async () => {
    const { sqlite, crm } = await fresh();
    await seed(crm, { open: false });
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO service_instances (
            tenant_id, shop_id, member_id, order_id, status,
            activity_total, activity_used, emotion_total, emotion_used,
            one_on_one_total, one_on_one_used, image_total, image_used
          ) VALUES (1, 1, 1, 1, '启用中', 0, 0, 0, 0, 0, 0, 0, 0)`,
        )
        .run(),
    ).toThrow();
    sqlite
      .prepare(
        `INSERT INTO service_instances (
          tenant_id, shop_id, member_id, order_id, status, planned_start,
          activity_total, activity_used, emotion_total, emotion_used,
          one_on_one_total, one_on_one_used, image_total, image_used
        ) VALUES (1, 1, 1, 1, '待启用', '2026-01-01', 0, 0, 0, 0, 0, 0, 0, 0)`,
      )
      .run();
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO service_instances (
            tenant_id, shop_id, member_id, order_id, status, planned_start,
            activity_total, activity_used, emotion_total, emotion_used,
            one_on_one_total, one_on_one_used, image_total, image_used
          ) VALUES (1, 1, 1, 1, '待启用', '2026-01-01', 0, 0, 0, 0, 0, 0, 0, 0)`,
        )
        .run(),
    ).toThrow();
    expect(() => pool.query(`UPDATE members SET member_type = 'VIP' WHERE id = 1`).run()).toThrow(/身份缓存/);
    expect(() => pool.query(`UPDATE members SET maturity = '结婚' WHERE id = 1`).run()).toThrow();
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO applications (
            tenant_id, member_id, order_id, type, status, created_at
          ) VALUES (1, 1, 1, '赠送', '待二审', '2026-01-01')`,
        )
        .run(),
    ).toThrow();
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO service_ownerships (
            tenant_id, shop_id, member_id, service_person_id, assign_role, source, active, assigned_at
          ) VALUES (1, 1, 1, 10, '销售', '指定', 1, '2026-01-01')`,
        )
        .run(),
    ).toThrow();
  });
});

describe("开启", () => {
  it("没有服务人不能开启，并露出缺服务人", async () => {
    const { crm } = await fresh();
    await seed(crm, { assign: false, open: false, registerRole: false });
    const result = await crm.openService({ orderId: 1, today: "2026-01-01", openedBy: "system" });
    expect(result).toEqual({ ok: false, missing: ["缺服务人"] });
    expect((await crm.)?.status).toBe("待启用");
    expect((await crm.)?.memberType).toBe("待开启");
    expect((await crm.)?.status).toBe("启用中");
    expect(instance?.startedOn).toBe("2026-01-01");
    expect(instance?.endedOn).toBe("2026-07-01");
    expect(instance?.totalEnd).toBe("2026-07-01");
    expect(instance?.activityUsed).toBe(0);
    expect(instance?.emotionTotal).toBe(4);
    expect(instance?.openedBy).toBe("system");
    expect(JSON.parse(instance?.openAudit ?? "{}")).toMatchObject({
      paymentStatus: "paid",
      contractCheckStatus: 1,
      servicePersonId: personId,
      plannedStart: "2026-01-01",
      openedBy: "system",
    });
    expect((await crm.)?.memberType).toBe("VIP");
    expect((await crm.)?.maturity).toBe("新升级");
    expect((await crm.)?.type).toBe("ServiceStarted");
    expect(events[0]?.workerId).toBe(personId);
    expect(JSON.parse(events[0]?.payload ?? "{}").compatCleanupExecuted).toBe(true);
    expect((await crm.)?.active).toBe(0);
    expect((await crm.)?.status).toBe("待启用");
    expect((await crm.)?.status).toBe("待启用");
    expect((await crm.)?.openedBy).toBe("15");
    expect((await crm.)?.status).toBe("启用中");
  });

  it("默认服务人只写一位；店长或总监是高优例外；都没有则缺服务人", async () => {
    const { crm } = await fresh();
    const today = "2026-01-01";
    await crm.registerMember({ id: 1, tenantId: TENANT, shopId: 1, createdAt: today });
    await crm.registerShopRole({ tenantId: TENANT, shopId: 1, personId: 8, role: "matchmanager" });
    await crm.registerShopRole({ tenantId: TENANT, shopId: 1, personId: 3, role: "matchmanager" });
    await crm.registerShopRole({ tenantId: TENANT, shopId: 1, personId: 1, role: "shop_manager" });
    await crm.registerShopRole({ tenantId: TENANT, shopId: 1, personId: 2, role: "director" });
    await crm.registerOrderFact({
      id: 1,
      tenantId: TENANT,
      shopId: 1,
      memberId: 1,
      orderTime: today,
      paymentStatus: "payable",
      contractCheckStatus: 1,
      durationMonths: 6,
      plannedStart: today,
    });

    await crm.registerMember({ id: 2, tenantId: TENANT, shopId: 2, createdAt: today });
    await crm.registerShopRole({ tenantId: TENANT, shopId: 2, personId: 9, role: "director" });
    await crm.registerOrderFact({
      id: 2,
      tenantId: TENANT,
      shopId: 2,
      memberId: 2,
      orderTime: today,
      paymentStatus: "paid",
      contractCheckStatus: 1,
      durationMonths: 6,
      plannedStart: today,
    });

    await crm.registerMember({ id: 3, tenantId: TENANT, shopId: 3, createdAt: today });
    await crm.registerShopRole({ tenantId: TENANT, shopId: 3, personId: 4, role: "director" });
    await crm.registerShopRole({ tenantId: TENANT, shopId: 3, personId: 7, role: "shop_manager" });
    await crm.registerOrderFact({
      id: 3,
      tenantId: TENANT,
      shopId: 3,
      memberId: 3,
      orderTime: today,
      paymentStatus: "paid",
      contractCheckStatus: 1,
      durationMonths: 6,
      plannedStart: today,
    });

    await crm.registerMember({ id: 4, tenantId: TENANT, shopId: 4, createdAt: today });
    await crm.registerOrderFact({
      id: 4,
      tenantId: TENANT,
      shopId: 4,
      memberId: 4,
      orderTime: today,
      paymentStatus: "paid",
      contractCheckStatus: 1,
      durationMonths: 6,
      plannedStart: today,
    });

    await crm.registerMember({ id: 5, tenantId: TENANT, shopId: 1, createdAt: today });
    await crm.registerOrderFact({
      id: 5,
      tenantId: TENANT,
      shopId: 1,
      memberId: 5,
      orderTime: today,
      paymentStatus: "unpaid",
      contractCheckStatus: 1,
      durationMonths: 6,
      plannedStart: today,
    });
    await crm.registerMember({ id: 6, tenantId: TENANT, shopId: 1, createdAt: today });
    await crm.registerOrderFact({
      id: 6,
      tenantId: TENANT,
      shopId: 1,
      memberId: 6,
      orderTime: today,
      paymentStatus: "paid",
      contractCheckStatus: 0,
      durationMonths: 6,
      plannedStart: today,
    });
    await crm.registerMember({ id: 7, tenantId: TENANT, shopId: 1, createdAt: today });
    await crm.registerOrderFact({
      id: 7,
      tenantId: TENANT,
      shopId: 1,
      memberId: 7,
      orderTime: today,
      paymentStatus: "paid",
      contractCheckStatus: 1,
      durationMonths: 6,
      plannedStart: "2026-02-01",
    });

    const result = await crm.runAutomatic({ today, tenantId: TENANT });
    expect((await crm.)?.servicePersonId).toBe(3);
    expect((await crm.)?.status).toBe("启用中");
    expect((await crm.)?.servicePersonId).toBe(9);
    expect((await crm.)?.assignedViaRole).toBe("director");
    expect((await crm.)?.servicePersonId).toBe(7);
    expect((await crm.)?.assignedViaRole).toBe("shop_manager");
    expect(result.staffingExceptions.map((row) => row.memberId).sort()).toEqual([2, 3]);
    expect((await crm.)?.status).toBe("待启用");
    expect((await crm.)?.status).toBe("待启用");
    expect(result.opened).not.toContain(7);

    const next = await crm.runAutomatic({ today: "2026-02-01", tenantId: TENANT });
    expect(next.opened).toContain(7);
    expect((await crm.)?.status).toBe("启用中");
    expect((await crm.)?.maturity).toBe("新升级");
    await crm.confirmRecommendation({
      tenantId: TENANT,
      memberId,
      guestMemberId: 2,
      draftId: draft.id ?? undefined,
      today,
    });
    expect((await crm.)?.highlights).toBe("稳定");
    expect((await crm.)?.maturity).toBe("新升级");
    expect((await crm.)?.maturity).toBe("新升级");
    expect((await crm.)?.endedOn).toBe(before?.endedOn);
    await crm.reviewPause({ applicationId, decision: "通过", today: "2026-02-28" });
    const paused = await crm.getServiceInstanceByOrder(orderId);
    expect(paused?.status).toBe("暂停");
    expect(paused?.endedOn).toBe("2026-07-01");
    expect(paused?.totalEnd).toBe("2026-07-01");
    expect((await crm.)?.remainingMonths).toBe(4);
    expect((await crm.)?.memberType).toBe("暂停");
    expect((await crm.)?.maturity).toBe("暂停");
    await crm.resumeService({ applicationId, resumeDate: "2026-04-15" });
    const resumed = await crm.getServiceInstanceByOrder(orderId);
    expect(resumed?.status).toBe("启用中");
    expect(resumed?.endedOn).toBe("2026-08-15");
    expect(resumed?.totalEnd).toBe("2026-08-15");
    expect(resumed?.endedOn).not.toBe("2026-07-01");
    expect((await crm.)?.resumedAt).toBe("2026-04-15");
    expect((await crm.)?.maturity).toBe("暂停");
    expect((await crm.)?.endedOn).toBe("2026-08-15");
    expect((await crm.)?.status).toBe("启用中");
    expect((await crm.)?.emotionTotal).toBe(4);
    expect((await crm.)?.status).toBe("启用中");
    expect(instance?.emotionTotal).toBe(6);
    expect(instance?.emotionUsed).toBe(0);
    expect(instance?.activityUsed).toBe(0);
    expect(instance?.endedOn).toBe("2026-07-11");
    expect(instance?.totalEnd).toBe("2026-07-21");
    expect((await crm.)?.memberType).toBe("VIP");
    const payload = JSON.parse(await crm.getApplication(applicationId)?.payload ?? "{}") as {
      before: { emotionTotal: number; emotionUsed: number };
      after: { emotionTotal: number; emotionUsed: number };
    };
    expect(payload.before.emotionTotal).toBe(4);
    expect(payload.after.emotionTotal).toBe(6);
    expect(payload.before.emotionUsed).toBe(0);
    expect(payload.after.emotionUsed).toBe(0);
    expect((await crm.)?.endedOn;
    const applicationId = await crm.fileClose({ orderId, reason: "双方同意提前结束", consent: null, today });
    expect((await crm.)?.status).toBe("待二审");
    expect((await crm.)?.status).toBe("启用中");
    expect((await crm.)?.endedOn).toBe(endedOn);
    expect((await crm.)?.active).toBe(1);
    expect((await crm.)?.maturity).toBe("新升级");
    expect((await crm.)?.memberType).toBe("VIP");
    expect((await crm.)?.status).toBe("启用中");
    await crm.reviewCloseSecond({ applicationId, decision: "通过", today, closedBy: 80 });
    const closed = await crm.getApplication(applicationId);
    expect(closed?.status).toBe("通过");
    expect(closed?.consent).toBe(1);
    expect(closed?.reason).toBe("双方同意提前结束");
    expect(closed?.closedBy).toBe(80);
    expect(closed?.servicePersonId).toBe(personId);
    expect((await crm.)?.status).toBe("完成");
    expect((await crm.)?.active).toBe(0);
    expect((await crm.)?.maturity).toBe("已关单");
    expect((await crm.)?.memberType).toBe("过期 VIP");
    expect((await crm.)?.reason).toBe("放弃");
    expect((await crm.)?.maturity).toBe("已关单");
    expect((await crm.)?.consent).toBe(false);

    const second = await fresh();
    const opened = await seed(second.crm);
    const other = (await second.crm).fileClose({
      orderId: opened.orderId,
      reason: "共识退费未解约",
      consent: true,
      today: opened.today,
    });
    (await second.crm).reviewCloseFirst({ applicationId: other, decision: "通过", today: opened.today });
    (await second.crm).reviewCloseSecond({ applicationId: other, decision: "通过", today: opened.today, closedBy: 82 });
    expect((await second.crm).getApplication(other)?.reason).toBe("共识退费未解约");
    expect((await second.crm).getMember(opened.memberId)?.maturity).toBe("已关单");
  });

  it("关单二审中途失败会整笔回滚", async () => {
    const { sqlite, crm } = await fresh();
    const { orderId, memberId, today } = await seed(crm);
    const applicationId = await crm.fileClose({ orderId, reason: "到期", consent: true, today });
    await crm.reviewCloseFirst({ applicationId, decision: "通过", today });
    sqlite.exec(
      `CREATE TRIGGER fail_member_update BEFORE UPDATE ON members BEGIN SELECT RAISE(ABORT, 'boom'); END`,
    );
    expect(() => await crm.reviewCloseSecond({ applicationId, decision: "通过", today, closedBy: 80 })).toThrow();
    expect((await crm.)?.status).toBe("启用中");
    expect((await crm.)?.status).toBe("待二审");
    expect((await crm.)?.active).toBe(1);
    expect((await crm.)?.memberType).toBe("VIP");
    expect((await crm.)?.maturity).toBe("新升级");
  });

  it("退费是失效不是完成，并停用这笔订单的服务归属", async () => {
    const { crm } = await fresh();
    const { orderId, memberId, personId, today } = await seed(crm);
    await crm.applyRefundCompleted({ orderId, today });
    expect((await crm.)?.status).toBe("失效");
    expect((await crm.)?.status).not.toBe("完成");
    expect((await crm.)?.active).toBe(0);
    expect((await crm.)?.memberType).toBe("退费");
    expect((await crm.)?.active).toBe(0);

    await seed(crm, { memberId: 2, orderId: 2, personId: 11, registerRole: true });
    const closeTwo = await crm.fileClose({ orderId: 2, reason: "到期", consent: true, today });
    await crm.reviewCloseFirst({ applicationId: closeTwo, decision: "通过", today });
    await crm.reviewCloseSecond({ applicationId: closeTwo, decision: "通过", today, closedBy: 80 });
    await crm.claimByMatchmaker({ tenantId: TENANT, memberId: 2, servicePersonId: 55, today });
    expect((await crm.)?.memberType).toBe("普通");

    const pending = await fresh();
    seed(pending.crm, { plannedStart: "2026-06-01", open: false });
    pending.crm.openService({ orderId: 1, today: "2026-01-01", openedBy: "system" });
    expect(pending.crm.getServiceInstanceByOrder(1)?.status).toBe("待启用");
    expect(pending.crm.memberIdentity(1)).toBe("待开启");
    expect(pending.crm.getMember(1)?.memberType).toBe("待开启");
    expect(pending.crm.listOverdueVip({ tenantId: TENANT })).toHaveLength(0);

    const paused = await fresh();
    seed(paused.crm, { orderId: 1, today: "2026-01-01" });
    const pauseId = paused.crm.filePause({
      orderId: 1,
      reason: "休息",
      pauseStart: "2026-02-28",
      pauseEnd: "2026-03-31",
      today: "2026-02-28",
    });
    paused.crm.reviewPause({ applicationId: pauseId, decision: "通过", today: "2026-02-28" });
    seed(paused.crm, {
      memberId: 1,
      orderId: 2,
      orderTime: "2026-03-01",
      plannedStart: "2026-08-01",
      today: "2026-03-01",
      registerMember: false,
      registerRole: false,
      assign: false,
      open: false,
    });
    paused.crm.openService({ orderId: 2, today: "2026-03-01", openedBy: "system" });
    expect(paused.crm.getServiceInstanceByOrder(2)?.status).toBe("待启用");
    expect(paused.crm.memberIdentity(1)).toBe("暂停");
    expect(paused.crm.getMember(1)?.memberType).toBe("暂停");

    seed(paused.crm, {
      memberId: 1,
      orderId: 3,
      orderTime: "2026-04-01",
      plannedStart: "2026-04-01",
      today: "2026-04-01",
      registerMember: false,
      registerRole: false,
      assign: false,
      open: false,
    });
    expect(paused.crm.openService({ orderId: 3, today: "2026-04-01", openedBy: "system" })).toMatchObject({ ok: true });
    expect(paused.crm.memberIdentity(1)).toBe("VIP");
    expect(paused.crm.getMember(1)?.memberType).toBe("VIP");

    const refundedLatest = await fresh();
    seed(refundedLatest.crm, { memberId: 1, orderId: 20, orderTime: "2026-01-01" });
    const earlyClose = refundedLatest.crm.fileClose({
      orderId: 20,
      reason: "到期",
      consent: true,
      today: "2026-01-01",
    });
    refundedLatest.crm.reviewCloseFirst({ applicationId: earlyClose, decision: "通过", today: "2026-01-01" });
    refundedLatest.crm.reviewCloseSecond({
      applicationId: earlyClose,
      decision: "通过",
      today: "2026-01-01",
      closedBy: 80,
    });
    seed(refundedLatest.crm, {
      memberId: 1,
      orderId: 3,
      orderTime: "2026-08-01",
      today: "2026-08-01",
      registerMember: false,
      registerRole: false,
      open: false,
    });
    refundedLatest.crm.openService({ orderId: 3, today: "2026-08-01", openedBy: "system" });
    refundedLatest.crm.applyRefundCompleted({ orderId: 3, today: "2026-08-01" });
    expect(refundedLatest.crm.memberIdentity(1)).toBe("退费");
    expect(refundedLatest.crm.getMember(1)?.memberType).toBe("退费");

    const completedLatest = await fresh();
    seed(completedLatest.crm, { memberId: 1, orderId: 30, orderTime: "2026-01-01" });
    completedLatest.crm.applyRefundCompleted({ orderId: 30, today: "2026-01-01" });
    seed(completedLatest.crm, {
      memberId: 1,
      orderId: 4,
      orderTime: "2026-08-01",
      today: "2026-08-01",
      registerMember: false,
      registerRole: false,
      open: false,
    });
    completedLatest.crm.openService({ orderId: 4, today: "2026-08-01", openedBy: "system" });
    const laterClose = completedLatest.crm.fileClose({
      orderId: 4,
      reason: "到期",
      consent: true,
      today: "2026-08-01",
    });
    completedLatest.crm.reviewCloseFirst({ applicationId: laterClose, decision: "通过", today: "2026-08-01" });
    completedLatest.crm.reviewCloseSecond({
      applicationId: laterClose,
      decision: "通过",
      today: "2026-08-01",
      closedBy: 80,
    });
    expect(completedLatest.crm.memberIdentity(1)).toBe("过期 VIP");
    expect(completedLatest.crm.getMember(1)?.memberType).toBe("过期 VIP");
  });
});

describe("自动到期和已恋爱", () => {
  it("到期函不关闭服务，到期只起草关单", async () => {
    const { crm } = await fresh();
    await seed(crm, { durationMonths: 1, today: "2026-01-01" });
    const first = await crm.runAutomatic({ today: "2026-02-01", tenantId: TENANT });
    expect(first.expiryLetters).toEqual([1]);
    expect(first.draftedCloses).toEqual([1]);
    expect((await crm.)?.status).toBe("启用中");
    expect((await crm.)?.status).toBe("已发送");
    expect((await crm.)?.memberType).toBe("VIP");
    const draft = await crm.listInProgress({ tenantId: TENANT })[0];
    expect(draft?.status).toBe("待审");
    expect((await crm.)?.id ?? 0)?.reason).toBe("到期");
    expect((await crm.)?.id ?? 0)?.consent).toBeNull();
    await crm.updateExpiryLetterStatus({ orderId: 1, status: "已签署" });
    expect((await crm.)?.status).toBe("启用中");
    const second = await crm.runAutomatic({ today: "2026-02-02", tenantId: TENANT });
    expect(second.expiryLetters).toEqual([]);
    expect(second.draftedCloses).toEqual([]);
    expect((await crm.)?.status).toBe("启用中");
    expect((await crm.)?.maturity).toBe("新升级");

    await crm.setTenantSettings({ tenantId: TENANT, autoDraftCloseOnInLove: true });
    const drafted = await crm.runAutomatic({ today, tenantId: TENANT });
    expect(drafted.draftedCloses).toEqual([1]);
    expect((await crm.)?.status).toBe("启用中");
    expect((await crm.)?.status).toBe("待审");
    expect((await crm.)?.id ?? 0)?.reason).toBe("恋爱");
    expect((await crm.)?.id ?? 0)?.consent).toBeNull();
  });

  it("关掉兼容清理时，销售归属和在服归属同时标出", async () => {
    const { crm } = await fresh();
    await crm.setTenantSettings({ tenantId: TENANT, compatClearDealOwnership: false });
    await crm.registerMember({ id: 1, tenantId: TENANT, shopId: SHOP, createdAt: "2026-01-01" });
    await crm.registerDealAssignment({ tenantId: TENANT, memberId: 1, personId: 70, role: "邀约", today: "2026-01-01" });
    await seed(crm, { registerMember: false });
    expect((await crm.)?.active).toBe(1);
    expect((await crm.)?.payload ?? "{}").compatCleanupExecuted).toBe(false);
    expect(await crm.listServiceLibrary({ tenantId: TENANT, servicePersonId: 10 })).toHaveLength(1);
  });
});
