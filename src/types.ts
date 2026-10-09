export const ROLE_PRIORITY = ["matchmanager", "shop_manager", "director"] as const;
export type ShopRoleName = (typeof ROLE_PRIORITY)[number];

export const QUALIFIED_PAYMENTS = ["payable", "paid"] as const;
export type PaymentStatus = "unpaid" | "payable" | "paid";

export type ServiceStatus = "待启用" | "启用中" | "暂停" | "失效" | "完成";
export type ApplicationType = "关单" | "赠送" | "暂停";
export type ApplicationStatus = "待审" | "待二审" | "通过" | "驳回";
export type Maturity = "新升级" | "暂停" | "已关单";
export type QuotaKind = "活动" | "恋爱指导" | "一对一" | "形象";
export type OwnershipSource = "指定" | "默认" | "红娘领取";
export type MemberIdentity = "普通" | "VIP" | "暂停" | "待开启" | "过期 VIP" | "退费";
export type OpenGap = "订单" | "合同" | "缺服务人" | "计划开始日" | "确认开启";
export type OpenedBy = "system" | number;
export type DealRole = "销售" | "邀约";
export type DealSource = "成交遗留" | "关单后领取";

export type OpenResult =
  | { ok: true; instanceId: number; status: "启用中" }
  | { ok: false; missing: OpenGap[] };

export type AssignDefaultResult =
  | {
      ok: true;
      servicePersonId: number;
      alreadyAssigned: boolean;
      assignedViaRole: string | null;
    }
  | { ok: false; message: "缺服务人" };

export const SALES_INVITE_NOT_IN_SERVICE_LIBRARY =
  "销售领取和邀约领取写入成交域归属，不进入服务库。";

export class FulfillmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FulfillmentError";
  }
}
