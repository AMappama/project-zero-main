# 牵线宝体验与 AI：代码修改计划

依据：`docs/experience-and-ai-plan.md`（与 GitHub `origin/main` 上已提交的同一文件一致，提交 `54fd4c7`）。本计划只排修改顺序和验收，不改领域写入。

## 不改什么

- `src/fulfillment.ts` 的写入语义保持不动。一笔订单一条服务实例，身份由实例算出，页面不提供身份编辑。
- AI 不直接写库。推荐文案、匹配说明都先出预览，红娘点「用这段」或「全部采用」之后才调用现有动作接口。
- 已写入的字段不覆盖。只有空白，或理由仍等于 `STUB_REASON`（「同在服务库，尚未推荐」）时才允许填入。
- 关单撤销、AI 代点提交、关单建议自动起草、到期函模板发送，都不在本轮。
- 课次、已用次数、扣已用，不进入模型和页面。

## 开工前

先跑 `npm test` 和 `npm run check`。

`test/home.test.ts` 仍在调用不存在的 `createFulfillment(new Database(":memory:"))`，和现在的 `fresh()` 异步库不一致。`test/fulfillment.test.ts`、`test/http.test.ts` 已改用 `fresh()`。修测试是 AI 工作的回归网，放在接模型之前。`AI_ENABLED` 默认 `0`，现有测试不得因此去访问外网。

## 阶段顺序

顺序固定：修测试 → P0 通道 → P0.5 画像 → P1 推荐文案 → P2 服务人匹配。P3 只改呈现，可以和 P0、P1 并行，但不能提前做依赖画像的生成。

### P0 模型通道

新增 `src/ai/`，履约写入零改动。

| 文件 | 做什么 |
| --- | --- |
| `src/ai/provider.ts` | OpenAI 兼容的 `chat/completions`。主模型 DeepSeek，失败再试 GLM-4-Flash。超时、有限次重试、JSON 解析失败都返回空结果，不抛到页面。 |
| `src/ai/prompts/` | 只放提示词。业务规则留在现有函数里。 |
| `src/ai/cache.ts` | Redis。键是提示词和上下文的 sha256，TTL 24 小时。 |
| `src/ai/audit.ts` | 表 `ai_invocations` 只记调用方、用途、模型、耗时、token、上下文哈希。不记完整提示词，不记密钥。 |
| `.env.example` | `AI_ENABLED`、`AI_BASE_URL`、`AI_API_KEY`、`AI_MODEL`、`AI_FALLBACK_*`。真密钥只进本地 `.env`，`.env` 继续被 git 忽略。 |

加 `npm run ai:probe`：打一发最小请求，打印模型名和耗时。`AI_ENABLED=0` 时探针直接说明未开启，测试套件不调用它。

验收：断网或密钥错误时，工作台仍能打开，文案退回本地四套话术。

### P0.5 会员画像

`members` 现在只有 `id`、`tenant_id`、`shop_id`、`maturity`、`member_type`、`created_at`，触发器禁止页面改身份。画像不塞进这张表。

新增 `member_profiles`，与 `members.id` 一对一：

- 姓名、年龄、城市、职业、作息、情感需求、优点、禁忌、可对嘉宾说的边界
- 来源：`manual` 或 `sync`，加上更新时间

先做红娘手填表单。同步成交域的钩子只留接口，不在本轮接外部库。种子数据只填文档和现有演示会员里已经出现的事实，缺的留空，不编造。

`web/src/memberProfile.ts` 里按会员编号写死的姓名，改为读这张表；读不到时用「会员 {id}」，不用虚构履历。

没有这张表，P1 不允许开始。若画像收集被卡住，先做 P2，文案继续用本地模板。

### P1 推荐文案

入口：`POST /api/actions/suggest-recommendation-copy`。

请求带会员、嘉宾、订单、见面、当前四个字段。服务端用画像和 `HomeItem.facts` 组上下文，调用 `src/ai/prompts/recommendation.ts`。返回 JSON：`progress`、`reason`、`highlights`、`hiddenPoints`，每段不超过 60 字。解析失败就当这次没调通。

`web/src/draftCopy.ts` 的 `seed % 4` 保留为静默降级，不再当主路径。

`web/src/actions.tsx` 的推荐草稿：

- 四个输入框上方单独一块「AI 草稿」，不往输入框里流式灌字。
- 「用这段」只填 `isUnwritten` 为真的字段；「全部采用」同样跳过已写内容。
- 失败文案固定为「这次没调通，已用本地写法」。
- 温度 0.7；「换一版」用 0.9，并绕过这一条的缓存。

验收（文档原定，上线前抽 20 条盲看）：

- 合法 JSON 比例 100%
- 编造成员属性 0 条
- 红娘认为好于四套模板的比例 ≥ 70%
- 采用后还要手改的比例 ≤ 30%

编造是发布阻断项。出现编造就关 `AI_ENABLED`，只留模板。

### P2 服务人匹配

硬条件继续留在 `src/staffScore.ts` 的 `scoreServicePeople()`：关单率、在手量、角色。`src/fulfillment.ts` 第 846 行附近已经同步返回这组成绩，这条路径保持同步、保持无模型。

模型只在硬条件筛完之后重排，并补四句说明：`fitScore`、`whyMatch`、`risk`、`firstTalk`。温度 0.2。

建议接口：`POST /api/suggest-staff-fit`。`GET /api/service-people` 仍立刻返回规则分。页面先画出规则顺序，说明在 3–5 秒内补上；超时就只留规则分，并标明「匹配说明未生成」。

`AI_ENABLED=0` 时接口行为与现在一致，不增加等待。

### P3 工作台呈现

只改展示和文案，不改 `HomeKind`，不新增关单撤销。

后端：`src/home.ts` 的 `HomeItem` 增加可选 `summary`（一句人话）和 `todayFacts`（今天相对截止日期、见面时间的短句）。`emptyCopy()` 改为「现在没有要处理的，去会员库看看谁该回访」，并带一个去会员库的动作。

前端：`web/src/pages/HomePage.tsx`

- 判断、例外、审核按紧急程度收成四组：要紧、要回应、要点头、待安排。筛选项和写操作沿用现在的动作。
- 卡上主按钮是唯一实心按钮，危险操作保持红字链接。
- 成就条只统计已发生的见面、申请、小记，不造数。
- `MemberAvatar` 的 `alt=""` 改为会员姓名。

样式集中在 `web/src/index.css`：纸色底 `#FAF7F2`，墨色字 `#2A2622`，关心 `#E8735A`，完成 `#D99A2B`，警告 `#D9A441`。标题用衬线，正文保持无衬线。快捷键 `j` / `k` 移动，`Enter` 进当前卡的主动作。

### P4 以后再做

`careSignals()` 已能看出久未回访、久未见面、约了又取消。把它变成低打扰回访草稿，仍然要人确认才写入。本轮不排期。

## 建议的提交切分

每一段都可以单独撤回。

1. 修好 `test/home.test.ts`，测试与类型检查通过。
2. `src/ai/`、审计表、`.env.example`、探针。默认关闭。
3. `member_profiles` 与手填表单。
4. 推荐文案预览，模板降级仍在。
5. 服务人说明异步补全，规则分不变。
6. 首页分组、摘要、空状态、头像替代文本、配色。

## 风险

- 画像没收齐时，文案会编。P1 以画像为门槛。
- 匹配说明若堵在首屏，工作台会变慢。规则分必须先返回。
- 日志里出现密钥或完整提示词，就停用审计写入并清掉该字段。
- 回滚开关是 `AI_ENABLED=0`。关掉之后页面、测试、规则分都按现在的本地行为运行。
