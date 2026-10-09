export type HomeItem = {
  key: string;
  kind: string;
  title: string;
  detail: string;
  memberId: number | null;
  orderId: number | null;
  applicationId: number | null;
  taskId: number | null;
  meetingId: number | null;
  guestMemberId: number | null;
  facts: string[];
  applicationStatus: string | null;
  consent: boolean | null;
  reason: string | null;
  level: "一审" | "二审" | null;
  highlights: string | null;
  hiddenPoints: string | null;
  progress: string | null;
};

export type HomeScreen = {
  today: string;
  tenantId: number;
  judgement: HomeItem[];
  exceptions: HomeItem[];
  reviews: HomeItem[];
  filing: {
    liveOrders: { orderId: number; memberId: number; status: string }[];
    pauses: { applicationId: number; orderId: number; memberId: number; pauseEnd: string | null }[];
  };
};

export type Account = {
  id: number;
  name: string;
  personId: number;
  permissions: Array<"红娘" | "审核人">;
};

export function hasPermission(account: Account, permission: "红娘" | "审核人") {
  return account.permissions.includes(permission);
}

export type Workspace = {
  today: string;
  tenantId: number;
  shopId: number;
  servicePersonId: number;
  reviewerId: number;
};

async function read<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({ error: "没有读到结果" }))) as { error?: string };
  if (!response.ok) throw new Error(data.error || "没有完成这次请求");
  return data as T;
}

export function getJson<T>(path: string) {
  return fetch(path).then((response) => read<T>(response));
}

export function postAction<T>(path: string, body: unknown) {
  return fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then((response) => read<T>(response));
}

export function formatDay(iso: string) {
  const [year, month, day] = iso.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}
