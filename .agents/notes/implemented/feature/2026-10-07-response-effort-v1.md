# Agent Note: Responses SSE 服务端 effort 原生标签

Status: implemented

## Problem

Responses SSE 的 `response.completed.response.reasoning.effort` 存在，但当前 pi-ai finalizeResponse 不保留它。DSH 的常规 llm/stream 和会话投影不能提供该字段。用户需要展示服务端返回值，不是请求设置或推断的实际推理量；禁止修改 DSH/pi-ai 安装文件，不接受观测数据持久化。

## Decision

独立的 dsh-response-effort Host/Web bundle 使用网络层观测与原生 UI 插槽。[版本门禁决策](../bug-fix/2026-10-11-unrestricted-dsh-runtime.md)取代原先 DSH 0.2.0-rc.2 的精确兼容声明；当前开发与回归基线为 DSH 0.2.1-alpha.2，发行包不设置 DSH peer 门禁。Host 使用 llm/stream 的 AsyncLocalStorage 与严格 provider/端点白名单包装 globalThis.fetch；原 Response、请求参数、错误及上游取消语义不变。前端不改 DOM 或原生消息 renderer。

### 数据与消息归属

只解析 Responses SSE 的 completed/incomplete/failed 终态。非空且长度合法的字符串 effort 为 observed；缺失/null 为 absent；格式错误、缺少终态或超限为 unknown。不从请求参数、token 数、耗时补缺，不采集 summary。

每个原生 attempt 使用独立本地 token，匹配时同时检查 Agent 对象身份与原生 attemptId，防止 Agent 重建后计数复用。在异步迭代器真正推进时绑定 scope，覆盖 preparedCall 路径；end 事件携带的提交 seq 指向准确消息。SSE 解析与消息提交可以任意先后完成。上游 response ID 是辅助校验，不是唯一归属依据。

同一 attempt 中匹配的 HTTP 若被跳过、格式不完整或不可确认，关联器拒绝向消息发布候选值。即使此前有已捕获值，也不能借用它冒充未捕获响应。此边界有通过真实 FetchTap 与关联器组合的回归测试。

### 存储、通信和 UI

数据仅保存在有限后端内存。只读 Typert Remote watch 使用原生 Session lookup，首帧/重连发送内存快照；慢消费者只保留最新待发送快照。未添加独立网络服务、模型工具或持久化 Session 事件。

前端每个活跃会话共享一个订阅，按 sessionId/messageId 查询。标签注册于 conversation.chat.assistant-actions 列表插槽，跟随整轮结束后的原生操作栏显隐。observed 显示原值，absent 显示“未返回”，其他状态或缓存不存在时隐藏。不取整轮最大值或最近网络值。

Remote namespace 是独立的 Cordis Service。`$mount(REMOTE)` 后，订阅与插槽在声明 `remote.responseEffort` 依赖的子 Context 中创建；父级不能预先依赖自己负责挂载的 namespace，否则挂载无法开始。子 Context 退出时释放 Hub 与插槽，父级退出再卸载 namespace。原生 Remote 回归测试必须覆盖这一访问边界，不能仅把普通对象当作 remote。0.1.1 的真实 namespace 读取可复现 `cannot get property "remote.responseEffort" without inject`；原测试的普通对象不会实施 Cordis 访问检查，因而未覆盖该缺陷。此次修复不改变响应观测、消息归属、缓存格式、模型路由或展示语义。

页面刷新和会话切换可重新取得未淘汰的内存结果；后端重启、关闭、卸载后不恢复。无 localStorage、IndexedDB、正文或原始 SSE 文件写入。

### 逐次响应状态栏（0.2.0）

用户确认在 `conversation.input.dock` 输入框上方添加紧凑摘要，默认折叠，展开查看当前会话逐次 SSE 观测，保留原有最终消息标签。摘要明确称“最近响应”，不称当前请求等级。每条是一次匹配请求的 SSE 观测结果，不是每个 token 事件；解析终态或旁路失败时立即发布，不等待消息提交或整轮结束。无终态/格式异常显示“无法确认”，只有完整合法终态缺字段才显示“未返回”；不伪造未捕获请求的记录。

消息映射与逐次响应记录分开：响应以本地 capture ID 标识，sessionId 来自请求作用域，可靠的 sessionId 即可收录，不要求最终 messageId。失败重试、无消息提交、相同上游 responseId 和同一 attempt 中多个请求仍独立记录；最终消息标签继续遵循严格关联规则。无 sessionId 的调用不显示。记录含完成时间、provider/model、结果和会话内存段序号，不保留正文、请求或凭据。序号在该会话仍有记录时递增，记录全被清空/淘汰后重新计数，不能当作整轮总请求数。

Remote Snapshot 增加必需的 `responses` 数组，Host/Client 作为 0.2.0 一起升级；不以旧的消息映射冒充完整请求历史。两类记录共用 generation/revision 和每会话一个 Remote 订阅，各自受现有 maxEntries/maxSessionEntries/ttlMs 限制，空间上限为原消息池加等额响应池。慢消费者仍只保留最新快照。状态栏展开后有固定高度滚动区、按最近完成顺序排列、每次增加 20 条可见记录；使用原生主题令牌，不注入 DOM，不新增业务写操作或工具。

验收要求是：未提交 message/未结束 turn 时可收到并显示终态；多个请求及失败重试保留不同记录；刷新补取、跨会话隔离、generation 重置和卸载清理；状态栏与最终标签共用一个原生 Remote stream。生产服务不自动重启，管理器若要求 restart 则明确记录为待生效。

### 按需展示与原生卡片对齐（0.2.1）

输入区卡片仅在 ready 且当前会话有响应记录时渲染；空会话、连接中、订阅不可用不渲染占位容器。已捕获的 absent/unknown 仍是有效记录，不能因未拿到 effort 字符串而隐藏。记录保留期间不因本轮结束而隐藏，清空后消失，再有记录时恢复默认折叠。布局参考已安装 GoalBar 的 36px 行高、13px 字体、内缩宽度和图标按钮，颜色仅引用公开主题 alias。保持原插槽和共享订阅，不变更采集、通信和消息标签。

验收覆盖空状态 null、记录到达显现、清空/断线隐藏、恢复默认折叠、展开历史及 absent/unknown；浏览器不可连接时不声称完成手机端视觉验收。

### 有界资源与生命周期

默认边界是 8 个同时观测、16 MiB/响应、1 MiB/事件、10 分钟观测、256 个 effort 字符；已结算的待关联状态最多 2 分钟，消息缓存全局 2000 条/每会话 200 条/绝对 TTL 6 小时。活动 attempt 数量另受全局容量限制。

限额必须是正安全整数；Node 计时器、Remote 条目数与字符契约有硬上限并在加载时校验。配置默认关闭、白名单为空。配置变化重新加载本插件，清空内存；不改变模型配置。

关闭/卸载取消旁路，清空缓存、订阅与 UI 贡献。只有仍拥有全局 fetch 指针时才恢复它；若有后置包装，本包装变为透传，不覆盖其他插件。取消一条 tee 分支不等待另一条分支结束。观测异常不替换主请求错误。

## History audit

[旧诊断提案](../../../../../python/.agents/notes/rejected/feature/2026-10-07-response-effort-probe.md)的单会话、Host-only、无 UI、JSON/SSE 诊断范围已被本 V1 完全取代，旧提案转为 rejected。旧文“当前 Chat Completions”描述与读取的当前配置和 replayState 不符，不作事实依据。旧文的团队安排不适用，本任务由单代理执行。

相邻插件仅用于核对公开接入约定，未改动。当前 Python 工作区只处理上述旧提案，不修改无关代码。

## Alternatives considered

- 空状态常驻提示：便于发现订阅故障；但首页和无数据会话一直占用输入区、被误认为有效 effort，因此改为有记录才展示，连接状态不独占一张卡片。

- 仅把消息缓存显示到输入框上方：复用最少，能提前展示已提交工具步骤；但丢失失败重试和未提交消息的 SSE，且仍等待消息结算，不满足逐次响应及时可见。
- 全局顶部或每次弹通知：很醒目；但多会话归属不清、长任务连续通知打扰，因此采用会话级原生输入区摘要和按需展开。
- 仅 Host 诊断：范围最小，最快证明原始字段存在；但用户已提供该证据，并选择常用的原生 UI 展示。
- 普通 llm/stream 或 Claude/Codex hooks：接口稳定、维护成本低；但提供的是已适配的块或生命周期事件，拿不到原始 effort。
- 修改 pi-ai 并映射 providerThinkingLevel：能复用部分 DSH 透传链；但违反不改安装文件的约束，并可能进入持久会话数据。
- 本地反向代理：协议独立、易观察原始 HTTP；但需改变上游路由，不符合纯插件范围。
- 内联 Transform：背压更直接；但会改变 SDK 的 Response 身份与消费路径。本版选择受总量、时间、并发限制的 clone，并验证取消旁路不取消主流。
- 仅用 responseId/最近请求关联：实现简单；但空 ID、重试、并发可能串值。本版使用原生 attempt 的明确结算位置，并对不可确认尝试拒绝发布。

## Testing

- 0.2.1 的 `npm run check` 通过：类型检查、构建、39 项测试和笔记门禁；显隐转换、空状态零容器、同 generation 清空后恢复折叠均由组件回归覆盖。管理器安装返回 `application: restart-required`，尚未重启。浏览器 CDP 不可连接，手机端实际视觉效果尚未验收。

- 0.2.0 的类型检查与 39 项测试通过。新增真实 FetchTap 证明主 Response 尚未消费、native attempt 尚未结算时，watch 已得到逐次记录；真实 SDK/AgentLoop 证明失败重试独立收录而不会绑定到成功消息。
- 新增状态栏折叠/展开、每次增加 20 条、最近值即时更新、unknown/absent 区分、文本转义、语言切换、generation 重置和断线清理测试。原生 ClientRemoteService + SlotRegistry 同时挂载状态栏/消息标签仍只打开一条流，卸载撤回两类 UI。
- conversation 包仅新增为精确 0.2.0-rc.2 开发期类型依赖；Client 激活顺序增加 locale/conversation，但构建不导入其运行时代码。

- 0.1.2 的 `npm run check` 通过：31 项自动化测试、typecheck、Host/Client 构建与笔记校验。
- 新增真实 ClientRemoteService + Cordis + SlotRegistry 回归：0.1.1 在 carrier 打开次数断言上失败（0 而非 1）；修复后按消息 ID 渲染 high，两次挂载/卸载均关闭订阅且保留既有反馈项。测试载荷仍为合成数据，不替代浏览器实测。
- 0.1.2 已经 plugin_manager 从项目目录安装；管理器明确返回 `application: restart-required`。未重启 DSH，当前进程是否启用修复不能由安装文件替代确认，等待操作者决定重启。
- 真实 pi-ai/OpenAI SDK + 生产 AgentLoop（合成 SSE）验证请求 high/响应 max、preparedCall、空 response ID、并发 Agent、失败重试与工具续轮。
- 解析测试覆盖任意 UTF-8/SSE 分片、多行 data、换行、注释、未知/重复事件、坏 JSON、DONE 无终态、空值及限额。
- 有界缓存、TTL、LRU、慢订阅者、双向关联竞态、Agent 重建、取消和其他 fetch 包装器共存都有测试。
- 官方 SlotRegistry/React 测试验证原生增量注册、正确消息标签、不覆盖已有反馈项、卸载移除、刷新补取与文本转义。
- 原生 Gateway 测试验证 Session lookup、拒绝不存在会话与服从外部配置的会话访问策略。
- 已通过原生 CLI 安装到当前 Web profile，仅添加插件及自身 cpa Responses 白名单。既有配置、依赖、bundle 与原 package snapshot 比对保持不变。
- 最终 0.1.1 实机从 cpa/anyrouter/gpt-6-astra 捕获到 high；Remote 结果与当前会话中的 messageId/responseId 精确匹配，effort 未加入持久消息元数据。新连接能补取相同 generation 的内存结果。初次部署还验证了关闭后 generation 更新且缓存为空。

详见[验收记录](../../../../VERIFICATION.md)。验证报告只保存一次人工验收摘要，不是插件持续持久化观测数据。

## Consequences

收益是不改 DSH 核心而展示真正出现在响应里的字段，保留原生 UI 与当前模型路由；代价是运行时 fetch 拦截对 SDK 传输和加载方式敏感，升级 DSH 要重新验收。clone 存在额外缓冲，因此使用明确限额而不声称零开销。无法确认的值宁可不显示。

当前浏览器 CDP 端点不可连接，真实页面的 DOM/样式/交互验收未执行。仅确认 GUI 启动 HTML 广告了插件，不能据此宣称浏览器已渲染标签；未启动替代 GUI、未重启 DSH。包管理器还报告既有 prompt-manager 的 loader peer 缺失提示，与本插件无关，未为此改变全局策略或其他依赖。
