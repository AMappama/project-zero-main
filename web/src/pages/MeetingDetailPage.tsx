import { useCallback, useEffect, useState } from "react";
import { MeetingResultDialog } from "../actions";
import { getJson, type Workspace } from "../api";
import { memberHref } from "../returnTo";
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

export function MeetingDetailPage({ workspace, meetingId }: { workspace: Workspace; meetingId: number }) {
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [error, setError] = useState("");
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [due, setDue] = useState(false);

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const data = await getJson<{ meetings: Meeting[]; dueIds: number[] }>(
        `/api/meetings?tenantId=${workspace.tenantId}&today=${workspace.today}`,
      );
      setMeeting(data.meetings.find((row) => row.id === meetingId) ?? null);
      setDue(data.dueIds.includes(meetingId));
      setPhase("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "没有读出来");
      setPhase("error");
    }
  }, [meetingId, workspace.tenantId, workspace.today]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Page back fallback="/meetings" title={`约会 ${meetingId}`} intro="这一场约会的对象、时间和结果。到点还没填结果时，只补这一条。">
      <Status phase={phase} error={error} onRetry={() => void load()} loading="正在读取这场约会。" />
      {phase === "ready" && !meeting ? <p className="text-sm text-muted-foreground">没有这场约会。</p> : null}
      {phase === "ready" && meeting ? (
        <article className="grid gap-3 rounded-2xl border border-black/[0.055] bg-white p-5 text-sm shadow-sm">
          <p>
            <a className="font-semibold text-[#5B55D6]" href={memberHref(meeting.serviceMemberId)}>
              会员 {meeting.serviceMemberId}
            </a>
            {" · "}
            {meeting.meetOn ?? "未定日期"} · {meeting.place || "未定地点"}
          </p>
          <p className="text-[#68655F]">
            对象 {meeting.externalName || (meeting.memberId ? `会员 ${meeting.memberId}` : "未定")} · 结果 {meeting.result || "还没填"}
            {due ? " · 到点了" : ""}
          </p>
          {due ? <MeetingResultDialog meetingId={meeting.id} onDone={load} /> : null}
        </article>
      ) : null}
    </Page>
  );
}
