import { staffName, staffRoleLabel } from "./staff";
import type { ShopRoleName } from "./types";

export type ServicePersonStats = {
  personId: number;
  role: ShopRoleName;
  servedCount: number;
  activeCount: number;
  pausedCount: number;
  pendingCount: number;
  approvedCloses: number;
  rejectedCloses: number;
};

export type ServicePersonOption = {
  personId: number;
  name: string;
  role: ShopRoleName;
  roleLabel: string;
  score: number;
  tag: "最推荐" | "推荐" | null;
  closeRate: number | null;
  servedCount: number;
  activeCount: number;
  pausedCount: number;
  pendingCount: number;
  approvedCloses: number;
  statusLabel: string;
  reason: string;
};

/** 关单率、在服负荷、当前状态、通过关单业绩。分数高的更适合接手。 */
export function scoreServicePeople(rows: ServicePersonStats[]): ServicePersonOption[] {
  const ranked = rows
    .map((row) => {
      const decided = row.approvedCloses + row.rejectedCloses;
      const closeRate = decided > 0 ? row.approvedCloses / decided : null;
      const statusLabel = describeStatus(row);
      const closeScore = closeRate == null ? 60 : Math.round(closeRate * 100);
      const loadScore = row.servedCount <= 2 ? 95 : row.servedCount <= 6 ? 75 : row.servedCount <= 10 ? 55 : 35;
      const statusScore = statusLabel.startsWith("空闲") ? 90 : statusLabel.startsWith("正常") ? 80 : statusLabel.startsWith("暂停") ? 50 : 40;
      const performanceScore = Math.min(100, row.approvedCloses * 25);
      const score = Math.round(closeScore * 0.35 + loadScore * 0.25 + statusScore * 0.2 + performanceScore * 0.2);
      const rateText = closeRate == null ? "关单率暂无" : `关单率 ${Math.round(closeRate * 100)}%`;
      const advice =
        row.servedCount === 0
          ? "手头空，适合接手。"
          : row.servedCount >= 8
            ? "在服偏多，不优先。"
            : closeRate != null && closeRate >= 0.6
              ? "关单表现较好，可以优先。"
              : "负荷正常，可以指定。";
      return {
        personId: row.personId,
        name: staffName(row.personId),
        role: row.role,
        roleLabel: staffRoleLabel(row.role),
        score,
        tag: null,
        closeRate,
        servedCount: row.servedCount,
        activeCount: row.activeCount,
        pausedCount: row.pausedCount,
        pendingCount: row.pendingCount,
        approvedCloses: row.approvedCloses,
        statusLabel,
        reason: `${rateText}，服务 ${row.servedCount} 人，目前${statusLabel}，业绩 ${row.approvedCloses} 笔通过关单。${advice}`,
      };
    })
    .sort((left, right) => right.score - left.score || left.personId - right.personId);
  return ranked.map((person, index) => ({
    ...person,
    tag: recommendationTag(person, index),
  }));
}

function recommendationTag(person: ServicePersonOption, index: number): ServicePersonOption["tag"] {
  if (index === 0) return "最推荐";
  if (person.servedCount >= 8) return null;
  return "推荐";
}

function describeStatus(row: ServicePersonStats) {
  if (row.servedCount === 0) return "空闲";
  const bits = [`启用中 ${row.activeCount}`, `暂停 ${row.pausedCount}`];
  if (row.pendingCount > 0) bits.push(`待启用 ${row.pendingCount}`);
  const tone = row.pausedCount > row.activeCount ? "暂停偏多" : row.servedCount >= 8 ? "饱和" : "正常";
  return `${tone}（${bits.join("、")}）`;
}
