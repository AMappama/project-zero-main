import { REVIEW_TABS, type ReviewTabId } from "./reviewTabs";

export type HomeSegment = "judgement" | "exceptions" | "reviews";

export function memberHref(memberId: number) {
  return withFrom(`/members/${memberId}`);
}

export function withFrom(path: string) {
  const params = new URLSearchParams();
  params.set("from", `${window.location.pathname}${window.location.search}`);
  return `${path}${path.includes("?") ? "&" : "?"}${params.toString()}`;
}

export function returnHref(fallback: string) {
  const from = new URLSearchParams(window.location.search).get("from");
  if (from && from.startsWith("/") && !from.startsWith("//") && !from.includes("\\") && !from.includes("://")) return from;
  return fallback;
}

export function readHomeSegment(): HomeSegment {
  const value = new URLSearchParams(window.location.search).get("segment");
  if (value === "exceptions" || value === "reviews") return value;
  return "judgement";
}

export function readReviewTab(): ReviewTabId {
  const value = new URLSearchParams(window.location.search).get("review");
  if (REVIEW_TABS.some((tab) => tab.id === value)) return value as ReviewTabId;
  return "赠送";
}

export function rememberHome(segment: HomeSegment, review: ReviewTabId) {
  const params = new URLSearchParams(window.location.search);
  if (segment === "judgement") params.delete("segment");
  else params.set("segment", segment);
  if (segment === "reviews") params.set("review", review);
  else params.delete("review");
  const search = params.toString();
  window.history.replaceState(null, "", `/${search ? `?${search}` : ""}`);
}

export function rememberReviews(review: ReviewTabId) {
  const params = new URLSearchParams(window.location.search);
  if (review === "赠送") params.delete("review");
  else params.set("review", review);
  const search = params.toString();
  window.history.replaceState(null, "", `/reviews${search ? `?${search}` : ""}`);
}
