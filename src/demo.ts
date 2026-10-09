import "./env";
import { createMysqlPool, closeFulfillmentDb } from "./db";
import { createTestFulfillment } from "./fulfillment";

const today = "2026-01-15";
const tenantId = 1;
const shopId = 1;
const memberId = 1;
const guestId = 2;
const orderId = 100;
const matchmanagerId = 20;
const closedBy = 30;

const pool = createMysqlPool();
const crm = await createTestFulfillment(pool);

await crm.registerMember({ id: memberId, tenantId, shopId, createdAt: today });
await crm.registerMember({ id: guestId, tenantId, shopId, createdAt: today });
await crm.registerShopRole({ tenantId, shopId, personId: matchmanagerId, role: "matchmanager" });
await crm.registerOrderFact({
  id: orderId,
  tenantId,
  shopId,
  memberId,
  orderTime: today,
  paymentStatus: "paid",
  contractCheckStatus: 1,
  durationMonths: 6,
  plannedStart: today,
  activityTotal: 2,
  emotionTotal: 4,
  oneOnOneTotal: 2,
  imageTotal: 1,
});

async function printState(title: string, servicePersonId: number) {
  const identity = await crm.memberIdentity(memberId);
  const library = await crm.listServiceLibrary({ tenantId, servicePersonId });
  const overdue = await crm.listOverdueVip({ tenantId });
  console.log(title);
  console.log("身份:", identity);
  console.log("服务库:", library.length === 0 ? "（空）" : JSON.stringify(library));
  console.log("过期 VIP:", overdue.length === 0 ? "（空）" : JSON.stringify(overdue));
  console.log("");
}

await printState("开启前", matchmanagerId);

const assigned = await crm.assignDefaultServicePerson({ tenantId, shopId, memberId, orderId, today });
if (!assigned.ok) {
  console.error(assigned.message);
  process.exit(1);
}

const opened = await crm.openService({ orderId, today, openedBy: "system" });
if (!opened.ok) {
  console.error(opened.missing.join("、"));
  process.exit(1);
}

await printState("开启后", assigned.servicePersonId);

const recommendationId = await crm.confirmRecommendation({
  tenantId,
  memberId,
  guestMemberId: guestId,
  today,
});
console.log("推荐编号:", recommendationId);

const closeId = await crm.fileClose({ orderId, reason: "双方同意结束", consent: true, today });
await crm.reviewCloseFirst({ applicationId: closeId, decision: "通过", today });
await crm.reviewCloseSecond({ applicationId: closeId, decision: "通过", today, closedBy });

await printState("二审通过后", assigned.servicePersonId);

await closeFulfillmentDb(pool);
