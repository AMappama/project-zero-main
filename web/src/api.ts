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
  summary?: string | null;
  todayFacts?: string[];
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
  achievements?: { meetings: number; applications: number; notes: number };
};

export type MemberProfileRecord = {
  memberId: number;
  name: string | null;
  age: number | null;
  city: string | null;
  job: string | null;
  schedule: string | null;
  emotionalNeed: string | null;
  strengths: string | null;
  taboos: string | null;
  disclosureBoundary: string | null;
  source: "manual" | "sync";
  updatedAt: string;
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
  return sendJson<T>("POST", path, body);
}

export function putAction<T>(path: string, body: unknown) {
  return sendJson<T>("PUT", path, body);
}

function sendJson<T>(method: string, path: string, body: unknown) {
  return fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then((response) => read<T>(response));
}

export function formatDay(iso: string) {
  const [year, month, day] = iso.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}
