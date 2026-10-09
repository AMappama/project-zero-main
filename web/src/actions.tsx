import { useEffect, useState, type ReactNode, type TextareaHTMLAttributes } from "react";
import { getJson, postAction, type HomeItem, type HomeScreen } from "./api";
import { isUnwritten, suggestRecommendationCopy, type RecommendationCopy } from "./draftCopy";
import { memberProfile } from "./memberProfile";
import { cn } from "./lib/utils";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./components/ui/dialog";
import { Input } from "./components/ui/input";

const fieldClass = "grid gap-1 text-sm";
const selectClass = "h-9 w-full rounded-md border border-input bg-card px-3 text-sm";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={fieldClass}>
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function useSubmit(onDone: () => Promise<void> | void) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function submit(task: () => Promise<void>) {
    setPending(true);
    setError(null);
    try {
      await task();
      await onDone();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "没有完成这次写入");
      return false;
    } finally {
      setPending(false);
    }
  }
  return { error, pending, submit };
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="text-sm text-destructive">{error}</p>;
}

type FitNote = {
  personId: number;
  fitScore: number;
  whyMatch: string;
  risk: string;
  firstTalk: string;
};

type ServicePersonOption = {
  personId: number;
  name: string;
  roleLabel: string;
  tag: "最推荐" | "推荐" | null;
  reason: string;
  fit?: FitNote;
};

type StaffFitResponse =
  | { available: false }
  | { available: true; failed: true; notice: string }
  | { available: true; failed: false; notes: FitNote[]; order: number[] };

export function AssignDialog(props: {
  trigger: string;
  tenantId: number;
  today: string;
  presetMemberId?: number | null;
  lockMember?: boolean;
  onDone: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [memberId, setMemberId] = useState(props.presetMemberId ? String(props.presetMemberId) : "");
  const [servicePersonId, setServicePersonId] = useState("");
  const [people, setPeople] = useState<ServicePersonOption[]>([]);
  const [peoplePhase, setPeoplePhase] = useState<"loading" | "ready" | "error">("loading");
  const [peopleError, setPeopleError] = useState("");
  const [fitNote, setFitNote] = useState("");
  const { error, pending, submit } = useSubmit(props.onDone);
  const selected = people.find((person) => String(person.personId) === servicePersonId) ?? null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPeoplePhase("loading");
    setPeopleError("");
    setFitNote("");
    getJson<ServicePersonOption[]>(`/api/service-people?tenantId=${props.tenantId}`)
      .then((rows) => {
        if (cancelled) return;
        setPeople(rows);
        setPeoplePhase("ready");
        setServicePersonId(rows[0] ? String(rows[0].personId) : "");
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        void fetch("/api/suggest-staff-fit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tenantId: props.tenantId }),
          signal: controller.signal,
        })
          .then(async (response) => (await response.json()) as StaffFitResponse)
          .then((data) => {
            if (cancelled || !data.available) return;
            if (data.failed) {
              setFitNote(data.notice);
              return;
            }
            const byId = new Map(data.notes.map((note) => [note.personId, note]));
            const rank = new Map(data.order.map((id, index) => [id, index]));
            setPeople((current) =>
              current
                .map((person) => ({ ...person, fit: byId.get(person.personId) }))
                .sort((left, right) => (rank.get(left.personId) ?? 999) - (rank.get(right.personId) ?? 999)),
            );
          })
          .catch(() => {
            if (!cancelled) setFitNote("匹配说明未生成");
          })
          .finally(() => clearTimeout(timer));
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setPeople([]);
        setPeoplePhase("error");
        setPeopleError(caught instanceof Error ? caught.message : "没有读出服务人");
      });
    return () => {
      cancelled = true;
    };
  }, [open, props.tenantId]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && props.presetMemberId) setMemberId(String(props.presetMemberId));
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          {props.trigger}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>指定或更换服务人</DialogTitle>
          <DialogDescription>只改当前这一位服务人。指定之后由系统按开启条件再写一次，没有单独的旧式开启按钮。</DialogDescription>
        </DialogHeader>
        <Field label="会员">
          {props.lockMember && props.presetMemberId ? (
            <p className="text-sm">
              {memberProfile(props.presetMemberId).name} · 会员 {props.presetMemberId}
            </p>
          ) : (
            <Input value={memberId} onChange={(event) => setMemberId(event.target.value)} inputMode="numeric" />
          )}
        </Field>
        <Field label="服务人">
          {peoplePhase === "loading" ? (
            <p className="text-sm text-muted-foreground">正在按权限读取服务人。</p>
          ) : people.length === 0 ? (
            <p className="text-sm text-muted-foreground">{peopleError || "当前权限下没有可指定的服务人。"}</p>
          ) : (
            <select className={selectClass} value={servicePersonId} onChange={(event) => setServicePersonId(event.target.value)}>
              {people.map((person) => (
                <option key={person.personId} value={person.personId}>
                  {person.name}（{person.roleLabel}）{person.tag ? ` · ${person.tag}` : ""}
                </option>
              ))}
            </select>
          )}
        </Field>
        {selected ? <p className="text-xs leading-5 text-muted-foreground">规则说明：{selected.reason}</p> : null}
        {selected?.fit ? (
          <div className="grid gap-1 text-xs leading-5 text-foreground">
            <p>匹配 {selected.fit.fitScore}：{selected.fit.whyMatch}</p>
            <p>风险：{selected.fit.risk}</p>
            <p>第一句：{selected.fit.firstTalk}</p>
          </div>
        ) : fitNote ? (
          <p className="text-xs text-muted-foreground">{fitNote}</p>
        ) : null}
        <ErrorLine error={error} />
        <DialogFooter>
          <Button
            type="button"
            disabled={pending || !servicePersonId}
            onClick={() =>
              void submit(async () => {
                await postAction("/api/actions/assign-service-person", {
                  tenantId: props.tenantId,
                  memberId: Number(memberId),
                  servicePersonId: Number(servicePersonId),
                  today: props.today,
                });
                await postAction("/api/actions/run-automatic", { tenantId: props.tenantId, today: props.today });
                setOpen(false);
              })
            }
          >
            写入这位服务人
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmOpenDialog(props: { orderId: number; today: string; reviewerId: number; onDone: () => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  const [openedBy, setOpenedBy] = useState(String(props.reviewerId));
  const { error, pending, submit } = useSubmit(props.onDone);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm">
          确认开启
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>确认开启</DialogTitle>
          <DialogDescription>租户关掉了自动开启。这一次仍走同一个开启写入，只记确认人，不改会员类型，也不写系统小记。</DialogDescription>
        </DialogHeader>
        <Field label="确认人">
          <Input value={openedBy} onChange={(event) => setOpenedBy(event.target.value)} inputMode="numeric" />
        </Field>
        <ErrorLine error={error} />
        <DialogFooter>
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              void submit(async () => {
                await postAction("/api/actions/open-service", {
                  orderId: props.orderId,
                  today: props.today,
                  openedBy: Number(openedBy),
                });
                setOpen(false);
              })
            }
          >
            确认开启
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FilePauseDialog(props: {
  today: string;
  orders: HomeScreen["filing"]["liveOrders"];
  presetOrderId?: number | null;
  lockOrder?: boolean;
  trigger?: string;
  onDone: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [orderId, setOrderId] = useState(props.presetOrderId ? String(props.presetOrderId) : "");
  const [reason, setReason] = useState("");
  const [pauseStart, setPauseStart] = useState(props.today);
  const [pauseEnd, setPauseEnd] = useState("");
  const { error, pending, submit } = useSubmit(props.onDone);
  const lockedOrder = props.lockOrder ? props.orders.find((order) => order.orderId === props.presetOrderId) : undefined;
  const submitOrderId = props.lockOrder ? props.presetOrderId : Number(orderId);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && props.presetOrderId && !props.lockOrder) setOrderId(String(props.presetOrderId));
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          {props.trigger ?? "发起暂停"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>发起暂停</DialogTitle>
          <DialogDescription>只新增一张暂停申请。通过之前不改结束日。</DialogDescription>
        </DialogHeader>
        {props.lockOrder ? (
          <Field label="订单">
            {props.presetOrderId == null ? (
              <p className="text-sm text-muted-foreground">没有这一笔订单。</p>
            ) : (
              <p className="text-sm">
                订单 {props.presetOrderId}
                {lockedOrder ? ` · 会员 ${lockedOrder.memberId} · ${lockedOrder.status}` : ""}
              </p>
            )}
          </Field>
        ) : (
          <OrderSelect orders={props.orders} value={orderId} onChange={setOrderId} />
        )}
        <Field label="原因">
          <Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="例如会员出差" />
        </Field>
        <Field label="暂停开始">
          <Input value={pauseStart} onChange={(event) => setPauseStart(event.target.value)} placeholder="2026-02-28" />
        </Field>
        <Field label="暂停结束">
          <Input value={pauseEnd} onChange={(event) => setPauseEnd(event.target.value)} placeholder="2026-06-01" />
        </Field>
        <ErrorLine error={error} />
        <DialogFooter>
          <Button
            type="button"
            disabled={pending || !submitOrderId}
            onClick={() =>
              void submit(async () => {
                await postAction("/api/actions/file-pause", {
                  orderId: submitOrderId,
                  reason,
                  pauseStart,
                  pauseEnd,
                  today: props.today,
                });
                setOpen(false);
              })
            }
          >
            提交暂停申请
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FileGiftDialog(props: {
  today: string;
  orders: HomeScreen["filing"]["liveOrders"];
  presetOrderId?: number | null;
  trigger?: string;
  onDone: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [orderId, setOrderId] = useState(props.presetOrderId ? String(props.presetOrderId) : "");
  const [reason, setReason] = useState("");
  const [quotaKind, setQuotaKind] = useState("恋爱指导");
  const [quotaAdd, setQuotaAdd] = useState("");
  const [endDays, setEndDays] = useState("");
  const { error, pending, submit } = useSubmit(props.onDone);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && props.presetOrderId) setOrderId(String(props.presetOrderId));
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          {props.trigger ?? "发起赠送"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>发起赠送</DialogTitle>
          <DialogDescription>只新增申请。通过后增加某一类总量，或延长结束日。已用不动。</DialogDescription>
        </DialogHeader>
        <OrderSelect orders={props.orders} value={orderId} onChange={setOrderId} />
        <Field label="原因">
          <Input value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
        <Field label="次数类别">
          <select className={selectClass} value={quotaKind} onChange={(event) => setQuotaKind(event.target.value)}>
            <option>活动</option>
            <option>恋爱指导</option>
            <option>一对一</option>
            <option>形象</option>
          </select>
        </Field>
        <Field label="增加次数">
          <Input value={quotaAdd} onChange={(event) => setQuotaAdd(event.target.value)} inputMode="numeric" placeholder="留空则只延长天数" />
        </Field>
        <Field label="延长结束日的天数">
          <Input value={endDays} onChange={(event) => setEndDays(event.target.value)} inputMode="numeric" placeholder="留空则只加次数" />
        </Field>
        <ErrorLine error={error} />
        <DialogFooter>
          <Button
            type="button"
            disabled={pending || props.orders.length === 0}
            onClick={() =>
              void submit(async () => {
                await postAction("/api/actions/file-gift", {
                  orderId: Number(orderId),
                  reason,
                  quotaKind: quotaAdd ? quotaKind : undefined,
                  quotaAdd: quotaAdd ? Number(quotaAdd) : undefined,
                  endDays: endDays ? Number(endDays) : undefined,
                  today: props.today,
                });
                setOpen(false);
              })
            }
          >
            提交赠送申请
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FileCloseDialog(props: {
  today: string;
  orders: HomeScreen["filing"]["liveOrders"];
  presetOrderId?: number | null;
  lockOrder?: boolean;
  trigger?: string;
  quiet?: boolean;
  onDone: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [orderId, setOrderId] = useState(props.presetOrderId ? String(props.presetOrderId) : "");
  const [reason, setReason] = useState("双方同意提前结束");
  const [consent, setConsent] = useState("unset");
  const { error, pending, submit } = useSubmit(props.onDone);
  const lockedOrder = props.lockOrder ? props.orders.find((order) => order.orderId === props.presetOrderId) : undefined;
  const submitOrderId = props.lockOrder ? props.presetOrderId : Number(orderId);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && props.presetOrderId && !props.lockOrder) setOrderId(String(props.presetOrderId));
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant={props.quiet ? "link" : "outline"} size="sm">
          {props.trigger ?? "提前关单"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>发起关单</DialogTitle>
          <DialogDescription>只新增关单申请，不改服务实例。是否同意可以现在记，也可以稍后在待判断里补。</DialogDescription>
        </DialogHeader>
        {props.lockOrder ? (
          <Field label="订单">
            {props.presetOrderId == null ? (
              <p className="text-sm text-muted-foreground">没有正在恋爱的订单。</p>
            ) : (
              <p className="text-sm">
                订单 {props.presetOrderId}
                {lockedOrder ? ` · 会员 ${lockedOrder.memberId} · ${lockedOrder.status}` : ""}
              </p>
            )}
          </Field>
        ) : (
          <OrderSelect orders={props.orders} value={orderId} onChange={setOrderId} />
        )}
        <Field label="原因">
          <select className={selectClass} value={reason} onChange={(event) => setReason(event.target.value)}>
            <option>双方同意提前结束</option>
            <option>放弃</option>
            <option>共识退费未解约</option>
            <option>恋爱或结婚</option>
            <option>到期</option>
          </select>
        </Field>
        <Field label="用户是否同意">
          <select className={selectClass} value={consent} onChange={(event) => setConsent(event.target.value)}>
            <option value="unset">还没确认</option>
            <option value="yes">同意</option>
            <option value="no">不同意</option>
          </select>
        </Field>
        <ErrorLine error={error} />
        <DialogFooter>
          <Button
            type="button"
            disabled={pending || !submitOrderId}
            onClick={() =>
              void submit(async () => {
                await postAction("/api/actions/file-close", {
                  orderId: submitOrderId,
                  reason,
                  consent: consent === "yes" ? true : consent === "no" ? false : null,
                  today: props.today,
                });
                setOpen(false);
              })
            }
          >
            提交关单申请
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ResumeDialog(props: {
  today: string;
  pauses: HomeScreen["filing"]["pauses"];
  presetApplicationId?: number | null;
  trigger?: string;
  onDone: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [applicationId, setApplicationId] = useState(props.presetApplicationId ? String(props.presetApplicationId) : "");
  const [resumeDate, setResumeDate] = useState(props.today);
  const { error, pending, submit } = useSubmit(props.onDone);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          {props.trigger ?? "提前恢复"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>提前恢复</DialogTitle>
          <DialogDescription>新的结束日是恢复日加上暂停时还剩的服务月，不是把暂停天数加回原来的结束日。</DialogDescription>
        </DialogHeader>
        {props.pauses.length === 0 ? (
          <p className="text-sm text-muted-foreground">现在没有已通过、尚未恢复的暂停。</p>
        ) : (
          <Field label="暂停申请">
            <select className={selectClass} value={applicationId} onChange={(event) => setApplicationId(event.target.value)}>
              <option value="">选择一张暂停</option>
              {props.pauses.map((pause) => (
                <option key={pause.applicationId} value={pause.applicationId}>
                  申请 {pause.applicationId} · 会员 {pause.memberId} · 暂停到 {pause.pauseEnd}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="恢复日">
          <Input value={resumeDate} onChange={(event) => setResumeDate(event.target.value)} />
        </Field>
        <ErrorLine error={error} />
        <DialogFooter>
          <Button
            type="button"
            disabled={pending || !applicationId}
            onClick={() =>
              void submit(async () => {
                await postAction("/api/actions/resume-service", { applicationId: Number(applicationId), resumeDate });
                setOpen(false);
              })
            }
          >
            确认恢复
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OrderSelect(props: { orders: HomeScreen["filing"]["liveOrders"]; value: string; onChange: (value: string) => void }) {
  if (props.orders.length === 0) {
    return <p className="text-sm text-muted-foreground">现在没有启用中或暂停的服务可以发起。</p>;
  }
  return (
    <Field label="订单">
      <select className={selectClass} value={props.value} onChange={(event) => props.onChange(event.target.value)}>
        <option value="">选择订单</option>
        {props.orders.map((order) => (
          <option key={order.orderId} value={order.orderId}>
            订单 {order.orderId} · 会员 {order.memberId} · {order.status}
          </option>
        ))}
      </select>
    </Field>
  );
}

function Lines({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      rows={2}
      {...props}
      className={cn(
        "w-full resize-y rounded-md border border-input bg-card px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    />
  );
}

export function ConfirmDraftDialog(props: { item: HomeItem; tenantId: number; today: string; onDone: () => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState(props.item.progress ?? "");
  const [reason, setReason] = useState(props.item.reason ?? "");
  const [highlights, setHighlights] = useState(props.item.highlights ?? "");
  const [hiddenPoints, setHiddenPoints] = useState(props.item.hiddenPoints ?? "");
  const [draft, setDraft] = useState<RecommendationCopy | null>(null);
  const [draftNote, setDraftNote] = useState("");
  const [draftPhase, setDraftPhase] = useState<"loading" | "ready">("loading");
  const [fillNote, setFillNote] = useState("");
  const [flash, setFlash] = useState("");
  const { error, pending, submit } = useSubmit(props.onDone);
  const current = { progress, reason, highlights, hiddenPoints };
  const writtenCount = (["progress", "reason", "highlights", "hiddenPoints"] as const).filter((field) => !isUnwritten(current[field], field)).length;

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(""), 750);
    return () => clearTimeout(timer);
  }, [flash]);

  function applyCopy(copy: RecommendationCopy, fields?: Array<keyof RecommendationCopy>) {
    const next = { ...current };
    const target = fields ?? (Object.keys(next) as Array<keyof RecommendationCopy>);
    let filled = 0;
    const touched: string[] = [];
    for (const field of target) {
      if (!isUnwritten(next[field], field)) continue;
      next[field] = copy[field];
      filled += 1;
      touched.push(field);
    }
    setProgress(next.progress);
    setReason(next.reason);
    setHighlights(next.highlights);
    setHiddenPoints(next.hiddenPoints);
    setFlash(touched.join(" "));
    setFillNote(filled > 0 ? "已补上还空着的项，已经写过的没有改。" : "这四项都已经写过了。");
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setDraftPhase("loading");
    setDraftNote("");
    void postAction<{ source: "model" | "local"; notice: string | null; copy: RecommendationCopy }>("/api/actions/suggest-recommendation-copy", {
      tenantId: props.tenantId,
      memberId: props.item.memberId,
      guestMemberId: props.item.guestMemberId,
      facts: props.item.facts,
      today: props.today,
      temperature: 0.7,
    })
      .then((result) => {
        if (cancelled) return;
        setDraft(result.copy);
        setDraftNote(result.notice ?? "");
        setDraftPhase("ready");
      })
      .catch(() => {
        if (cancelled) return;
        const copy = suggestRecommendationCopy(
          memberProfile(props.item.memberId ?? 0).name,
          memberProfile(props.item.guestMemberId ?? 0).name,
          (props.item.memberId ?? 0) * 17 + (props.item.guestMemberId ?? 0),
        );
        setDraft(copy);
        setDraftNote("这次用的是本地草稿");
        setDraftPhase("ready");
      });
    return () => {
      cancelled = true;
    };
  }, [open, props.item.facts, props.item.guestMemberId, props.item.memberId, props.tenantId, props.today]);

  function refreshDraft() {
    setDraftPhase("loading");
    void postAction<{ source: "model" | "local"; notice: string | null; copy: RecommendationCopy }>("/api/actions/suggest-recommendation-copy", {
      tenantId: props.tenantId,
      memberId: props.item.memberId,
      guestMemberId: props.item.guestMemberId,
      facts: props.item.facts,
      today: props.today,
      temperature: 0.9,
      bypassCache: true,
    })
      .then((result) => {
        setDraft(result.copy);
        setDraftNote(result.notice ?? "");
        setDraftPhase("ready");
      })
      .catch(() => {
        const copy = suggestRecommendationCopy(
          memberProfile(props.item.memberId ?? 0).name,
          memberProfile(props.item.guestMemberId ?? 0).name,
          (props.item.memberId ?? 0) * 17 + (props.item.guestMemberId ?? 0),
        );
        setDraft(copy);
        setDraftNote("这次用的是本地草稿");
        setDraftPhase("ready");
      });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm">
          确认推荐
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>确认推荐</DialogTitle>
          <DialogDescription>确认后才写入推荐事实，并把这份草稿结案。不改成熟度。</DialogDescription>
        </DialogHeader>
        <section className="grid gap-2 rounded-md border border-border bg-accent p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium">AI 起草 · 你可以改</p>
            <Button type="button" variant="outline" size="sm" disabled={pending || draftPhase === "loading"} onClick={refreshDraft}>
              换一版
            </Button>
          </div>
          {writtenCount > 0 ? <p className="text-xs text-muted-foreground">✓ 你已经写过了 {writtenCount} 项，AI 不会动它。</p> : null}
          {draftPhase === "loading" ? <p className="text-xs text-muted-foreground">正在准备草稿。</p> : null}
          {draftNote ? <p className="text-xs text-muted-foreground">{draftNote}</p> : null}
          {draft ? (
            <div className="grid gap-2">
              {(
                [
                  ["progress", "进度"],
                  ["reason", "理由"],
                  ["highlights", "亮点"],
                  ["hiddenPoints", "需要隐瞒的点"],
                ] as const
              ).map(([field, label]) => (
                <div key={field} className="flex items-start justify-between gap-3">
                  <p>
                    <span className="text-muted-foreground">{label}：</span>
                    {draft[field]}
                  </p>
                  <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => applyCopy(draft, [field])}>
                    用这段
                  </Button>
                </div>
              ))}
              <Button type="button" size="sm" className="w-fit" disabled={pending} onClick={() => applyCopy(draft)}>
                全部采用
              </Button>
              <p className="text-xs text-muted-foreground">这是 AI 写的，红娘以你的话为准。</p>
            </div>
          ) : null}
        </section>
        {fillNote ? <p className="text-xs text-muted-foreground">{fillNote}</p> : null}
        <Field label="进度">
          <Lines value={progress} onChange={(event) => setProgress(event.target.value)} className={flash.split(" ").includes("progress") ? "field-flash" : undefined} />
        </Field>
        <Field label="理由">
          <Lines value={reason} onChange={(event) => setReason(event.target.value)} className={flash.split(" ").includes("reason") ? "field-flash" : undefined} />
        </Field>
        <Field label="亮点">
          <Lines value={highlights} onChange={(event) => setHighlights(event.target.value)} className={flash.split(" ").includes("highlights") ? "field-flash" : undefined} />
        </Field>
        <Field label="需要隐瞒的点">
          <Lines value={hiddenPoints} onChange={(event) => setHiddenPoints(event.target.value)} className={flash.split(" ").includes("hiddenPoints") ? "field-flash" : undefined} />
        </Field>
        <ErrorLine error={error} />
        <DialogFooter>
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              void submit(async () => {
                await postAction("/api/actions/confirm-recommendation", {
                  tenantId: props.tenantId,
                  memberId: props.item.memberId,
                  guestMemberId: props.item.guestMemberId,
                  draftId: props.item.taskId,
                  progress,
                  reason,
                  highlights,
                  hiddenPoints,
                  today: props.today,
                });
                setOpen(false);
              })
            }
          >
            写入推荐
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MeetingResultDialog(props: { meetingId: number; onDone: () => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState("已见面");
  const [feedback, setFeedback] = useState("");
  const { error, pending, submit } = useSubmit(props.onDone);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm">
          填写见面结果
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>见面结果</DialogTitle>
          <DialogDescription>只写在这条约会上。不抄进成熟度，也不写系统小记。</DialogDescription>
        </DialogHeader>
        <Field label="结果">
          <select className={selectClass} value={result} onChange={(event) => setResult(event.target.value)}>
            <option>已见面</option>
            <option>未见面</option>
            <option>取消</option>
            <option>恋爱</option>
          </select>
        </Field>
        <Field label="双方反馈">
          <Input value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="可以留空" />
        </Field>
        <ErrorLine error={error} />
        <DialogFooter>
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              void submit(async () => {
                await postAction("/api/actions/record-meeting-result", {
                  meetingId: props.meetingId,
                  result,
                  feedback,
                });
                setOpen(false);
              })
            }
          >
            记下结果
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ConsentButtons(props: { applicationId: number; onDone: () => Promise<void> | void }) {
  const { error, pending, submit } = useSubmit(props.onDone);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={() => void submit(() => postAction("/api/actions/set-close-consent", { applicationId: props.applicationId, consent: true }).then(() => undefined))}>
          用户同意
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => void submit(() => postAction("/api/actions/set-close-consent", { applicationId: props.applicationId, consent: false }).then(() => undefined))}>
          用户不同意
        </Button>
      </div>
      <ErrorLine error={error} />
    </div>
  );
}

export function ReviewButtons(props: { item: HomeItem; today: string; reviewerId: number; onDone: () => Promise<void> | void }) {
  const endpoint =
    props.item.kind === "赠送"
      ? "/api/actions/review-gift"
      : props.item.kind === "暂停"
        ? "/api/actions/review-pause"
        : props.item.level === "二审"
          ? "/api/actions/review-close-second"
          : "/api/actions/review-close-first";
  return (
    <div className="flex flex-wrap gap-2">
      <DecisionDialog
        title={props.item.level === "二审" ? "通过关单二审" : props.item.kind === "关单" ? "通过关单一审" : `通过这张${props.item.kind}`}
        description={
          props.item.level === "一审"
            ? "一审只把申请改为待二审，服务实例保持原状。"
            : props.item.level === "二审"
              ? "二审通过才把实例改为完成。需要用户是否同意、原因、关单人和当时的服务人。"
              : "赠送和暂停只审一次。通过和驳回走同一个写入。"
        }
        trigger="通过"
        today={props.today}
        reviewerId={props.reviewerId}
        askCloser={props.item.level === "二审"}
        onSubmit={(closedBy) =>
          postAction(endpoint, {
            applicationId: props.item.applicationId,
            decision: "通过",
            today: props.today,
            closedBy,
          }).then(() => undefined)
        }
        onDone={props.onDone}
      />
      <DecisionDialog
        title="驳回"
        description="驳回只改这张申请，服务实例保持原状。"
        trigger="驳回"
        variant="outline"
        today={props.today}
        reviewerId={props.reviewerId}
        askCloser={false}
        onSubmit={() =>
          postAction(endpoint, {
            applicationId: props.item.applicationId,
            decision: "驳回",
            today: props.today,
          }).then(() => undefined)
        }
        onDone={props.onDone}
      />
    </div>
  );
}

function DecisionDialog(props: {
  title: string;
  description: string;
  trigger: string;
  variant?: "default" | "outline" | "link";
  today: string;
  reviewerId: number;
  askCloser: boolean;
  onSubmit: (closedBy?: number) => Promise<void>;
  onDone: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [closedBy, setClosedBy] = useState(String(props.reviewerId));
  const { error, pending, submit } = useSubmit(props.onDone);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant={props.variant ?? "default"}>
          {props.trigger}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{props.description}</DialogDescription>
        </DialogHeader>
        {props.askCloser ? (
          <Field label="关单人">
            <Input value={closedBy} onChange={(event) => setClosedBy(event.target.value)} inputMode="numeric" />
          </Field>
        ) : null}
        <ErrorLine error={error} />
        <DialogFooter>
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              void submit(async () => {
                await props.onSubmit(props.askCloser ? Number(closedBy) : undefined);
                setOpen(false);
              })
            }
          >
            确认
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
