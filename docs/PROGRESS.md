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
npm run test:e2e           # 会先重置 e2e 数据库，再拉起独立的 4100/3100
npm run dev:server         # API  http://localhost:4000
npm run dev:web            # Web  http://localhost:3000
npm run verify:llm         # 用当前 Provider 跑一次最小生成并校验 schema
```

最近一次全量结果：typecheck 通过；单测 server 170 / story-engine 12 / web 35；e2e 33 条通过。

## 已实现

- **账号与权限**：邮箱注册登录、httpOnly Cookie 会话、`role` 为 `reader` / `admin`；`ADMIN_EMAILS` 注册即生效，已有账号下次登录时提权；`PUT /api/admin/users/:userId/role` 可发角色。`/admin` 按角色拦截。
- **阅读运行时**：`POST /api/sessions/:id/turns` 与 SSE 版 `/turns/stream`（逐字上屏、可中断）、存档时间线、`rewind` 分支、`reset` 重开、`DELETE /api/sessions/:id`、按窗口分页读取回合（`?turnLimit`、`/turns?before=`）、每日配额随会话读取一起返回。
- **介入节点（§5.3）**：每回合带 `intervention`（六种 `kind` + 一句提示），存在 `session_turns.intervention`；模型不标时服务端按这一段真实改变的状态兜一个（`deriveIntervention`，只对 `read_continue` 生效）。
- **创作**：故事四段表单、故事内演员重设（故事身份 / 与读者关系 / 秘密 / 当前目标 / 性格 / 禁止项）、剧情锚点整组替换、试玩区分「回到上次试玩」与「从开场重新试玩」、五套阅读装帧主题。
- **阅读版式**：阅读器工具坞的 `版式` 面板让读者自己选字号、行距、行宽，存在本机 `localStorage`（`lib/reading-prefs.ts`），通过 `--reader-*` 自定义属性作用在正文上；装帧仍由作者定，版式归读者。
- **首屏与空态**：首页顶部那张卡说清这是什么（一句「翻开下一章，主角就是你」＋怎么玩＋每天 20 次），窄屏上对没有阅读进度的人保留显示；`探索故事` 一个公开故事都没有时给空态并指向 `创作`，不再是标题下一片空白。
- **反馈与社会证明**：`GET /api/me/story-insights`（作者看自己的故事被读到什么程度）与 `GET /api/stories/insights`（公开书架上的读者数与最深回合），共用同一份聚合。
- **读者视图与作者视图分开**：`GET /api/stories/:id` 只对故事作者返回完整 `StoryDetail`；其他人拿 `PublicStoryDetail`——世界设定 + 演员姓名与故事身份，没有 `secret`/`goals`/`constraints`，锚点整块不返回（不是空数组）。见 `toPublicStoryDetail`。
- **中断真的中断**：读者点 `停止生成` 时，流式路由发现连接已断就不记成功用量、不落库，同时 Provider 会 `cancel()` 上游响应体，模型不再往一条没人读的流里生成。这一次仍记一条 `error` 用量——模型被调用过，钱花了，管理台不该看不见。
- **表单失败说得出原因**：重复的故事 ID 会得到「故事 ID「x」已经被占用，换一个再试。」（`DuplicateStoryIdError` → 409 带 `field`），字段校验失败会列出出错的字段名（`readFormError` 把 Zod 的 `issues` 路径翻成表单里的中文标签）。故事 ID 的规则写在标签里。此前这些原因都被 `lib/api.ts` 丢掉，只剩一句「创建故事失败」。
- **一次动作只调一次模型**：流式失败分两种。流还没开起来（Provider 不支持流式、传输层拒绝）才回落到非流式端点；流已经开了再失败（模型报错、审核拦下、连接中断）一律直接报给读者——那次生成已经花掉了，回落只会再花一次生成和一次突发额度。见 `StreamedTurnError`。
- **管理台**：运行状态、模型配置与 Provider 验证、用量、审核队列（解决 / 忽略）、故事配置、会话审计、账号列表与角色发放（`GET /api/admin/users` + 每行一个「设为管理员 / 收回管理员」，当前登录的账号不给自己降权）。
- **看得见自己是谁，也退得出去**：账号栏在昵称下面写出邮箱（读者也一样），管理控制台顶栏也有同一条账号栏——此前控制台既不说你是谁，也没有退出入口，只能先回客户端。
- **开发用的匿名兜底不再冒充身份**：非 production 下 `allowLegacyAnonymousUser` 会把无会话的调用当作种子读者，方便本地调 owner 路由；但 `GET /api/auth/me` 现在对这种兜底回 401。此前它照实返回种子读者，于是 `/login` 认为你已登录、把你弹回首页——`退出登录` 看起来完全失效，而且任何匿名访客都会看到「本地读者」的工作台。见 `authUserIsFallback`。
- **配额说得出什么时候恢复**：`TurnQuota` 多一个 `resetsAt`（下一个 UTC 零点的绝对时刻，`usageDayResetsAt()`），阅读器把它按浏览器时区渲染——配额用完时直接写在标签里，平时挂在 `title` 上。此前只说「请明天再来」，而配额按 UTC 日切，东八区的「明天」其实是当天早上 8 点。管理台的用量说明也写清了这一点。同时 `DAILY_TURN_QUOTA` 填成非数字不再变成 `NaN`（那会让配额检查永不拒绝，是最不容易被发现的一种失效），落回默认值 20。
- **书架有了秩序**：`探索故事` 上方多了搜索（标题 / 钩子 / 类型）、类型筛选和排序（最近有人读 / 读者最多 / 按标题），默认按最近有人读——读者数和 `lastReadAt` 早就算出来印在卡片上了，却一直没当排序键用。筛不到结果时给的是「没有符合条件的故事」＋`清空筛选`，不是「这里还没有公开的故事」＋去创作：后者对只是打错关键词的人来说是句假话。都在客户端做（`StoriesView`，数据本来就整份传给了客户端组件）。
- **卡片说得出这故事有多长**：`GET /api/stories` 现在每条带 `plannedBeats`（作者标了「必经」或「可作为结局」的锚点条数）和 `segmentTargetWords`（那档篇幅真正写进提示词的字数，`SEGMENT_LENGTH_GUIDES` 是唯一来源），卡片上写成「主线 3 个节点 · 每段约 1200 字 · 约 9 分钟起」。是「起」而不是估算总量：一个节点读者可能来回几段，所以这是下限。没有预设节点的故事不编数字，直说长度由读者和 AI 一起决定。给的是计数和字数，锚点标题与说明仍然只在作者视图里——那是大纲，等于结局。
- **装完就有东西可读，也有人可登**：服务端启动时按需补一份示例数据（`data/demo-bootstrap.ts`）——三个账号 `admin@instory.local` / `author@instory.local` / `reader@instory.local`（密码 `instory-demo-2026`，`DEMO_PASSWORD` 可覆盖），示例作者名下两个公开故事「月下市集」（3 个主线节点）与「虚空邮差」（没有节点，正好覆盖长度未知那一种卡片），示例读者带一个入戏角色。逐项判重：邮箱或故事 ID 已存在就原样保留，绝不改动已注册账号的密码和角色——那会是后门，不是便利。`SEED_DEMO_DATA` 非生产默认开、生产默认关；生产显式打开时必须给 `DEMO_PASSWORD`，否则拒绝启动。e2e 显式关掉它（否则书架上的卡片数会变）。
- **看得出是哪个故事在烧钱**：`GET /api/admin/usage` 多一个 `byStory`（`summarizeStoriesForDay`，按 token 降序），管理台在「今日生成用量」下面多一张「按故事」表：故事名、读者数、成功/失败、Token、预估成本。故事名在服务端解析——ID 不是运维认得的东西；故事已删除就显示「ID（已删除）」，钱花过就该留在账上。没有 storyId 的行归到「未关联故事」而不是丢掉：同屏的总量包含它们，两个数字对不上比一行难看的记录更糟。
- **试玩不再假装是阅读**：`ReaderSessionListItem` 多一个 `isAuthorTrial`（服务端用和 insights 相同的那次比较：会话所属故事的 `ownerId` 是不是当前查看者），`继续` 列表里作者自己的试玩带一枚「试玩」标签，悬停写明「试玩同样计入今日配额」。此前同一个会话在 insights 里被当作者试玩排除、在 `继续` 里却显示成普通阅读，两处口径相反。配额照扣是有意的：那几次生成真花了钱，而且不扣就等于给「建个故事无限生成」开了一条路——要修的是界面在说谎，不是把账免掉。
- **审核队列能真的下架故事**：`POST /api/admin/moderation/events/:id/takedown` 把被举报的故事设为仅自己可见，同时把事件标为已处置，处置说明记成「已下架《标题》：…」。此前队列只能改自己那一行的颜色——运维判定越线后，还得记住故事 ID、去 `故事配置` 手动翻 `可见性`，唯一真正保护读者的那一步恰好是队列不做的。是隐藏不是删除：作者的内容仍归作者，已经进去的读者会话照样能读（测试里断言了这条）。事件不带 `storyId` 时返回 400 并保持 open——没有可下架的对象，就不该假装做了决定。
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
- **兜底身份不是身份。** 非 production 的匿名兜底只用来让 owner 路由在本地能跑；任何回答"我是谁"的地方（`/api/auth/me`、登录态判断）必须把它当成未登录，否则 `/login` 会把匿名访客弹回首页、`退出登录` 变成无效按钮。这类问题 e2e 抓不到——e2e 的 API 跑在 production 模式，兜底本来就关着。
- **越权一律 404，不是 403。** 私有故事不该确认「这个 ID 存在」。见 `canReadStory`。
- **读者视图和作者视图是两种东西。** 作者写给模型的内容（演员的 `secret`/`goals`/`constraints`、剧情锚点）不能出现在非作者拿到的响应里；新增字段时先问一句"这是给读者看的还是给模型看的"。见 `toPublicStoryDetail`。裁掉的字段整块不返回，不要返回空值——空数组会变成"这故事没有锚点"这句假话。
- **聚合按每个故事各自的作者排除。** 「读者数」的意思是别人读过，不是作者打开过自己的草稿；公开书架混着不同作者，所以排除是逐故事的。
- **快照和实时要分清。** `ReaderRole`（进故事时的身份）、故事内 `Character`（从角色库复制）、`reader_sessions.story_title` 都是快照，不能改成实时查询；`StorySummary` 是实时配置，卡片上的题材篇幅必须现取。
- **模型输出不可信但也别一票否决。** `narrativeResultSchema` 里 `intervention` 用 `.catch(null)`：模型写错一个字段不该让读者损失一整段正文和一次配额。
- **`apps/web` 只能从 `@instory/shared` 做 type import。** 值导入会踩到 shared 包内部 `./x.js` 说明符解析失败；需要常量就在 `apps/web/src/lib/` 里放一份（见 `reading-themes.ts`）。
- **`"use server"` 文件只能导出 async function。** 共享的 `IDLE_FORM` 之类必须放在 `lib/form-result.ts`。
- **表单失败要把用户输入还回去。** server action 失败后 React 会重挂表单，`values` + `defaultValue`（新建）或 `kept()`（编辑）是唯一能保住稿子的办法。
- **破坏性操作先问一次**：删故事、删角色、删进度、重置会话、恢复存档。
- **往 `styles.css` 加规则先看清缩进。** 文件末尾大半是媒体查询，块内规则缩进两格。曾经把 `.intervention-cue` 整段插进窄屏查询里，还夹断了一条选择器列表，结果桌面端没有样式、手机端给正文套上了 `display: grid`。新规则要么放在全局段落里，要么确认自己在哪个 `@media` 内。
- **加一个字段的顺序**：`packages/shared`（类型 + zod）→ 需要落库就加迁移 → `*-store.ts` 读写与归一化 → `app.ts` 路由 → `apps/web/src/lib/api.ts` → 界面 → 服务端单测 + e2e → 文档。

## 本机排错

- **e2e 有自己的端口和数据库。** API 4100 / Web 3100 / `data/e2e.sqlite`，dev server 可以一直开着。以前共用 4000/3000，代价有两个：跑之前得先杀掉开发服务器（而且杀掉后台任务并不会杀掉 `tsx watch` / `next dev` 的子进程，只能按端口 `Get-NetTCPConnection` → `Stop-Process`），以及浏览器里开着的 localhost:3000 会在那段时间里悄悄显示测试数据库——测试故事出现又消失，看起来和"数据被清空"一模一样。`reuseExistingServer: false` 仍然保留：这两个端口是 e2e 自己的，上面还在监听的只可能是上一轮没退干净的进程。另外换端口不够——Next 一个构建目录只允许一个 dev server，所以 e2e 还带 `NEXT_DIST_DIR=.next-e2e`（`next.config.ts` 读它）。
- **PowerShell 不支持 `&&`**，命令要分开发；提交信息用 `git commit -F .git/COMMIT_MSG_TMP.txt`，避免引号和 `<>` 破坏解析。
- **`apps/web/next-env.d.ts` 会来回抖动**（dev 与 build 写的路径不同），提交前 `git checkout -- apps/web/next-env.d.ts`。
- **`.env` 只有服务端读，而且是通过启动参数读的。** `apps/server` 的 dev/start 脚本带 `--env-file-if-exists=../../.env`；在此之前根目录 `.env` 根本没人读，README 让人复制的那份文件一直是摆设，所有变量只有导出到 shell 里才生效。已导出的环境变量优先级高于文件，所以 e2e 显式传的配置不会被开发用的 `.env` 覆盖。Web 侧的变量要放 `apps/web/.env`——Next 只读自己目录。
- **e2e 单跑某个 spec 会 409**：`npm run test:e2e` 才会重置数据库，直接 `npx playwright test xxx.spec.ts` 会撞上上一轮留下的账号。
- 真实模型：`.env` 里把 `LLM_PROVIDER` 换成 `openai-compatible` 并配 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`，或在 `/admin` 里存一份（API Key 只落服务端，不回显）。

## 下一步（按我判断的优先级）

这一批第一条来自 2026-09-08 站在各类用户角度做的一次审计，都是"界面在说谎"或"用户为不是自己的错付费"这一类，优先于新功能：

1. **书架的服务端查询**：搜索、筛选、排序现在都在客户端做，前提是整份公开列表随首屏一起下发。故事多起来（一两百条以上）就得把这些下沉到 `GET /api/stories` 的 query 参数并分页，同时 `GET /api/stories/insights` 要跟着同一组条件走——现在两个接口各自算一遍公开故事集合。
2. **`SessionSegment` 缓存与作者预设优先**：现在每次推进都实打实调模型。`ARCHITECTURE.md` 那条三级优先级（预设 → 已生成 → 现生成）的第一级今天根本没有数据支撑——作者能写的只有锚点（一句约束），没有任何地方能写预设正文，也没有表存它。要做就是完整一块：迁移加 `story_segments`、作者端加一套小节编辑、再定义"什么情况算命中预设"（按锚点顺序？按状态条件？），以及 `scripted` 下缺预设时 AI 只补桥段的提示词约束。半做比不做更糟：读者会拿到一段既不是作者写的、也不受锚点约束的正文。
3. **`路线分歧` 与 `NPC 发问` 两种节点**只能由模型识别（状态里读不出来），这是能力边界，不是遗漏；要做只能加一次轻量的判定调用。

## 已知问题

- 非 production 且未设 `ADMIN_TOKEN` 时 `/api/admin` 对所有人开放（`main.ts` 只在 production 下强制），而默认 `HOST=0.0.0.0`。
- 作者试玩消耗作者自己的每日配额，这是有意的（生成真花钱，免掉就成了无限生成的路子），`继续` 列表已经标出「试玩」；但试玩仍然写进 `generation_usage` 的常规行里，管理台分不出「作者在调自己的故事」和「读者在读」。
- 审核队列现在能下架故事（设为仅自己可见并记账），但仍不能处置用户：admin 不能封禁账号、不能吊销登录会话，也不能删除他人的故事。
- 角色库的 `公开可展示` 有 UI、有 schema、有存储，但没有任何消费者。
- `npm audit` 有 2 个 moderate，来自 `next` 依赖的 `postcss`；`--force` 会降级到破坏性版本，暂不处理。
- 故事、世界、演员、锚点仍以 JSON payload 存在各自表里，没有完全关系化。`story_anchors` 是整组替换，够用。
- `node:sqlite` 在 Node 24 下会打实验性 API 提示。
- 默认 Mock Provider；真实模型的输出质量只能靠 `verify:llm` 和手动阅读判断，没有自动评测。

## 历史记录

2026-05-20 到 2026-09-07 之间的逐条记录（monorepo 搭建、SQLite 迁移、账号体系、流式生成、配额、审核、装帧主题、锚点与演员编辑、可见性收口、墓碑卡片、阅读社会证明）都在 git 历史里，`git log --oneline` 一眼能看完，每条 commit 的正文都写了「为什么这么改」。本文档不再重复维护那份清单——它曾经长到 116 行，而且和现状开始互相矛盾，那比没有更糟。


