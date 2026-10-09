import { useCallback, useEffect, useState } from "react";
import { staffName } from "../../../src/staff";
import { getJson, postAction, putAction, type MemberProfileRecord, type Workspace } from "../api";
import { MemberAvatar } from "../components/MemberAvatar";
import { loadMemberProfiles, memberProfile } from "../memberProfile";
import { withFrom } from "../returnTo";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Page, Status } from "./LibraryPage";

type Detail = {
  member: { id: number; shopId: number; maturity: string | null };
  identity: string;
  ownership: { servicePersonId: number; source: string; active: number } | null;
  instances: {
    orderId: number;
    status: string;
    plannedStart: string | null;
    startedOn: string | null;
    endedOn: string | null;
    totalEnd: string | null;
    activityTotal: number;
    activityUsed: number;
    emotionTotal: number;
    emotionUsed: number;
    oneOnOneTotal: number;
    oneOnOneUsed: number;
    imageTotal: number;
    imageUsed: number;
  }[];
  notes: { id: number; body: string; createdAt: string }[];
  recommendations: { id: number; guestMemberId: number; reason: string | null; progress: string | null }[];
  meetings: { id: number; meetOn: string | null; place: string | null; result: string | null; externalName: string | null; memberId: number | null }[];
  signals: string[];
};

export function MemberPage({ workspace, memberId }: { workspace: Workspace; memberId: number }) {
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState("");
  const [profileForm, setProfileForm] = useState<MemberProfileRecord | null>(null);
  const [profileError, setProfileError] = useState("");
  const [profileSaved, setProfileSaved] = useState("");

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      setDetail(await getJson<Detail>(`/api/members/${memberId}?today=${workspace.today}`));
      setProfileForm(await getJson<MemberProfileRecord>(`/api/members/${memberId}/profile`));
      setPhase("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "没有读出来");
      setPhase("error");
    }
  }, [memberId, workspace.today]);

  useEffect(() => {
    void load();
  }, [load]);

  const profile = memberProfile(memberId);
  return (
    <Page back fallback="/" title={profile.name} intro="身份和成熟度由服务实例写入，这一页不能改。也没有旧式开启按钮，没有课次，不能手工把人写进过期库。">
      <Status phase={phase} error={error} onRetry={() => void load()} loading="正在读取这位会员。" />
      {phase === "ready" && detail ? (
        <>
          <div className="flex items-center gap-4 rounded-lg border border-border bg-card p-4">
            <MemberAvatar name={profile.name} src={profile.avatar} size="lg" />
            <div>
              <p className="text-lg font-semibold">{profile.name}</p>
              <p className="mt-1 text-sm text-muted-foreground">门店 {detail.member.shopId}</p>
            </div>
          </div>
          <dl className="grid gap-3 rounded-lg border border-border bg-card p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">身份</dt>
              <dd className="mt-1 text-base font-medium">{detail.identity}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">成熟度</dt>
              <dd className="mt-1 text-base font-medium">{maturityLabel(detail)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">当前服务人</dt>
              <dd className="mt-1">{detail.ownership?.active ? `${staffName(detail.ownership.servicePersonId)} · ${detail.ownership.source}` : "没有有效服务人"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">关怀</dt>
              <dd className="mt-1">{detail.signals.length ? detail.signals.join("、") : "今天没有这些信号"}</dd>
            </div>
          </dl>
          {profileForm ? (
            <form
              className="grid gap-3 rounded-lg border border-border bg-card p-4"
              onSubmit={(event) => {
                event.preventDefault();
                setProfileError("");
                setProfileSaved("");
                void putAction<MemberProfileRecord>(`/api/members/${memberId}/profile`, {
                  ...profileForm,
                  today: workspace.today,
                })
                  .then(async (saved) => {
                    setProfileForm(saved);
                    setProfileSaved("画像已记下。身份没有改。");
                    await loadMemberProfiles();
                    await load();
                  })
                  .catch((caught: unknown) => setProfileError(caught instanceof Error ? caught.message : "没有写上"));
              }}
            >
              <h2 className="font-medium">画像</h2>
              <p className="text-sm text-muted-foreground">只记红娘写下的事实。空着的项保持空着，不编年龄、城市或职业。</p>
              {(
                [
                  ["name", "姓名"],
                  ["age", "年龄"],
                  ["city", "城市"],
                  ["job", "职业"],
                  ["schedule", "作息"],
                  ["emotionalNeed", "情感需求"],
                  ["strengths", "优点"],
                  ["taboos", "禁忌"],
                  ["disclosureBoundary", "可对嘉宾说的边界"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="grid gap-1 text-sm">
                  <span className="text-muted-foreground">{label}</span>
                  <Input
                    value={profileForm[key] == null ? "" : String(profileForm[key])}
                    onChange={(event) => {
                      const raw = event.target.value;
                      setProfileForm({ ...profileForm, [key]: key === "age" ? (raw === "" ? null : Number(raw)) : raw });
                    }}
                  />
                </label>
              ))}
              {profileError ? <p className="text-sm text-destructive">{profileError}</p> : null}
              {profileSaved ? <p className="text-sm text-[var(--color-celebrate)]">{profileSaved}</p> : null}
              <Button type="submit" className="w-fit">
                记下画像
              </Button>
            </form>
          ) : null}
          <section className="grid gap-2">
            <h2 className="font-medium">服务实例</h2>
            {detail.instances.length === 0 ? <p className="text-sm text-muted-foreground">还没有服务实例，身份是普通。</p> : null}
            {detail.instances.map((instance) => (
              <article key={instance.orderId} className="rounded-lg border border-border bg-card p-4 text-sm">
                <p>
                  订单 {instance.orderId} · {instance.status}
                </p>
                <p className="mt-1 text-muted-foreground">
                  计划开始 {instance.plannedStart ?? "未记"} · 开始 {instance.startedOn ?? "未记"} · 结束 {instance.endedOn ?? "未记"} · 总结束 {instance.totalEnd ?? "未记"}
                </p>
                <p className="mt-1 text-muted-foreground">
                  活动 {instance.activityUsed}/{instance.activityTotal} · 恋爱指导 {instance.emotionUsed}/{instance.emotionTotal} · 一对一 {instance.oneOnOneUsed}/{instance.oneOnOneTotal} · 形象 {instance.imageUsed}/{instance.imageTotal}
                </p>
              </article>
            ))}
          </section>
          <section className="grid gap-2">
            <h2 className="font-medium">推荐</h2>
            {detail.recommendations.length === 0 ? <p className="text-sm text-muted-foreground">还没有确认过的推荐。待确认草稿在工作台的待判断里。</p> : null}
            {detail.recommendations.map((row) => (
              <p key={row.id} className="text-sm">
                嘉宾 {memberProfile(row.guestMemberId).name} · {row.progress || "未写进度"} · {row.reason || "未写理由"}
              </p>
            ))}
          </section>
          <section className="grid gap-2">
            <h2 className="font-medium">约会</h2>
            {detail.meetings.length === 0 ? <p className="text-sm text-muted-foreground">还没有约会。</p> : null}
            {detail.meetings.map((meeting) => (
              <p key={meeting.id} className="text-sm">
                <a className="font-medium text-primary" href={withFrom(`/meetings/${meeting.id}`)}>
                  打开这场约会
                </a>
                {" · "}
                {meeting.meetOn ?? "未定日期"} · {meeting.place || "未定地点"} · 对象 {meeting.externalName || (meeting.memberId ? memberProfile(meeting.memberId).name : "未定")} · 结果 {meeting.result || "还没填"}
              </p>
            ))}
          </section>
          <section className="grid gap-2">
            <h2 className="font-medium">人工小记</h2>
            <p className="text-sm text-muted-foreground">电话、企微这些日常联系记在这里。调配、开启、关单不会自动写一条。</p>
            {detail.notes.length === 0 ? <p className="text-sm text-muted-foreground">还没有人工小记。</p> : null}
            {detail.notes.map((item) => (
              <p key={item.id} className="text-sm">
                {item.createdAt} · {item.body}
              </p>
            ))}
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(event) => {
                event.preventDefault();
                setNoteError("");
                void postAction("/api/actions/add-note", {
                  tenantId: workspace.tenantId,
                  memberId,
                  body: note,
                  today: workspace.today,
                })
                  .then(() => {
                    setNote("");
                    return load();
                  })
                  .catch((caught: unknown) => setNoteError(caught instanceof Error ? caught.message : "没有记下"));
              }}
            >
              <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="这次电话或企微里说了什么" />
              <Button type="submit">记下这次联系</Button>
            </form>
            {noteError ? <p className="text-sm text-destructive">{noteError}</p> : null}
          </section>
        </>
      ) : null}
    </Page>
  );
}

function maturityLabel(detail: Detail) {
  return detail.member.maturity ?? "中间档留空，系统只在开启、暂停和关单时写";
}
