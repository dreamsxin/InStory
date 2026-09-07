# InStory 项目进度

> 给下一次接手的人：先读「当前现状」和「工程约定」，再看「下一步」。
> 历史逐条记录压在最后，只作为溯源用，不要当成现状。

## 当前现状（2026-09-07）

纯文本互动叙事闭环已经跑通，并被测试固定住：注册登录、探索书架、进入故事、流式阅读、入戏行动、存档回溯、配额、内容审核、创作控制台、管理控制台都在工作。

命令（Windows PowerShell 下逐条执行，不要用 `&&`）：

```powershell
npm install
npm run typecheck          # 全 workspace + e2e 的 tsc
npm run test               # 各 workspace 的 vitest
npm run test:e2e           # 会先重置 e2e 数据库，再拉起独立的 4000/3000
npm run dev:server         # API  http://localhost:4000
npm run dev:web            # Web  http://localhost:3000
npm run verify:llm         # 用当前 Provider 跑一次最小生成并校验 schema
```

最近一次全量结果：typecheck 通过；单测 server 155 / story-engine 12 / web 20；e2e 30 条通过。

## 已实现

- **账号与权限**：邮箱注册登录、httpOnly Cookie 会话、`role` 为 `reader` / `admin`；`ADMIN_EMAILS` 注册即生效，已有账号下次登录时提权；`PUT /api/admin/users/:userId/role` 可发角色。`/admin` 按角色拦截。
- **阅读运行时**：`POST /api/sessions/:id/turns` 与 SSE 版 `/turns/stream`（逐字上屏、可中断）、存档时间线、`rewind` 分支、`reset` 重开、`DELETE /api/sessions/:id`、按窗口分页读取回合（`?turnLimit`、`/turns?before=`）、每日配额随会话读取一起返回。
- **介入节点（§5.3）**：每回合带 `intervention`（六种 `kind` + 一句提示），存在 `session_turns.intervention`；模型不标时服务端按这一段真实改变的状态兜一个（`deriveIntervention`，只对 `read_continue` 生效）。
- **创作**：故事四段表单、故事内演员重设（故事身份 / 与读者关系 / 秘密 / 当前目标 / 性格 / 禁止项）、剧情锚点整组替换、试玩区分「回到上次试玩」与「从开场重新试玩」、五套阅读装帧主题。
- **反馈与社会证明**：`GET /api/me/story-insights`（作者看自己的故事被读到什么程度）与 `GET /api/stories/insights`（公开书架上的读者数与最深回合），共用同一份聚合。
- **管理台**：运行状态、模型配置与 Provider 验证、用量、审核队列（解决 / 忽略）、故事配置、会话审计。
- **AI 编排**：`MockNarrativeProvider` 与 `OpenAICompatibleProvider`（超时、分类重试退避、流式 narration 增量提取、输出 Zod 校验）。

## 代码地图

- `apps/server/src/app.ts`：所有路由都在这一个 `buildApp` 里，没有 routes/ 分层。找接口直接搜 `app.get("/api/`。
- `apps/server/src/db/`：`migrations.ts`（唯一的 schema 事实来源，append-only）、各 `*-store.ts` 直接写 SQL，没有 ORM。
- `apps/server/src/model-runtime.ts`：Provider 的装配与 `verify`；`moderation/checker.ts` 是输入输出审核，`security/rate-limiter.ts` 是限流。
- `packages/ai-orchestrator/src/`：`factory.ts` 选 Provider，`mock-provider.ts` / `openai-compatible-provider.ts` 是两种实现（超时与重试退避在后者里），`narration-stream.ts` 从流式 JSON 里抽 narration 增量。
- `packages/shared/src/story.ts` + `schemas.ts`：前后端唯一契约。改字段从这里开始。
- `packages/story-engine/src/state.ts`：`applyStateDelta`、`shouldCreateTimelineNode`、`deriveIntervention`，纯函数，好测。
- `apps/web/src/components/home-workspace.tsx`：首页三个 Tab 与整个创作控制台，是最大的一个客户端文件。
- `apps/web/src/components/reader-client.tsx`：阅读器全部交互。
- `apps/web/src/lib/api.ts`：所有服务端调用；`app/actions.ts` 是表单用的 server actions。
- `e2e/`：Playwright，`reset-database.ts` 在每次 `test:e2e` 前重置数据库。

## 数据库迁移

`apps/server/src/db/migrations.ts` 是 append-only 的：已经应用过的条目一律不改，只追加下一个 id。每次启动都会跑 `runMigrations`。

1. `initial_schema` — stories / worlds / characters / story_anchors / reader_sessions / reader_profiles / model_config
2. `session_and_story_lookup_indexes`
3. `normalize_session_turns_and_timeline` — 把回合与时间线从 `reader_sessions.payload` 拆成独立表
4. `add_users_and_auth_sessions` — 并把历史的 `local-reader` 落成一个真实账号
5. `attach_reader_sessions_to_users`
6. `add_generation_usage` — 每次生成一行，配额与成本都从这里算
7. `add_moderation_events` — 审核队列与审计是同一张表
8. `add_turn_intervention` — 回合上的关键节点
9. `snapshot_story_title_on_sessions` — 会话自己记住故事名，故事删了卡片还能叫出名字

## 工程约定（动手前先读）

这些不是风格偏好，是踩过的坑换来的：

- **不编兜底值。** 缺数据就说缺，不要猜一个看起来合理的。曾经「继续」卡片在故事缺失时兜底显示题材「故事」、篇幅「标准」，结果是界面在说谎；现在故事没了就给墓碑卡片。
- **越权一律 404，不是 403。** 私有故事不该确认「这个 ID 存在」。见 `canReadStory`。
- **聚合按每个故事各自的作者排除。** 「读者数」的意思是别人读过，不是作者打开过自己的草稿；公开书架混着不同作者，所以排除是逐故事的。
- **快照和实时要分清。** `ReaderRole`（进故事时的身份）、故事内 `Character`（从角色库复制）、`reader_sessions.story_title` 都是快照，不能改成实时查询；`StorySummary` 是实时配置，卡片上的题材篇幅必须现取。
- **模型输出不可信但也别一票否决。** `narrativeResultSchema` 里 `intervention` 用 `.catch(null)`：模型写错一个字段不该让读者损失一整段正文和一次配额。
- **`apps/web` 只能从 `@instory/shared` 做 type import。** 值导入会踩到 shared 包内部 `./x.js` 说明符解析失败；需要常量就在 `apps/web/src/lib/` 里放一份（见 `reading-themes.ts`）。
- **`"use server"` 文件只能导出 async function。** 共享的 `IDLE_FORM` 之类必须放在 `lib/form-result.ts`。
- **表单失败要把用户输入还回去。** server action 失败后 React 会重挂表单，`values` + `defaultValue`（新建）或 `kept()`（编辑）是唯一能保住稿子的办法。
- **破坏性操作先问一次**：删故事、删角色、删进度、重置会话、恢复存档。
- **加一个字段的顺序**：`packages/shared`（类型 + zod）→ 需要落库就加迁移 → `*-store.ts` 读写与归一化 → `app.ts` 路由 → `apps/web/src/lib/api.ts` → 界面 → 服务端单测 + e2e → 文档。

## 本机排错

- **跑 e2e 前必须先停掉 dev server。** `playwright.config.ts` 里 `reuseExistingServer: false`，否则 4000 端口冲突直接报 `already used`；这个设置是故意的，避免 e2e 跑在开发数据库上把测试账号写进去。
- **PowerShell 不支持 `&&`**，命令要分开发；提交信息用 `git commit -F .git/COMMIT_MSG_TMP.txt`，避免引号和 `<>` 破坏解析。
- **`apps/web/next-env.d.ts` 会来回抖动**（dev 与 build 写的路径不同），提交前 `git checkout -- apps/web/next-env.d.ts`。
- **e2e 单跑某个 spec 会 409**：`npm run test:e2e` 才会重置数据库，直接 `npx playwright test xxx.spec.ts` 会撞上上一轮留下的账号。
- 真实模型：`.env` 里把 `LLM_PROVIDER` 换成 `openai-compatible` 并配 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`，或在 `/admin` 里存一份（API Key 只落服务端，不回显）。

## 下一步（按我判断的优先级）

1. **阅读预期**：卡片仍然不说这故事大概能读多久。锚点数量 + `defaultSegmentLength` 已经够给一个诚实的区间，比让读者盲开一个故事强。
2. **`SessionSegment` 缓存与作者预设优先**：现在每次推进都实打实调模型。按 `ARCHITECTURE.md` §3.2 的三级优先级（预设 → 已生成 → 现生成）做，才对得起 `scripted` 这个模式名。
3. **阅读设置**：字号、行距、深浅、滚动偏好。目前装帧是作者定的，读者一点都调不了。
4. **首屏与空态**：新部署只有一个种子故事时书架很空，首页也不解释自己是什么。
5. **按故事的成本视图**：`generation_usage` 里数据都有，管理台只给了总量，看不出是哪个故事在烧钱。
6. **`路线分歧` 与 `NPC 发问` 两种节点**只能由模型识别（状态里读不出来），这是能力边界，不是遗漏；要做只能加一次轻量的判定调用。

## 已知问题

- `npm audit` 有 2 个 moderate，来自 `next` 依赖的 `postcss`；`--force` 会降级到破坏性版本，暂不处理。
- 故事、世界、演员、锚点仍以 JSON payload 存在各自表里，没有完全关系化。`story_anchors` 是整组替换，够用。
- `node:sqlite` 在 Node 24 下会打实验性 API 提示。
- 默认 Mock Provider；真实模型的输出质量只能靠 `verify:llm` 和手动阅读判断，没有自动评测。

## 历史记录

2026-05-20 到 2026-09-07 之间的逐条记录（monorepo 搭建、SQLite 迁移、账号体系、流式生成、配额、审核、装帧主题、锚点与演员编辑、可见性收口、墓碑卡片、阅读社会证明）都在 git 历史里，`git log --oneline` 一眼能看完，每条 commit 的正文都写了「为什么这么改」。本文档不再重复维护那份清单——它曾经长到 116 行，而且和现状开始互相矛盾，那比没有更糟。


