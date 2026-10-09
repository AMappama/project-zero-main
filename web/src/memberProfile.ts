export type MemberProfile = {
  name: string;
  avatar?: string;
};

/** 演示会员的显示名。有 avatar 才出照片，没有就用姓名缩写。 */
const PROFILES: Record<number, MemberProfile> = {
  101: { name: "周晚宁", avatar: "/avatars/avatar-zhou-wanning.jpg" },
  103: { name: "许知夏", avatar: "/avatars/avatar-xu-zhixia.jpg" },
  105: { name: "林澄", avatar: "/avatars/avatar-lin-cheng.jpg" },
  106: { name: "赵清和" },
  108: { name: "苏念", avatar: "/avatars/avatar-su-nian.jpg" },
  110: { name: "何予白" },
  112: { name: "陈见鹿", avatar: "/avatars/avatar-chen-jianlu.jpg" },
  114: { name: "沈星河", avatar: "/avatars/avatar-shen-xinghe.jpg" },
  113: { name: "江晚" },
  115: { name: "顾南枝" },
  116: { name: "叶知意" },
  117: { name: "唐小满" },
};

const SURNAMES = ["周", "许", "林", "赵", "苏", "何", "陈", "江", "沈", "顾", "叶", "唐"];
const GIVEN = ["晚宁", "知夏", "澄", "清和", "念", "予白", "见鹿", "晚", "星河", "南枝", "知意", "小满"];

export function memberProfile(memberId: number): MemberProfile {
  return PROFILES[memberId] ?? { name: `${SURNAMES[memberId % SURNAMES.length]}${GIVEN[memberId % GIVEN.length]}` };
}

/** 两字及以内用全名，更长的名字用名字后两字。 */
export function nameAbbr(name: string) {
  const chars = Array.from(name.replace(/\s/g, ""));
  if (chars.length <= 2) return chars.join("");
  return chars.slice(-2).join("");
}
