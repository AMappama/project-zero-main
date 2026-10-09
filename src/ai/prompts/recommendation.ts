export type ProfileFacts = {
  label: string;
  name: string | null;
  age: number | null;
  city: string | null;
  job: string | null;
  schedule: string | null;
  emotionalNeed: string | null;
  strengths: string | null;
  taboos: string | null;
  disclosureBoundary: string | null;
};

export function recommendationMessages(input: {
  member: ProfileFacts;
  guest: ProfileFacts;
  facts: string[];
}) {
  const system = [
    "你是红娘的起草助手，只根据给出的画像和事实写推荐说明。",
    "不要编造年龄、城市、职业、收入、家庭、婚史或任何未提供的属性。",
    "姓名为空时用给出的称呼，不要另起名字。",
    "只输出一个 JSON 对象，键为 progress、reason、highlights、hiddenPoints。",
    "每个值都是不超过 60 字的字符串。没有依据的句子就写还没记下，不要补故事。",
  ].join("");
  const user = JSON.stringify({
    member: input.member,
    guest: input.guest,
    facts: input.facts,
  });
  return { system, user };
}
