import { getJson, type MemberProfileRecord } from "./api";

export type MemberProfile = {
  name: string;
  avatar?: string;
  /** 画像还没接上时的兜底名，头像不显示数字缩写。 */
  placeholder?: boolean;
};

/** 已有的演示头像。没有文件的会员不补照片。 */
const AVATARS: Record<number, string> = {
  101: "/avatars/avatar-zhou-wanning.jpg",
  103: "/avatars/avatar-xu-zhixia.jpg",
  105: "/avatars/avatar-lin-cheng.jpg",
  108: "/avatars/avatar-su-nian.jpg",
  112: "/avatars/avatar-chen-jianlu.jpg",
  114: "/avatars/avatar-shen-xinghe.jpg",
};

const names = new Map<number, string>();

export async function loadMemberProfiles() {
  const rows = await getJson<MemberProfileRecord[]>("/api/member-profiles");
  names.clear();
  for (const row of rows) {
    const name = row.name?.trim();
    if (name) names.set(row.memberId, name);
  }
}

export function memberProfile(memberId: number): MemberProfile {
  const name = names.get(memberId);
  if (name) return { name, avatar: AVATARS[memberId] };
  return { name: `会员 ${memberId}`, placeholder: true };
}

/** 两字及以内用全名，更长的名字用名字后两字。兜底的系统名不拆成数字。 */
export function nameAbbr(name: string) {
  if (/^会员\s*\d+$/.test(name)) return "?";
  const chars = Array.from(name.replace(/\s/g, ""));
  if (chars.length <= 2) return chars.join("");
  return chars.slice(-2).join("");
}
