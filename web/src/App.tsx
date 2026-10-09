import { useEffect, useState } from "react";
import { formatDay, getJson, hasPermission, postAction, type Account, type Workspace } from "./api";
import { loadMemberProfiles } from "./memberProfile";
import { HomePage } from "./pages/HomePage";
import { SignInPage } from "./pages/SignInPage";
import { LibraryPage } from "./pages/LibraryPage";
import { MeetingDetailPage } from "./pages/MeetingDetailPage";
import { MeetingsPage } from "./pages/MeetingsPage";
import { MemberPage } from "./pages/MemberPage";
import { OverduePage } from "./pages/OverduePage";
import { ReviewDetailPage } from "./pages/ReviewDetailPage";
import { ReviewsPage } from "./pages/ReviewsPage";

const NAV = [
  {
    label: "今日",
    items: [{ href: "/", label: "服务跟进", icon: "today" }],
  },
  {
    label: "业务",
    items: [
      { href: "/library", label: "服务库", icon: "library" },
      { href: "/meetings", label: "约会", icon: "calendar" },
      { href: "/reviews", label: "审核列表", icon: "check" },
      { href: "/overdue", label: "过期 VIP", icon: "star" },
    ],
  },
];

const TITLES: Record<string, string> = {
  "/": "服务跟进",
  "/library": "服务库",
  "/meetings": "约会",
  "/reviews": "审核列表",
  "/overdue": "过期 VIP",
};

export function App() {
  const path = window.location.pathname;
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [error, setError] = useState("");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [sessionPhase, setSessionPhase] = useState<"loading" | "ready">("loading");
  const [navOpen, setNavOpen] = useState(false);
  const [, setNamesReady] = useState(false);

  useEffect(() => {
    fetch("/api/session")
      .then(async (response) => {
        if (response.ok) setAccount((await response.json()) as Account);
        setSessionPhase("ready");
      })
      .catch(() => setSessionPhase("ready"));
  }, []);

  useEffect(() => {
    if (!account) return;
    loadMemberProfiles()
      .then(() => setNamesReady(true))
      .catch(() => setNamesReady(false));
    getJson<Workspace>("/api/workspace")
      .then((data) => {
        setWorkspace(data);
        setPhase("ready");
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "没有读出来");
        setPhase("error");
      });
  }, [account]);

  if (sessionPhase === "loading") {
    return <p className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground">正在确认账号。</p>;
  }
  if (!account) return <SignInPage onSignedIn={setAccount} />;

  const reviewer = hasPermission(account, "审核人");
  const permissionLabel = account.permissions.join("、");
  const memberMatch = path.match(/^\/members\/(\d+)$/);
  const meetingMatch = path.match(/^\/meetings\/(\d+)$/);
  const reviewMatch = path.match(/^\/reviews\/(\d+)$/);
  const title = memberMatch ? "会员" : meetingMatch ? "约会" : reviewMatch ? "审核" : (TITLES[path] ?? "服务跟进");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-[1720px]">
        {navOpen ? (
          <button type="button" aria-label="关闭导航" className="fixed inset-0 z-30 bg-black/25 lg:hidden" onClick={() => setNavOpen(false)} />
        ) : null}
        <aside
          className={`fixed inset-y-0 left-0 z-40 flex w-[232px] shrink-0 flex-col overflow-y-auto bg-[#211D1A] px-3 py-[18px] text-[#B8B0A5] transition-transform lg:sticky lg:top-0 lg:h-screen ${navOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
        >
          <div className="flex items-center gap-2.5 border-b border-white/[0.07] px-2 pb-4">
            <div className="relative grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-[linear-gradient(135deg,#EE6C90,#B02E57)] text-sm font-extrabold text-white shadow-[0_6px_16px_rgba(205,63,107,0.35)]">
              牵
              <span className="pointer-events-none absolute -inset-[3px] rounded-[13px] border border-[#EE6C90]/45" />
            </div>
            <div>
              <div className="text-[14.5px] font-bold text-[#F5F1EA]">牵线宝</div>
              <div className="mt-px text-[10px] tracking-[0.14em] text-[#7E766B]">服务工作台</div>
            </div>
          </div>
          <nav className="mt-1">
            {NAV.map((group) => (
              <div key={group.label}>
                <p className="mx-1 mb-1.5 mt-[18px] text-[10.5px] font-bold tracking-[0.14em] text-[#6E665C]">{group.label}</p>
                <div className="flex flex-col gap-0.5">
                  {group.items.filter((item) => item.href !== "/reviews" || reviewer).map((item) => {
                    const active = item.href === "/" ? path === "/" : path === item.href || path.startsWith(`${item.href}/`);
                    return (
                      <a
                        key={item.href}
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={`relative flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-[9px] text-left text-[13px] font-medium transition duration-150 ${active ? "bg-[linear-gradient(90deg,rgba(205,63,107,0.22),rgba(205,63,107,0.08))] font-semibold text-[#FBE3EC]" : "text-[#B8B0A5] hover:bg-[#2C2723] hover:text-[#F5F1EA]"}`}
                      >
                        {active ? <span className="absolute -left-3 top-2 bottom-2 w-[3px] rounded-r-[3px] bg-primary" /> : null}
                        <NavIcon name={item.icon} active={active} />
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      </a>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
          <div className="mt-auto flex items-center gap-2.5 border-t border-white/[0.07] px-2 pt-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,#C9A15A,#A9761A)] text-xs font-bold text-white">
              {account.name.slice(0, 1)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-semibold text-[#F5F1EA]">{account.name}</div>
              <div className="truncate text-[10.5px] text-[#7E766B]">{permissionLabel}</div>
            </div>
          </div>
        </aside>
        <main className="min-w-0 flex-1 bg-background">
          <header className="sticky top-0 z-20 flex h-[60px] items-center gap-3 border-b border-border bg-[#F5F2EC]/85 px-5 backdrop-blur-[10px] sm:px-7">
            <button
              type="button"
              className="grid h-[34px] w-[34px] place-items-center rounded-[9px] bg-primary text-xs font-bold text-white lg:hidden"
              onClick={() => setNavOpen(true)}
            >
              菜单
            </button>
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="truncate text-sm font-bold">
                {title}
                {path === "/" ? <span className="font-medium text-[#8A8177]"> / 今日</span> : null}
              </span>
              <span className="hidden rounded-full border border-border bg-white px-2.5 py-1 text-[10.5px] font-bold text-muted-foreground sm:inline">履约账本</span>
              <span className="hidden text-[11.5px] text-[#8A8177] md:inline">{workspace ? formatDay(workspace.today) : "读取工作日"}</span>
            </div>
            <button
              type="button"
              className="ml-auto inline-flex h-[34px] items-center rounded-[9px] border border-[#D8CFBF] bg-white px-4 text-[12.5px] font-bold text-foreground transition duration-150 hover:border-[#8A8177]"
              onClick={() => {
                void postAction("/api/sign-out", {}).finally(() => setAccount(null));
              }}
            >
              退出
            </button>
          </header>
          <div className="mx-auto max-w-[1060px] px-7 py-[30px] pb-24">
            {phase === "loading" ? <p className="text-sm text-muted-foreground">正在进入今日。</p> : null}
            {phase === "error" ? <p className="text-sm text-destructive">工作台没有读出来。{error}</p> : null}
            {phase === "ready" && workspace ? (
              <Route
                path={path}
                memberId={memberMatch ? Number(memberMatch[1]) : null}
                meetingId={meetingMatch ? Number(meetingMatch[1]) : null}
                applicationId={reviewMatch ? Number(reviewMatch[1]) : null}
                workspace={workspace}
                account={account}
              />
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}

function NavIcon({ name, active }: { name: string; active: boolean }) {
  const props = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: `shrink-0 ${active ? "text-[#F5A8C0] opacity-100" : "opacity-75"}`,
    "aria-hidden": true,
  };
  if (name === "today") {
    return (
      <svg {...props}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 3" />
      </svg>
    );
  }
  if (name === "library") {
    return (
      <svg {...props}>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5v13z" />
        <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
      </svg>
    );
  }
  if (name === "calendar") {
    return (
      <svg {...props}>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M8 3v4M16 3v4M3 10h18" />
      </svg>
    );
  }
  if (name === "check") {
    return (
      <svg {...props}>
        <path d="M9 11l3 3 8-8" />
        <path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" />
      </svg>
    );
  }
  return (
    <svg {...props}>
      <path d="M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 7.7l5.4-.8L12 2z" />
    </svg>
  );
}

function Route(props: {
  path: string;
  memberId: number | null;
  meetingId: number | null;
  applicationId: number | null;
  workspace: Workspace;
  account: Account;
}) {
  if (props.path === "/") return <HomePage workspace={props.workspace} account={props.account} />;
  if (props.path === "/library") return <LibraryPage workspace={props.workspace} account={props.account} />;
  if (props.path === "/overdue") return <OverduePage workspace={props.workspace} account={props.account} />;
  if (props.path === "/meetings") return <MeetingsPage workspace={props.workspace} account={props.account} />;
  if (props.meetingId != null) return <MeetingDetailPage workspace={props.workspace} meetingId={props.meetingId} />;
  if (props.path === "/reviews") return <ReviewsPage workspace={props.workspace} account={props.account} />;
  if (props.applicationId != null) return <ReviewDetailPage workspace={props.workspace} account={props.account} applicationId={props.applicationId} />;
  if (props.memberId != null) return <MemberPage workspace={props.workspace} memberId={props.memberId} />;
  return <p className="text-sm text-muted-foreground">没有这一页。</p>;
}
