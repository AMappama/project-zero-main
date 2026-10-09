import { int, mysqlTable, text, varchar } from "drizzle-orm/mysql-core";

/** 查询用的列模型。建表、CHECK 和索引在 schema.sql.ts，列名保持一致。 */

export const writeGuard = mysqlTable("write_guard", {
  id: int("id").primaryKey(),
  allowIdentityCache: int("allow_identity_cache").notNull(),
});

export const members = mysqlTable("members", {
  id: int("id").primaryKey().autoincrement(),
  tenantId: int("tenant_id").notNull(),
  shopId: int("shop_id").notNull(),
  maturity: varchar("maturity", { length: 32 }),
  memberType: varchar("member_type", { length: 32 }).notNull(),
  createdAt: varchar("created_at", { length: 32 }).notNull(),
});

export const tenantSettings = mysqlTable("tenant_settings", {
  tenantId: int("tenant_id").primaryKey(),
  autoStartService: int("auto_start_service").notNull(),
  autoDraftCloseOnInLove: int("auto_draft_close_on_in_love").notNull(),
  compatClearDealOwnership: int("compat_clear_deal_ownership").notNull(),
});

export const orderFacts = mysqlTable("order_facts", {
  id: int("id").primaryKey().autoincrement(),
  tenantId: int("tenant_id").notNull(),
  shopId: int("shop_id").notNull(),
  memberId: int("member_id").notNull(),
  orderTime: varchar("order_time", { length: 64 }).notNull(),
  paymentStatus: varchar("payment_status", { length: 16 }).notNull(),
  contractCheckStatus: int("contract_check_status").notNull(),
  durationMonths: int("duration_months").notNull(),
  plannedStart: varchar("planned_start", { length: 32 }).notNull(),
  activityTotal: int("activity_total").notNull(),
  emotionTotal: int("emotion_total").notNull(),
  oneOnOneTotal: int("one_on_one_total").notNull(),
  imageTotal: int("image_total").notNull(),
  refundStatus: varchar("refund_status", { length: 16 }).notNull(),
});

export const shopRoles = mysqlTable("shop_roles", {
  id: int("id").primaryKey().autoincrement(),
  tenantId: int("tenant_id").notNull(),
  shopId: int("shop_id").notNull(),
  personId: int("person_id").notNull(),
  role: varchar("role", { length: 32 }).notNull(),
});

export const serviceOwnerships = mysqlTable("service_ownerships", {
  id: int("id").primaryKey().autoincrement(),
  tenantId: int("tenant_id").notNull(),
  shopId: int("shop_id").notNull(),
  memberId: int("member_id").notNull().unique(),
  orderId: int("order_id"),
  servicePersonId: int("service_person_id").notNull(),
  assignRole: varchar("assign_role", { length: 16 }).notNull(),
  source: varchar("source", { length: 16 }).notNull(),
  assignedViaRole: varchar("assigned_via_role", { length: 32 }),
  active: int("active").notNull(),
  assignedAt: varchar("assigned_at", { length: 32 }).notNull(),
  deactivatedAt: varchar("deactivated_at", { length: 32 }),
});

export const serviceInstances = mysqlTable("service_instances", {
  id: int("id").primaryKey().autoincrement(),
  tenantId: int("tenant_id").notNull(),
  shopId: int("shop_id").notNull(),
  memberId: int("member_id").notNull(),
  orderId: int("order_id").notNull().unique(),
  status: varchar("status", { length: 16 }).notNull(),
  plannedStart: varchar("planned_start", { length: 32 }),
  startedOn: varchar("started_on", { length: 32 }),
  endedOn: varchar("ended_on", { length: 32 }),
  totalEnd: varchar("total_end", { length: 32 }),
  durationMonths: int("duration_months"),
  activityTotal: int("activity_total").notNull(),
  activityUsed: int("activity_used").notNull(),
  emotionTotal: int("emotion_total").notNull(),
  emotionUsed: int("emotion_used").notNull(),
  oneOnOneTotal: int("one_on_one_total").notNull(),
  oneOnOneUsed: int("one_on_one_used").notNull(),
  imageTotal: int("image_total").notNull(),
  imageUsed: int("image_used").notNull(),
  openedBy: varchar("opened_by", { length: 64 }),
  openAudit: text("open_audit"),
});

export const applications = mysqlTable("applications", {
  id: int("id").primaryKey().autoincrement(),
  tenantId: int("tenant_id").notNull(),
  memberId: int("member_id").notNull(),
  orderId: int("order_id").notNull(),
  type: varchar("type", { length: 16 }).notNull(),
  status: varchar("status", { length: 16 }).notNull(),
  consent: int("consent"),
  reason: text("reason"),
  servicePersonId: int("service_person_id"),
  closedBy: int("closed_by"),
  giftEndDays: int("gift_end_days"),
  giftTotalEndDays: int("gift_total_end_days"),
  giftQuotaKind: varchar("gift_quota_kind", { length: 16 }),
  giftQuotaAdd: int("gift_quota_add"),
  payload: text("payload"),
  pauseStart: varchar("pause_start", { length: 32 }),
  pauseEnd: varchar("pause_end", { length: 32 }),
  resumedAt: varchar("resumed_at", { length: 32 }),
  remainingMonths: int("remaining_months"),
  createdAt: varchar("created_at", { length: 32 }).notNull(),
  decidedAt: varchar("decided_at", { length: 32 }),
});

export const recommendations = mysqlTable("recommendations", {
  id: int("id").primaryKey().autoincrement(),
  tenantId: int("tenant_id").notNull(),
  memberId: int("member_id").notNull(),
  guestMemberId: int("guest_member_id").notNull(),
  progress: text("progress"),
  reason: text("reason"),
  highlights: text("highlights"),
  hiddenPoints: text("hidden_points"),
  createdAt: varchar("created_at", { length: 32 }).notNull(),
});

export const meetings = mysqlTable("meetings", {
  id: int("id").primaryKey().autoincrement(),
  tenantId: int("tenant_id").notNull(),
  serviceMemberId: int("service_member_id").notNull(),
  memberId: int("member_id"),
  externalName: varchar("external_name", { length: 255 }),
  meetOn: varchar("meet_on", { length: 32 }),
  place: varchar("place", { length: 255 }),
  memberStatus: varchar("member_status", { length: 64 }),
  objectStatus: varchar("object_status", { length: 64 }),
  result: varchar("result", { length: 64 }),
  feedback: text("feedback"),
  createdAt: varchar("created_at", { length: 32 }).notNull(),
});

export const notes = mysqlTable("notes", {
  id: int("id").primaryKey().autoincrement(),
  tenantId: int("tenant_id").notNull(),
  memberId: int("member_id").notNull(),
  body: text("body").notNull(),
  createdAt: varchar("created_at", { length: 32 }).notNull(),
});

export const tasks = mysqlTable("tasks", {
  id: int("id").primaryKey().autoincrement(),
  tenantId: int("tenant_id").notNull(),
  shopId: int("shop_id").notNull(),
  memberId: int("member_id").notNull(),
  kind: varchar("kind", { length: 16 }).notNull(),
  status: varchar("status", { length: 16 }).notNull(),
  orderId: int("order_id"),
  guestMemberId: int("guest_member_id"),
  reason: text("reason"),
  highlights: text("highlights"),
  hiddenPoints: text("hidden_points"),
  progress: text("progress"),
  createdAt: varchar("created_at", { length: 32 }).notNull(),
  closedAt: varchar("closed_at", { length: 32 }),
});

export const closeVipContract = mysqlTable("close_vip_contract", {
  id: int("id").primaryKey().autoincrement(),
  tenantId: int("tenant_id").notNull(),
  memberId: int("member_id").notNull(),
  servicePersonId: int("service_person_id"),
  orderId: int("order_id").notNull().unique(),
  serviceStart: varchar("service_start", { length: 32 }),
  serviceEnd: varchar("service_end", { length: 32 }),
  letterUrl: text("letter_url"),
  status: varchar("status", { length: 64 }).notNull(),
  remark: text("remark"),
  createdAt: varchar("created_at", { length: 32 }).notNull(),
});

export const outboxEvents = mysqlTable("outbox_events", {
  id: int("id").primaryKey().autoincrement(),
  tenantId: int("tenant_id").notNull(),
  type: varchar("type", { length: 64 }).notNull(),
  memberId: int("member_id").notNull(),
  orderId: int("order_id").notNull(),
  workerId: int("worker_id").notNull(),
  payload: text("payload").notNull(),
  createdAt: varchar("created_at", { length: 32 }).notNull(),
  consumedAt: varchar("consumed_at", { length: 32 }),
});

export const dealAssignments = mysqlTable("deal_assignments", {
  id: int("id").primaryKey().autoincrement(),
  tenantId: int("tenant_id").notNull(),
  shopId: int("shop_id").notNull(),
  memberId: int("member_id").notNull(),
  personId: int("person_id").notNull(),
  role: varchar("role", { length: 16 }).notNull(),
  source: varchar("source", { length: 16 }).notNull(),
  active: int("active").notNull(),
  createdAt: varchar("created_at", { length: 32 }).notNull(),
  deactivatedAt: varchar("deactivated_at", { length: 32 }),
});
