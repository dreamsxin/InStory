# InStory 项目进度

> 给下一次接手的人：先读「当前现状」和「工程约定」，再看「下一步」。
> 历史逐条记录压在最后，只作为溯源用，不要当成现状。

## 当前现状（2026-09-12）

纯文本互动叙事闭环已经跑通，并被测试固定住：注册登录、探索书架（服务端查询与分页）、进入故事、流式阅读、作者预设正文、入戏行动、存档回溯、配额、内容审核、创作控制台、管理控制台都在工作。

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

最近一次全量结果：typecheck 通过；单测 server 197 / story-engine 14 / web 35；e2e 35 条通过。

## 已实现

- **账号与权限**：邮箱注册登录、httpOnly Cookie 会话、`role` 为 `reader` / `admin`；`ADMIN_EMAILS` 注册即生效，已有账号下次登录时提权；`PUT /api/admin/users/:userId/role` 可发角色。`/admin` 按角色拦截。
- **阅读运行时**：`POST /api/sessions/:id/turns` 与 SSE 版 `/turns/stream`（逐字上屏、可中断）、存档时间线、`rewind` 分支、`reset` 重开、`DELETE /api/sessions/:id`、按窗口分页读取回合（`?turnLimit`、`/turns?before=`）、每日配额随会话读取一起返回。
- **介入节点（§5.3）**：每回合带 `intervention`（六种 `kind` + 一句提示），存在 `session_turns.intervention`；模型不标时服务端按这一段真实改变的状态兜一个（`deriveIntervention`，只对 `read_continue` 生效）。
- **创作**：故事四段表单、故事内演员重设（故事身份 / 与读者关系 / 秘密 / 当前目标 / 性格 / 禁止项）、剧情锚点整组替换、试玩区分「回到上次试玩」与「从开场重新试玩」、五套阅读装帧主题。
- **阅读版式**：阅读器工具坞的 `版式` 面板让读者自己选字号、行距、行宽，存在本机 `localStorage`（`lib/reading-prefs.ts`），通过 `--reader-*` 自定义属性作用在正文上；装帧仍由作者定，版式归读者。
- **首屏与空态**：首页顶部那张卡说清这是什么（一句「翻开下一章，主角就是你」＋怎么玩＋今天还剩几次），窄屏上对没有阅读进度的人保留显示；`探索故事` 一个公开故事都没有时给空态并指向 `创作`，不再是标题下一片空白。
- **反馈与社会证明**：`GET /api/me/story-insights`（作者看自己的故事被读到什么程度）与公开书架那一页随故事一起返回的 `insights`（读者数与最深回合），共用同一份聚合。
- **读者视图与作者视图分开**：`GET /api/stories/:id` 只对故事作者返回完整 `StoryDetail`；其他人拿 `PublicStoryDetail`——世界设定 + 演员姓名与故事身份，没有 `secret`/`goals`/`constraints`，锚点整块不返回（不是空数组）。见 `toPublicStoryDetail`。
- **中断真的中断**：读者点 `停止生成` 时，流式路由发现连接已断就不记成功用量、不落库，同时 Provider 会 `cancel()` 上游响应体，模型不再往一条没人读的流里生成。这一次仍记一条 `error` 用量——模型被调用过，钱花了，管理台不该看不见。
- **表单失败说得出原因**：重复的故事 ID 会得到「故事 ID「x」已经被占用，换一个再试。」（`DuplicateStoryIdError` → 409 带 `field`），字段校验失败会列出出错的字段名（`readFormError` 把 Zod 的 `issues` 路径翻成表单里的中文标签）。故事 ID 的规则写在标签里。此前这些原因都被 `lib/api.ts` 丢掉，只剩一句「创建故事失败」。
- **一次动作只调一次模型**：流式失败分两种。流还没开起来（Provider 不支持流式、传输层拒绝）才回落到非流式端点；流已经开了再失败（模型报错、审核拦下、连接中断）一律直接报给读者——那次生成已经花掉了，回落只会再花一次生成和一次突发额度。见 `StreamedTurnError`。
- **管理台**：运行状态、模型配置与 Provider 验证、用量、审核队列（解决 / 忽略）、故事配置、会话审计、账号列表与角色发放（`GET /api/admin/users` + 每行一个「设为管理员 / 收回管理员」，当前登录的账号不给自己降权）。
- **看得见自己是谁，也退得出去**：账号栏在昵称下面写出邮箱（读者也一样），管理控制台顶栏也有同一条账号栏——此前控制台既不说你是谁，也没有退出入口，只能先回客户端。
- **开发用的匿名兜底不再冒充身份**：非 production 下 `allowLegacyAnonymousUser` 会把无会话的调用当作种子读者，方便本地调 owner 路由；但 `GET /api/auth/me` 现在对这种兜底回 401。此前它照实返回种子读者，于是 `/login` 认为你已登录、把你弹回首页——`退出登录` 看起来完全失效，而且任何匿名访客都会看到「本地读者」的工作台。见 `authUserIsFallback`。
- **配额说得出什么时候恢复**：`TurnQuota` 多一个 `resetsAt`（下一个 UTC 零点的绝对时刻，`usageDayResetsAt()`），阅读器把它按浏览器时区渲染——配额用完时直接写在标签里，平时挂在 `title` 上。此前只说「请明天再来」，而配额按 UTC 日切，东八区的「明天」其实是当天早上 8 点。管理台的用量说明也写清了这一点。同时 `DAILY_TURN_QUOTA` 填成非数字不再变成 `NaN`（那会让配额检查永不拒绝，是最不容易被发现的一种失效），落回默认值 20。
- **书架有了秩序**：`探索故事` 上方有搜索（标题 / 钩子 / 类型）、类型筛选和排序（最近有人读 / 读者最多 / 按标题），默认按最近有人读——读者数和 `lastReadAt` 早就算出来印在卡片上了，却一直没当排序键用。筛不到结果时给的是「没有符合条件的故事」＋`清空筛选`，不是「这里还没有公开的故事」＋去创作：后者对只是打错关键词的人来说是句假话。
- **卡片说得出这故事有多长**：`GET /api/stories` 现在每条带 `plannedBeats`（作者标了「必经」或「可作为结局」的锚点条数）和 `segmentTargetWords`（那档篇幅真正写进提示词的字数，`SEGMENT_LENGTH_GUIDES` 是唯一来源），卡片上写成「主线 3 个节点 · 每段约 1200 字 · 约 9 分钟起」。是「起」而不是估算总量：一个节点读者可能来回几段，所以这是下限。没有预设节点的故事不编数字，直说长度由读者和 AI 一起决定。给的是计数和字数，锚点标题与说明仍然只在作者视图里——那是大纲，等于结局。
- **装完就有东西可读，也有人可登**：服务端启动时按需补一份示例数据（`data/demo-bootstrap.ts`）——三个账号 `admin@instory.local` / `author@instory.local` / `reader@instory.local`（密码 `instory-demo-2026`，`DEMO_PASSWORD` 可覆盖），示例作者名下两个公开故事「月下市集」（3 个主线节点）与「虚空邮差」（没有节点，正好覆盖长度未知那一种卡片），示例读者带一个入戏角色。逐项判重：邮箱或故事 ID 已存在就原样保留，绝不改动已注册账号的密码和角色——那会是后门，不是便利。`SEED_DEMO_DATA` 非生产默认开、生产默认关；生产显式打开时必须给 `DEMO_PASSWORD`，否则拒绝启动。e2e 显式关掉它（否则书架上的卡片数会变）。
- **看得出是哪个故事在烧钱**：`GET /api/admin/usage` 多一个 `byStory`（`summarizeStoriesForDay`，按 token 降序），管理台在「今日生成用量」下面多一张「按故事」表：故事名、读者数、成功/失败、Token、预估成本。故事名在服务端解析——ID 不是运维认得的东西；故事已删除就显示「ID（已删除）」，钱花过就该留在账上。没有 storyId 的行归到「未关联故事」而不是丢掉：同屏的总量包含它们，两个数字对不上比一行难看的记录更糟。
- **试玩不再假装是阅读**：`ReaderSessionListItem` 多一个 `isAuthorTrial`（服务端用和 insights 相同的那次比较：会话所属故事的 `ownerId` 是不是当前查看者），`继续` 列表里作者自己的试玩带一枚「试玩」标签，悬停写明「试玩同样计入今日配额」。此前同一个会话在 insights 里被当作者试玩排除、在 `继续` 里却显示成普通阅读，两处口径相反。配额照扣是有意的：那几次生成真花了钱，而且不扣就等于给「建个故事无限生成」开了一条路——要修的是界面在说谎，不是把账免掉。
- **审核队列能真的下架故事**：`POST /api/admin/moderation/events/:id/takedown` 把被举报的故事设为仅自己可见，同时把事件标为已处置，处置说明记成「已下架《标题》：…」。此前队列只能改自己那一行的颜色——运维判定越线后，还得记住故事 ID、去 `故事配置` 手动翻 `可见性`，唯一真正保护读者的那一步恰好是队列不做的。是隐藏不是删除：作者的内容仍归作者，已经进去的读者会话照样能读（测试里断言了这条）。事件不带 `storyId` 时返回 400 并保持 open——没有可下架的对象，就不该假装做了决定。
- **能把一个账号的登录全部吊销**：`POST /api/admin/users/:userId/revoke-sessions` 删掉该账号的全部 `auth_sessions` 并返回吊销条数，管理台账号表每行多一个「吊销登录」。`revokeAllSessions` 早就存在，只是没有任何入口——被盗号或滥用的会话此前只能开数据库处理，而 Cookie 有 30 天。只结束会话：角色不变、内容不删、对方能重新登录。不允许对自己用（会在处理请求的同时结束你正在用的会话，和角色按钮不给自己降权同一个道理），要退自己就用 `退出登录`。动作会写一条 `warn` 日志（谁、对谁、吊销了几条）。
- **管理操作有了可查的记录**：迁移 10 加 `admin_actions`（只追加，没有 update 和 delete），下架故事、吊销登录、发放/收回管理员都会写一行：谁、对什么、什么时候、说明。控制台多一个「操作记录」分区。故事名和邮箱是写进行里的快照——故事会改名会删除，只存 ID 的记录恰好在需要它的时候变得读不懂。操作者留空有两种情况：用 `ADMIN_TOKEN` 调的（共享凭证背后没有具体的人），以及开发匿名兜底（`authUserIsFallback`）——审计里写「本地读者干的」会是这张表最不该说的谎。`adminActionStore` 在 `BuildAppOptions` 里是必填而非可选：能被某条部署路径忘掉的审计不算审计。
- **能停用账号，不只是踢下线**：迁移 11 给 `users` 加 `disabled_at`（时间戳而非布尔——「从什么时候起」是被停用的人第一个会问的事），`PUT /api/admin/users/:id/access` 收 `{ disabled }`：停用会同时吊销全部会话（不吊销就等于封禁要等 Cookie 自己过期，最长 30 天），恢复只是开门、不返还旧会话。登录路径在密码校验通过之后才看停用状态，返回 403「这个账号已被停用」——放在校验之前等于告诉未认证的人这个邮箱存在，而回一句「密码错误」会让持有正确密码的人反复去改一个没问题的密码。`findUserBySessionToken` 也拒绝已停用账号，作为吊销之外的第二道。控制台账号表多一列「状态」和「停用账号 / 恢复账号」，不能停用自己，两种决定都写进 `admin_actions`。
- **撤掉了角色库那个什么都不做的开关**：入戏角色的 `公开可展示` 从两处表单、卡片标签和请求 schema（`createReaderProfileRequestSchema`，POST 与 PUT 共用）里一并删除。它有 UI、有 schema、有存储，却没有任何消费者：没有地方能浏览别人的入戏角色，作者也不能把别人的角色请进自己的故事，选「公开」和选「私有」对读者来说完全一样。留着一个不生效的选项，是界面在替一个不存在的功能许诺。存储层的 `visibility` 列保留，但 `ReaderProfileStore` 不再收这个入参：新建和保存一律写 `private`，接口收到 `visibility: "public"` 也只会得到私有角色（服务端和 store 两层测试都断言了这条）。老数据里已有的 `public` 行不做批量改写，反正没有任何读取方，下一次保存自然归位。让它成真（公开角色可以被作者选入故事）是一次产品决定，不是顺手补上的缺口——真要做，需要一个能浏览的入口、作者选角时的授权语义，以及别人拿走你的身份之后你还能不能改它。
- **账面上分得出「作者在调自己的故事」和「有人在读」**：迁移 12 给 `generation_usage` 加 `is_author_trial`，两条推进路径（普通与流式，成功与失败）都按同一个 `isAuthorTrial(ownerId, viewerId)` 判定填进去——和 `继续` 列表的「试玩」标签、作者 insights 的排除用的是同一次比较，一次阅读不会在一个屏幕上算试玩、在另一个屏幕上算读者。`GET /api/admin/usage` 的 `byStory` 多 `trialGenerations` / `trialTokens`，`today` 也带同一对数字，控制台「按故事」表多一列「作者试玩」，说明行写出「其中 N 次是作者试玩自己的故事，照常计入作者本人的配额」。`readers` 的含义同时被修正成「除作者以外的账号数」——它此前把作者自己算成读者，和书架上同名的那个数字对不上。历史行不留空：迁移按故事 payload 里的 `ownerId` 回填，已删除的故事和平台故事（没有作者）留 0，迁移测试把这四种情况都钉住了。配额照扣不变。
- **没上锁的管理台只服务本机**：没设 `ADMIN_TOKEN` 时 `/api/admin` 此前对任何能连上端口的人开放，而默认 `HOST=0.0.0.0`——一台开着 `npm run dev` 的笔记本，在咖啡馆的 Wi-Fi 上就把用量、账号列表、故事下架全都交出去了，而且没有任何提示。现在两处一起改：非生产默认只监听 `127.0.0.1`（容器需要 `0.0.0.0`，生产保持原样，其他情况显式设 `HOST`），并且免鉴权这条路径只对 loopback 放行，其他来源一律 401 并打一条 `warn`。判定读的是 socket 的对端地址而不是 `request.ip`——后者在 `trustProxy` 下会采信 `X-Forwarded-For`，一个调用方自己写的头绝不能声称自己是本机；代价是经过代理的请求永远不算本机，这个方向上错是安全的。测试把三种情况钉住：本机 200、外部 401、伪造 `X-Forwarded-For: 127.0.0.1` 仍然 401。
- **依赖的安全状态从「一句暂不处理」变成一份对得上的清单**：文档此前写「`npm audit` 有 2 个 moderate，来自 `next` 依赖的 `postcss`，`--force` 会降级，暂不处理」——三处都不对。对着官方源实跑一次是 9 条：1 critical、4 high、3 moderate、1 low，涉及 `next`、`fastify`、`find-my-way`、`fast-uri`、`sharp`、`vite`、`esbuild`、`vitest`、`postcss`；而 postcss 那条现在是 high（`GHSA-6g55-p6wh-862q`，通过 `sourceMappingURL` 任意读文件），修法是升级不是降级。这一轮升了 `fastify` 5.6.2 → 5.12.3（其中一条正是 `trustProxy` 跳数下的 `X-Forwarded-*` 伪造，和上一条改动同一个代码路径）、`next` 16.0.4 → 16.3.4、`postcss` → `^8.5.28`：9 条降到 6 条，critical 清零。`next` 16.3.4 自己钉的 postcss 已经是修好的 8.5.23，所以过程中加过的那条 root override 又被拿掉了（它已经不改变任何解析结果）。CI 的 audit 从此能真的失败：以前它同时写着 `--audit-level=high` 和 `continue-on-error: true`，两个加起来等于永远不会红，这正是那条 critical 一直没人看见的原因。升 fastify 还带出一个配置上的破坏性变化：`trustProxy` 不再接受「信任 N 层代理」这种跳数写法（正是那条 advisory 的成因），所以 `TRUST_PROXY` 现在只收地址或 CIDR 列表，填数字会被忽略并打一条警告——被忽略等于「谁都不信」，宁可把所有读者挤进同一个限流桶，也不能采信调用方自己写的 `X-Forwarded-For`。`docker-compose.yml` 相应从 `TRUST_PROXY: '1'` 改成 compose 网段。
- **进故事之前就知道自己还剩几次**：新增 `GET /api/me/quota`（复用 `resolveQuota`，未登录 401），首页那张卡把「每天 20 次推进，够读完一个晚上」换成读者自己的数字——「每天 20 次推进，你今天还剩 N 次」，统计格子里多一枚「今日剩余」。此前配额只能从会话里读到，于是卡片对所有人说同一句关于产品的话：一个只剩两次的人和一个还没开始的人看到的完全一样，差别要等到读到一半被错误告知。用完时改说「今天的 20 次已经用完，X 后恢复」，恢复时刻按浏览器时区在 effect 里格式化（和阅读器工具坞同一套 `formatQuotaReset`）——配额按 UTC 日切，服务端的「明天」不是读者的明天。e2e 把两处钉在一起：读一段之后阅读器显示 19/20，回到首页也必须是 19。用完之后，故事卡和 `继续` 卡片上还会多一句「今天的 20 次推进已经用完，X 后才能往下读」——`进入故事` 仍然可点：开场那一段来自故事自己的配置、不花配额，所以额度用尽不该剥夺「先看看这故事长什么样」；此前读者会进去、读完开场、按下 `继续阅读`，才被告知没额度了。阅读器里同样提前说：额度为 0 时 `继续阅读` 变成禁用的「今日次数已用完」并在下面写出恢复时刻，`入戏行动` 面板开头直接说明「现在不能再往下写」，快捷动作、本幕建议、自由行动输入框一并禁用——这个面板正是读者会先打完一整句话再按下的地方，写完才被拒是最难受的一种。看已经写好的段落、回溯、重开、改版式都不受影响：只有真的会调模型的控件被关掉。
- **作者能看见自己标的节点有没有被走到**：作者能写「必经 / 结局」锚点，却无从知道读者是否真的到过——锚点只进提示词，什么都不回来。现在 `NarrativeResult` 多一个 `anchorId`（模型上报，`.catch(null)`：报错的字段不该让读者损失一整段），服务端只接受确实属于该故事的锚点 id（编造的一律变 null，否则作者的节点表里会出现他没写过的节点），迁移 13 把它记在 `session_turns.anchor_id`。`GET /api/me/story-insights` 的每条 insight 多一个 `anchorReach`（按读者去重、逐故事排除作者本人，和 `readers` 同一口径），作者的「我的故事」行里因此多一句「1 位读者读了 2 段：提灯人现身 1 人到过 · 河水退去 还没有人走到」。没人读过的故事不给逐节点数字，只说「主线 N 个节点 · 还没有人读过，无从谈到过没到过」——「没有人到过这个节点」对每一个没被打开的故事都成立，等于没说，而它长得又像是在说锚点写得不好。锚点 id 与标题绝不进读者视图（测试里断言了会话响应里搜不到那个 id）——那是作者的大纲。Mock provider 会上报它本来就用作幕标签的那个锚点，所以这个功能在默认装机上就有真实数字，而不是等配了真模型才不再全是 0。这个数字的含义是「模型声称推进了这个节点」，不是地面真相：一段真的推进了却没上报，就不在里面——`title` 上写明了这一点。改写会话（回溯、重开）时 `anchor_id` 用 `COALESCE` 保留，不会被一次不带锚点的重写擦掉。回溯是分叉出一个新会话、把此前的段落整份复制过去，所以 `copyTurnMarkers` 按回合 id 把锚点标记一起搬过去（不覆盖已有的）——不搬的话，读者删掉他分叉离开的那个会话之后，作者的报表就会丢掉一个分支正文里明明还在的节点。
- **锚点的身份不再由它在表里的位置决定**：上一条刚让锚点开始携带读者数字，而此前锚点 id 是 `${storyId}-anchor-${index + 1}`：作者删掉第一个节点，第二个节点就会继承 `-anchor-1` 这个 id，连同它已经积累的到达人数——报表会说读者到过一个作者刚删掉的节点。现在 `UpdateStoryAnchorsRequest` 的每一行可以带上 `id`（新增行不带），`replaceOwnedAnchors` 只在这个 id 确实属于该故事且本次没被用过时复用它，否则新铸一个 `crypto.randomUUID().slice(0, 8)` 后缀；作者编辑面板把 id 藏在 `AnchorDraft` 里一起提交，所以「改措辞」不会被当成「删一个加一个」。顺序改由迁移 14 的 `story_anchors.seq` 保存（`ORDER BY seq ASC, id ASC`），这样"顺序"和"身份"不再是同一个东西。测试从两头钉：store 层断言删中间一行之后剩下两行的 id 不变，API 层断言把两行倒序带 id 提交回去时 id 跟着行走而不是跟着位置。
- **有人问了你一句，兜底也能认出来**：关键节点（§5.3）在模型不标注时由 `deriveIntervention` 从状态变化里读，此前它只能读出危机、关系变化、线索、章节转折四种，`NPC 发问` 被记成"状态里读不出来"的能力边界。但那句问话就在 `dialogues` 里：一句同时带问号和"你"的对白，是模型输出里现成的证据，不用再问一次模型。两个条件都必须成立——只看问号会把演员之间的互问算成在问读者，只看"你"会把每句提到读者的台词都算成提问。这一读放在四种状态读法之前：有人正等你回答，比"恐惧涨了 3 点"更具体地指出这一段该回应什么，提示里也带上是谁问的、问了什么。`fork` 仍然不兜底，理由写在下一节。
- **重置与回溯真的把旧的那份阅读丢掉**：两者都是新建会话（`sess_…`）再返回，此前旧会话被留在库里。而 `继续` 用的 `listRecentOverviews` 只取每个故事最新的那一个会话，所以旧会话既回不去、也不会消失，还继续算在作者的 `readers` / `turns` 里——弹窗写的是「全部回合与存档都会清空，无法撤销」和「这之后的回合会被丢弃」，实际得到的是一份读者看不见的副本，和一个永远只增不减的表。现在两条路径在建好替代会话之后都调 `deleteOwned`（回溯是在 `copyTurnMarkers` 之后，所以留下来的那份仍然带着锚点和预设正文的标记）。`generation_usage` 不动：账单和配额记的是真的发生过的生成，删掉正文不该抹掉花过的钱。
- **到达人数也写在锚点表的那一行上**：作者要改的是某一条锚点，而数字此前只出现在故事标题旁的汇总句里，等于让他自己去对照哪一句说的是哪一行。`StoryEditForm` 把 insight 透给 `AnchorsEditForm`，每行按 id 取自己的人数（新加的行没有 id，也就没有数字）。三条沉默规则和汇总句同源：没人读过的故事整张表不出数字；`可选` / `禁止` 的 0 不说（没人走到一条禁止发生的线本来就该这样）；`禁止` 上出现人数则写明「而这条写的是禁止提前发生」，那是唯一需要作者立刻回头看的数字。e2e 从作者视角走完：建故事 → 加锚点 → 另一个账号读一段 → 汇总句与锚点行说同一个数。
- **「共创方式」和「AI 自由度」终于真的作用于生成**：这两个选项作者能选、故事卡上还印给读者看（「AI 自由度 medium」「共创方式」），但此前它们只是跟在 `story.summary` 里被 `JSON.stringify` 送进提示词，没有任何一句说它们是什么意思——同一个故事标成剧本还是即兴，模型收到的规则一字不差。`buildSystemPrompt(story)` 现在按这两档各追加一句明确规则，两档的语义也定义成互不重叠的两件事：`experienceMode` 管读者的行动能在多大程度上改动主线（剧本＝只改细节与节奏；共创＝可改支线与顺序，但 required 锚点仍必须发生；即兴＝可改主线走向，锚点仍须以某种形式发生），`aiFreedom` 管模型能在作者写下的东西之外新增多少（low 不新增；medium 只补细节与临时次要人物；high 可加新场景、新人物、新支线，但不得违反世界规则与锚点）。没有 story 时一句都不加——那是 `verify:llm` 之类不带故事的调用，凭空按默认档写规则等于替作者做决定。剧本模式下作者真的写了预设正文时还会再加一句（见下一条），但那两件事仍然分开：`experienceMode` 约束的是遵从度，预设正文才是替他写好的段落。
- **书架的搜索、筛选、排序和分页都下沉到了服务端**：此前这些全在浏览器里做，前提是整份公开列表（连同每个故事的读者数）随首屏一起下发——一个读者只是想在搜索框里打三个字，代价是把整个书架传给他。现在 `GET /api/stories` 收 `q` / `genre` / `sort` / `limit` / `offset`（`shelfQuerySchema`，默认 `sort=recent`、`limit=24`），SQL 里过滤（`searchPublicStories`，关键词同时比对标题、钩子、类型，`%` 和 `_` 按字符转义，不当通配符），排序在路由里用 `compareForShelf` 做——它需要阅读历史，那在另一张表里。`GET /api/stories/insights` 一并删掉，读者数改成随这一页的故事返回：两个接口各自判断一次「哪些故事是公开的」，正是卡片上会出现一个为另一批故事算出来的数字的原因。排序键单独走 `summarizeStoryOrderKeys()`——一条 SQL 拿到全部被读过故事的读者数与最近阅读时刻；`summarizeStories` 按故事 id 拼 OR 子句，用它给几百个故事排序等于拼几百个子句，而其中只有一页的数字会被读到。响应里两个总数分得很清：`total` 是这次查询匹配到的条数，`publicTotal` 是公开故事的总数——只有后者能把「还没有人公开过故事」和「你的关键词没匹配到」分开，而这两句话在界面上不该长得一样（首页的「故事世界」格子用的也是 `publicTotal`，否则它会变成「本页有几个」）。`genres` 也故意不跟着筛选走：类型下拉的用处正是切到不在当前结果里的那一类。参数读不懂时返回 400 而不是悄悄用默认值：一个默默忽略 `sort` 的书架会摆出一个谁都没选过的顺序，看起来就像排序坏了。客户端只剩下发请求：改条件走 250ms 防抖并丢弃过期响应（否则谁最后到就画谁），翻页是显式的「再看 N 个」并按 id 去重（两次请求之间有人发新故事，窗口会移，不去重就会一张卡出现两次、另一张永远不出现），取不到时明说「没能取到故事列表」——留着旧卡片会让人以为关键词匹配到了全部。
- **作者能自己写正文了，读者读到的就是那几个字**：`ARCHITECTURE.md` 那条三级优先级（预设 → 已生成 → 现生成）的第一级此前没有任何数据支撑——作者能写的只有锚点，那是对生成的约束，不是正文。现在迁移 15 加 `story_segments`（作者的小节：标题、正文、可选绑定的锚点，`seq` 存顺序），迁移 16 给 `session_turns` 加 `segment_id`（这一回合发的是哪一段预设，null 就是模型生成的）。命中规则只有三条，每条都是决定而不是细节：只在 `scripted`（剧本）模式下发——那一档本来就答应读者"行动不改变主线"，是唯一一个预写正文能守住的承诺，而共创和即兴恰恰答应了读者可以改，把昨天写好的段落发给他就是卡片在说谎；只在 `read_continue`（继续阅读）时发——读者写了一句话就是要被回应，昨天写的段落回应不了，所以那一路仍然交给模型（它仍受剧本规则和锚点约束）；只发这一局还没发过的那一段，"没发过"是从回合里读的（`listServedSegmentIds`），所以回溯丢掉的段落会被重新发一次——那正是回溯的意思。发完了不是错误：故事从作者停笔的地方继续，由模型往下写。预设段落不调模型，因此**不写 `generation_usage`，也不扣每日配额**：配额存在的目的是限制花钱的生成，而这一段是作者手写的（限流器同理跳过，它护的也是模型）。段落不编造周边：没有对白、没有状态变化、也没有 `choices`——替作者的正文编三个建议动作等于平台替他说话，读者仍然可以「继续阅读」或自己写。段落可以绑定一个锚点，于是全预设的故事在作者的到达报表里也有真实数字，否则它会显示"没有人走到过任何节点"；绑一个不属于本故事的锚点一律落成 null（和模型上报的锚点走同一条白名单）。流式端点也走这条路：客户端要的是 SSE，就给它 SSE，整段正文一次 `narration_delta` 送到——不假装在慢慢写。预设正文与锚点同级，属于作者视图，`toPublicStoryDetail` 不返回它（测试断言读者拿到的响应里搜不到那段文字）；作者保存时就过一次内容审核（`story_config`），越线的段落在他写的时候被拒，而不是丢给读者读到一半。提示词里也加了一句：剧本模式且有预设正文时，明确告诉模型"主线正文由作者写好并按顺序原样发给读者，你这次写的是读者岔开时的衔接段落，不要改写、不要提前写出后面的内容"——预设正文本身不进提示词，那会为同一批字付两次钱，还会引诱模型提前把下一段写出来。作者端在「剧情锚点」下面多一个「预设正文」编辑器，和锚点同一套整组替换与 id 保留（id 换了就等于告诉一个读者他读过一段他没读过的正文）；故事不是剧本模式时，面板直接写明"预设正文不会发给读者"——留着一个不生效的输入框，就是界面在替一个不存在的功能许诺。
- **AI 编排**：`MockNarrativeProvider` 与 `OpenAICompatibleProvider`（超时、分类重试退避、流式 narration 增量提取、输出 Zod 校验）。

## 代码地图

- `apps/server/src/app.ts`：所有路由都在这一个 `buildApp` 里，没有 routes/ 分层。找接口直接搜 `app.get("/api/`。推进一回合的两条路径（普通与流式）都在这里，`findPresetPassage` / `presetPassageResult` 是"这一段该不该由作者的预设正文来答"的唯一判定处，`commitTurn` 是两条路径共用的落库。
- `apps/server/src/db/`：`migrations.ts`（唯一的 schema 事实来源，append-only）、各 `*-store.ts` 直接写 SQL，没有 ORM。
- `apps/server/src/model-runtime.ts`：Provider 的装配与 `verify`；`moderation/checker.ts` 是输入输出审核，`security/rate-limiter.ts` 是限流，`security/addresses.ts` 是「信谁的地址」（`TRUST_PROXY` 解析与 loopback 判定，两个都有单测）。
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
10. `add_admin_actions` — 管理操作的审计表，只追加
11. `add_user_disabled_at` — 账号停用时间，null 就是正常
12. `add_usage_author_trial` — 每条用量记下「这是作者在试玩自己的故事吗」，并按故事 payload 里的 `ownerId` 回填历史行
13. `add_turn_anchor` — 每个回合记下它推进了哪个剧情锚点（模型上报、服务端按该故事的锚点白名单校验），空值是「没上报」
14. `add_anchor_seq` — 锚点自己记住作者排的顺序，于是 id 不必再由位置决定
15. `add_story_segments` — 作者亲手写的正文小节（标题、正文、可选锚点），`seq` 存作者排的顺序
16. `add_turn_segment` — 每个回合记下它发的是哪一段预设正文，null 就是模型生成的（也就是"这一段花过钱"）




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
- **界面上的顺序、筛选结果改由服务端决定之后，e2e 不能再直接读 DOM。** 客户端拿一次网络往返（还带 250ms 防抖）才换掉卡片，所以断言必须是会自动重试的那一类（`await expect(page.locator(".story-card h2")).toHaveText([...])`），一次性的 `allInnerTexts()` 读到的是上一次的顺序。这条正是把书架排序下沉之后唯一挂掉的用例。
- **加一个字段的顺序**：`packages/shared`（类型 + zod）→ 需要落库就加迁移 → `*-store.ts` 读写与归一化 → `app.ts` 路由 → `apps/web/src/lib/api.ts` → 界面 → 服务端单测 + e2e → 文档。

## 本机排错

- **e2e 有自己的端口和数据库。** API 4100 / Web 3100 / `data/e2e.sqlite`，dev server 可以一直开着。以前共用 4000/3000，代价有两个：跑之前得先杀掉开发服务器（而且杀掉后台任务并不会杀掉 `tsx watch` / `next dev` 的子进程，只能按端口 `Get-NetTCPConnection` → `Stop-Process`），以及浏览器里开着的 localhost:3000 会在那段时间里悄悄显示测试数据库——测试故事出现又消失，看起来和"数据被清空"一模一样。`reuseExistingServer: false` 仍然保留：这两个端口是 e2e 自己的，上面还在监听的只可能是上一轮没退干净的进程。另外换端口不够——Next 一个构建目录只允许一个 dev server，所以 e2e 还带 `NEXT_DIST_DIR=.next-e2e`（`next.config.ts` 读它）。
- **`npm audit` 在国内镜像源上跑不了，`npm update` 干脆会崩。** 镜像（`registry.npmmirror.com` / `registry.npm.taobao.org`）没实现 `/-/npm/v1/security/*`，报 `[NOT_IMPLEMENTED]`，看起来像项目坏了；要本地查就临时指定官方源：`npm audit --registry=https://registry.npmjs.org`。另外本机的 npm 在这个 workspace 上解析不了新的依赖树：任何 range 改动（例如把 `vitest` 从 `^4.0.13` 提到 `^4.1.11`）都会崩在 `Cannot read properties of null (reading 'edgesOut')`，`npm update`、`npm install`、`npm install --package-lock-only` 都一样，换官方源也一样——已逐一试过，所以别再在这台机器上试。崩掉的 `npm update` 还会写坏 `package-lock.json`，症状是之后每条 npm 命令都崩；解法是 `git checkout -- package-lock.json` 再 `npm install`。`npm ci` 不受影响（它只按 lock 安装，不做解析）。要升依赖走 CI 的 `lockfile-refresh` job：它在 Ubuntu 上重新解析并把新 lock 当 artifact 传出来，下载提交即可。
- **想用手机连本机的 dev server，要显式设 `HOST=0.0.0.0`。** 非生产默认只监听 `127.0.0.1`（见上一节的理由）；症状是同一 Wi-Fi 下的另一台设备连不上，而本机 `localhost` 一切正常。
- **PowerShell 不支持 `&&`**，命令要分开发；提交信息用 `git commit -F .git/COMMIT_MSG_TMP.txt`，避免引号和 `<>` 破坏解析。
- **`apps/web/next-env.d.ts` 会来回抖动**（dev 与 build 写的路径不同），提交前 `git checkout -- apps/web/next-env.d.ts`。
- **`.env` 只有服务端读，而且是通过启动参数读的。** `apps/server` 的 dev/start 脚本带 `--env-file-if-exists=../../.env`；在此之前根目录 `.env` 根本没人读，README 让人复制的那份文件一直是摆设，所有变量只有导出到 shell 里才生效。已导出的环境变量优先级高于文件，所以 e2e 显式传的配置不会被开发用的 `.env` 覆盖。Web 侧的变量要放 `apps/web/.env`——Next 只读自己目录。
- **e2e 单跑某个 spec 会 409**：`npm run test:e2e` 才会重置数据库，直接 `npx playwright test xxx.spec.ts` 会撞上上一轮留下的账号。
- 真实模型：`.env` 里把 `LLM_PROVIDER` 换成 `openai-compatible` 并配 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`，或在 `/admin` 里存一份（API Key 只落服务端，不回显）。

## 下一步（按我判断的优先级）

按我判断的优先级排。前两条是挂了一段时间的能力缺口，后两条分别是一个未定的产品决定和一层性能账（这次把预设正文做完之后，"预设 → 已生成 → 现生成"里还剩中间那一级）：

1. **同一段不重复生成（`SessionSegment` 缓存）**：预设正文已经落地，但三级优先级的中间那一级——"已生成过的就别再生成"——还没有。现在同一个故事的两个读者走到同一处，各花一次生成；同一个读者回溯之后重走，也再花一次。要做得先定义"什么算同一处"（会话状态 + 上一段 + 读者输入的哈希？还是只对 `read_continue` 且状态未变的情况缓存），以及缓存命中时算不算配额（我倾向于算：那一段仍是为这个读者生成的，只是省了钱；但这要和"预设不算"的口径一起说清）。
2. **`路线分歧` 只能由模型识别**，这是能力边界，不是遗漏：`choices` 在生成协议里是每段必给的 2 到 4 项，所以"有选项"根本不含"这里真的分叉了"的信息——照它派发 `fork` 等于给每个平淡段落都盖一个路线分歧的章，标签会立刻失效。要真做只能加一次轻量的判定调用。`NPC 发问` 已经不在这个名单里了：一句既带问号、又带"你"的对白是模型输出里现成的证据，服务端兜底现在读它。
3. **公开入戏角色（产品决定，未定）**：撤掉那个开关之后，「把自己的入戏角色公开、供作者选进故事」这件事变成了一个明确的产品问题而不是一个待接线的字段。要做得先答三问：读者在哪里浏览别人的角色；作者选角时是引用还是复制（现在故事内演员是复制快照）；角色被别人用过之后原主还能不能改、改了算谁的。答不上来就不该有那个开关。
4. **书架的关键词与排序还没进索引**：查询已经在服务端了，但匹配到的那一批仍然整份读进内存再排序取窗口（`searchPublicStories` + `compareForShelf`）——因为排序键在 `reader_sessions` 里，而故事字段都藏在 `stories.payload` 的 JSON 里。几百条无所谓；真到几千条，就该把 `visibility` / `genre` / `title` 提成列并加索引，让 `ORDER BY` 和 `LIMIT` 交给 SQLite。要一起想的还有排序键怎么落库（物化一张 `story_reading_stats`？还是每次 join 聚合），这决定了「最近有人读」能不能进同一条 SQL。

## 已知问题

- 没设 `ADMIN_TOKEN` 时 `/api/admin` 仍然是「本机免鉴权」，只是被限制在 loopback；同机器上的另一个用户或任何本地进程仍然进得去，这是本地开发的取舍。要真正上锁就设 `ADMIN_TOKEN` 或用 admin 账号登录。

- 作者试玩消耗作者自己的每日配额，这是有意的（生成真花钱，免掉就成了无限生成的路子）；账面上现在分得出来了（`is_author_trial`），但配额本身仍不区分——如果以后要给作者一份单独的试玩额度，那是产品决定。

- 审核队列能下架故事，账号表能吊销登录、停用与恢复账号，操作都写进 `admin_actions`；但 admin 仍不能删除他人的故事（只能设为仅自己可见）。
- 入戏角色仍有 `visibility` 列，但所有写入都是 `private`，也没有任何界面或接口能改它；老库里遗留的 `public` 行不影响任何行为（没有读取方），下一次保存会写回 `private`。
- 预设正文本身不进提示词，所以模型写衔接段时看不到作者后面还没发出去的段落，只看得到已经发过的那些（它们就在会话回合里）。这是有意的省钱与防剧透，代价是衔接段可能和下一段预设之间有一点接缝。真要消除，得把"下一段的摘要"喂进去——那是另一次产品决定：摘要谁写、由谁审。
- 预设正文不扣配额、不写用量，所以一个全预设的剧本故事对读者是"免费"的，对平台也是。这是有意的（没有生成就没有成本），但也意味着配额不再等于"读了多少段"；管理台的用量表本来就是按生成算的，两个数字从此不必相等。

- 依赖里还有 6 条未修（1 low / 2 moderate / 3 high），每一条的修复版本都落在父包 range 之内，`npm audit fix` 就能解决，只是本机 npm 解析不了（见下条）：
  - `fast-uri` 3.1.2（high，6 条 host confusion / SSRF）。唯一一条真在请求路径上的——它来自 fastify 的 URI 解析。
  - `find-my-way` 9.6.0（high，`GHSA-c96f-x56v-gq3h`，HTTP/2 下的 DDoS）。我们没开 HTTP/2，所以当前不可触发，但路由器就该跟着升。
  - `vite` 8.0.13（high，`launch-editor` 的 NTLM 泄露与 `server.fs.deny` 绕过，都限 Windows）、`esbuild` 0.28.0（low，Windows 上 dev server 任意读文件）、`vitest`/`@vitest/mocker` 4.1.6（moderate，`GHSA-82fw-gwwq-j7x9`）。这三条只在开发机的构建链上，不进产物。
  - `sharp` 那条已经随 `next` 16.3.4 消失了——此前这里写"最新版仍无解"，是升级前的旧结论，已作废。
  CI 的 audit 门槛因此暂设在 critical，等这几个升上去再收紧到 high；`lockfile-refresh` 那个 job 每次都会产出一份重新解析过的 `package-lock.json` 作为 artifact，下载提交即可完成升级。

- `postcss` 曾用 root `overrides` 顶到 `^8.5.28`（当时 `next` 锁在 8.4.31）；升到 `next` 16.3.4 之后它自己钉的是已修复的 8.5.23，那条 override 就不再改变任何解析结果，已删除——留着等于悄悄冻结 `next` 将来对 postcss 的要求。现在树里是 root 8.5.28 加 `next` 内部 8.5.23，两份都在修复线以上。



- 故事、世界、演员、锚点仍以 JSON payload 存在各自表里，没有完全关系化。`story_anchors` 是整组替换，够用。
- `node:sqlite` 在 Node 24 下会打实验性 API 提示。
- 默认 Mock Provider；真实模型的输出质量只能靠 `verify:llm` 和手动阅读判断，没有自动评测。

## 历史记录

2026-05-20 到 2026-09-07 之间的逐条记录（monorepo 搭建、SQLite 迁移、账号体系、流式生成、配额、审核、装帧主题、锚点与演员编辑、可见性收口、墓碑卡片、阅读社会证明）都在 git 历史里，`git log --oneline` 一眼能看完，每条 commit 的正文都写了「为什么这么改」。本文档不再重复维护那份清单——它曾经长到 116 行，而且和现状开始互相矛盾，那比没有更糟。


