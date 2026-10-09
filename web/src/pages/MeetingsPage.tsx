import { useCallback, useEffect, useState } from "react";
import { MeetingResultDialog } from "../actions";
import { getJson, hasPermission, postAction, type Account, type Workspace } from "../api";
import { withFrom } from "../returnTo";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Page, Status } from "./LibraryPage";

type Meeting = {
  id: number;
  serviceMemberId: number;
  memberId: number | null;
  externalName: string | null;
  meetOn: string | null;
  place: string | null;
  result: string | null;
};

export function MeetingsPage({ workspace, account }: { workspace: Workspace; account: Account }) {
  const matchmaker = hasPermission(account, "红娘");
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [error, setError] = useState("");
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [dueIds, setDueIds] = useState<number[]>([]);
  const [serviceMemberId, setServiceMemberId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [externalName, setExternalName] = useState("");
  const [meetOn, setMeetOn] = useState(workspace.today);
  const [place, setPlace] = useState("");
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const data = await getJson<{ meetings: Meeting[]; dueIds: number[] }>(
        `/api/meetings?tenantId=${workspace.tenantId}&today=${workspace.today}`,
      );
      setMeetings(data.meetings);
      setDueIds(data.dueIds);
      setPhase("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "没有读出来");
      setPhase("error");
    }
  }, [workspace.tenantId, workspace.today]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Page title="约会" intro="这份名单来自约会查询。点开一场约会看详情，返回回到这里。到点还没有结果的，只补这条约会自己的结果。">
      <Status phase={phase} error={error} onRetry={() => void load()} loading="正在读取约会。" />
      {phase === "ready" && meetings.length === 0 ? (
        <p className="text-sm text-muted-foreground">还没有约会。确认了对象和时间之后，写在这里。</p>
      ) : null}
      {phase === "ready" && meetings.length > 0 ? (
        <div className="overflow-hidden rounded-2xl border border-black/[0.055] bg-white shadow-sm">
          {meetings.map((meeting) => (
            <div key={meeting.id} className="border-b border-black/[0.045] last:border-b-0">
              <a href={withFrom(`/meetings/${meeting.id}`)} className="block px-5 py-4 hover:bg-surface">
                <span className="block text-sm font-semibold">
                  会员 {meeting.serviceMemberId} · {meeting.meetOn ?? "未定日期"}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {meeting.place || "未定地点"} · 对象 {meeting.externalName || (meeting.memberId ? `会员 ${meeting.memberId}` : "未定")} · 结果{" "}
                  {meeting.result || "还没填"}
                  {dueIds.includes(meeting.id) ? " · 到点了" : ""}
                </span>
              </a>
              {matchmaker && dueIds.includes(meeting.id) ? (
                <div className="px-5 pb-4">
                  <MeetingResultDialog meetingId={meeting.id} onDone={load} />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {matchmaker ? (
      <form
        className="grid gap-3 rounded-lg border border-border bg-card p-4"
        onSubmit={(event) => {
          event.preventDefault();
          setFormError("");
          void postAction("/api/actions/confirm-meeting", {
            tenantId: workspace.tenantId,
            serviceMemberId: Number(serviceMemberId),
            memberId: memberId ? Number(memberId) : null,
            externalName: externalName || null,
            meetOn,
            place,
            today: workspace.today,
          })
            .then(() => {
              setServiceMemberId("");
              setMemberId("");
              setExternalName("");
              setPlace("");
              return load();
            })
            .catch((caught: unknown) => setFormError(caught instanceof Error ? caught.message : "没有记下约会"));
        }}
      >
        <h2 className="font-medium">确认一次约会</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">服务会员</span>
            <Input value={serviceMemberId} onChange={(event) => setServiceMemberId(event.target.value)} inputMode="numeric" />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">对象会员</span>
            <Input value={memberId} onChange={(event) => setMemberId(event.target.value)} inputMode="numeric" placeholder="外部对象可留空" />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">外部姓名</span>
            <Input value={externalName} onChange={(event) => setExternalName(event.target.value)} placeholder="对象不是库内会员时填写" />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">日期</span>
            <Input value={meetOn} onChange={(event) => setMeetOn(event.target.value)} />
          </label>
          <label className="grid gap-1 text-sm sm:col-span-2">
            <span className="text-muted-foreground">地点</span>
            <Input value={place} onChange={(event) => setPlace(event.target.value)} placeholder="例如门店会客室" />
          </label>
        </div>
        {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
        <Button type="submit" className="w-fit">
          确认约会
        </Button>
      </form>
      ) : null}
    </Page>
  );
}
