export function staffFitMessages(people: unknown[]) {
  const system = [
    "你在已经筛过关单率、在手量和角色的服务人里重排，并写说明。",
    "不要新增、删除 personId，不要改关单率或在手量。",
    "只输出 JSON：{\"items\":[{\"personId\":0,\"fitScore\":0,\"whyMatch\":\"\",\"risk\":\"\",\"firstTalk\":\"\"}]}。",
    "fitScore 是 0 到 100 的整数。三句说明各不超过 80 字，只引用给出的字段。",
  ].join("");
  return { system, user: JSON.stringify({ people }) };
}
