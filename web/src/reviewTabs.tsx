import type { HomeItem } from "./api";

export const REVIEW_TABS = [
  { id: "赠送", label: "赠送" },
  { id: "暂停", label: "暂停" },
  { id: "关单一审", label: "关单一审" },
  { id: "关单二审", label: "关单二审" },
] as const;

export type ReviewTabId = (typeof REVIEW_TABS)[number]["id"];

export function reviewTabOf(item: HomeItem): ReviewTabId | null {
  if (item.kind === "赠送") return "赠送";
  if (item.kind === "暂停") return "暂停";
  if (item.kind === "关单" && item.level === "一审") return "关单一审";
  if (item.kind === "关单" && item.level === "二审") return "关单二审";
  return null;
}

export function reviewsForTab(items: HomeItem[], tab: ReviewTabId) {
  return items.filter((item) => reviewTabOf(item) === tab);
}

export function ReviewSubTabs(props: { items: HomeItem[]; value: ReviewTabId; onChange: (tab: ReviewTabId) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl bg-muted p-1" role="tablist" aria-label="审核分档">
      {REVIEW_TABS.map((tab) => {
        const count = reviewsForTab(props.items, tab.id).length;
        const active = props.value === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => props.onChange(tab.id)}
            className={`whitespace-nowrap rounded-lg px-4 py-2.5 text-xs font-semibold transition ${active ? "bg-white text-foreground shadow-[0_2px_8px_rgba(35,32,25,0.07)]" : "text-muted-foreground hover:text-foreground"}`}
          >
            {tab.label}
            <span className="ml-1.5 opacity-60">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
