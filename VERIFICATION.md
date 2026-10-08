# Responses Effort 验收记录

## 0.2.0 逐次响应状态栏

- 已实现输入框上方原生 `conversation.input.dock` 摘要，`response-effort` / order 30。默认折叠、可展开查看逐次响应、按最近完成顺序显示、每次追加 20 条可见记录；保留最终消息标签。
- 每个受观测的 SSE 在解析终态或旁路失败后立即写入独立响应池，无需等待消息提交或整轮结束。失败重试保留独立记录；最终消息关联仍严格隔离。两个池分别受现有限额限制，无新增持久化数据。
- `npm run check` 通过：39 项测试、类型检查、Host/Client 构建和笔记门禁。另通过 Client 语法检查、Host 产物导入和 npm pack。
- 原生 FetchTap 测试证明主 Response 尚未消费、native attempt 未结束时就能读到 SSE 终态记录。真实 pi-ai/AgentLoop 测试验证失败重试历史与成功消息标签分离。
- 原生 ClientRemoteService + SlotRegistry 验证状态栏和消息标签共用唯一 Remote 流；卸载清空观测并移除两类贡献。组件测试覆盖实时摘要、折叠/展开、20 条增量显示、unknown/absent 区分、会话隔离、文本转义、中英文文案、generation 重置和订阅失败清理。
- 客户端产物运行时仅 require React / React JSX runtime；没有引入 Harness Client 实现。新样式仅用已检查的主题令牌；浏览器外观及实际浅/深色效果未实测。
- 已通过 plugin_manager 从[0.2.0 安装包](dsh-response-effort-0.2.0.tgz)安装，安装元数据确认为 0.2.0。使用打包产物替代项目链接，避免后续源码编辑直接改变已安装包。
- **管理器返回 `changed: true`、`application: restart-required`。没有重启 DSH，遵循用户选择稍后手动重启。** 实时 Client Inspect 已看到新 dock 条目 active，但这不能推翻管理器要求或证明完整 Host/Client 升级已生效。
- CDP `127.0.0.1:9222` 仍无法连接，未完成当前页面 DOM、展开点击、窄屏及浅/深色实测。没有启动替代浏览器/GUI，没有伪造页面截图。

### 用户手动验收

1. 手动重启当前 DSH，然后刷新原页面，确保 Host/Client 均为 0.2.0。
2. 发送会产生多个模型步骤的任务；每个匹配 SSE 观测结束后，输入框上方“最近响应”应更新，无需等待整轮结束。
3. 点击“查看记录”，核对不同请求单独出现；失败、未返回和无法确认不混淆。最终回复仍能显示自身消息的 effort。
4. 重启前内存记录不会恢复；切换会话不应出现其他会话记录。

## 0.1.2 显示缺陷修复

- 真实客户端已注册 `response-effort` 插槽；当前 Host Remote 能返回 `effort: high`。没有标签并非插件未安装或上游完全缺失 effort。
- 0.1.1 未声明对独立 Service `remote.responseEffort` 的依赖；原生 Cordis 复现 `cannot get property "remote.responseEffort" without inject`，订阅层捕获错误后保持空列表。修复在 `$mount` 后建立声明此依赖的子 Context，并在其中创建 Hub/插槽。
- `npm run check` 通过：31 项测试、类型检查、构建、笔记门禁。新回归使用原生 ClientRemoteService/Cordis/SlotRegistry，修复前 carrier 调用为 0、断言失败；修复后成功显示 high，并验证卸载/重新挂载时订阅清理。
- plugin_manager 已从 `/app/project/dsh-response-effort` 安装 0.1.2，返回 `changed: true`、`application: restart-required`。没有擅自重启 DSH；修复版的当前页面生效状态仍待重启后验证。仅刷新页面不等于已完成管理器要求的重启。
- 浏览器 CDP 仍不可连接，未宣称已目测用户页面标签。

以下 0.1.1 记录保留为此前 Host 验收证据，不代表 0.1.2 已经在运行进程生效。

## 0.1.1 原交付状态

- 插件：`dsh-response-effort@0.1.1`。
- 项目：[说明文档](/app/project/dsh-response-effort/README.md)。
- 安装包：[dsh-response-effort-0.1.1.tgz](/app/project/dsh-response-effort/dsh-response-effort-0.1.1.tgz)。
- 已通过 `dsh plugin --profile web add ... --ignore-scripts` 安装到现有 Web profile，并启用本插件。
- 仅观察 `cpa` 的 `http://192.168.1.100:8317/v1/responses`。未切换模型、修改上游配置、重试策略或 DSH/pi-ai 安装文件；未重启 DSH、未启动替代 GUI、未发布包。

## 自动化验证：通过

`npm run check` 包含类型检查、Host/Client 构建、30 项测试及笔记校验，均通过。另完成 Host 产物导入、Client JavaScript 语法和 npm pack 烟测。

覆盖：
- SSE/UTF-8 任意分片、换行、多行 data、合法终态、缺失/null、非法类型、未知字符串、坏 JSON、无终态、字节/字符/时间限额。
- 原 Request 参数、Response 身份、主流字节和错误不被旁路改变；取消旁路不取消主流。
- 白名单隔离、观测并发限制、其他 fetch 包装器共存、重复加载和卸载。
- 真实 pi-ai/OpenAI SDK 与生产 AgentLoop 的 preparedCall、请求 high/响应 max、无 response ID、并发 Agent、失败重试、工具续轮。
- 消息提交先后竞态、Agent 重建、本地身份隔离、TTL/LRU/容量、慢订阅者与缓存重置。
- 未捕获的匹配 HTTP 不得借用同一次 native attempt 的旧 effort。
- 官方 SlotRegistry 与 React 中的标签注册/显示/移除、已有反馈项保留、准确消息 ID、刷新补取及不解释 HTML。
- 原生 Gateway 的 Session lookup、未知会话拒绝及会话访问策略约束。

这些测试使用合成 SSE，不冒充真实上游验证。

## 当前运行环境：已验证

最终安装版本为 0.1.1；通过当前 GUI 的正常登录入口和原生 `/api/remote.mux` 新建只读订阅，没有读取账号凭据文件。

1. 真实 `cpa / anyrouter/gpt-6-astra` 响应报告 `effort: high`。
2. 后端观测条目的 messageId 能在当前会话已落盘的 `assistant/message` 中找到；两侧 responseId 精确相同。
3. effort 没有被插件加入持久 assistant 元数据或 replayState。
4. 两个独立的新 Remote 订阅取得同一 generation，并能重新取得内存条目。
5. 当前 GUI 启动 HTML 包含本插件声明。
6. 初次部署的真实关闭测试显示 generation 改变、items 变为空；随后恢复启用。最终修订未改变缓存关闭逻辑，该逻辑也在自动化测试中通过。
7. 安装前后比对，既有 profile 配置前缀、依赖、bundle、pnpm 策略和已有 package snapshot 未变化，差异仅限本插件。

这是一份一次性验收摘要，不是插件持续落盘观测数据的功能。

## 未完成的真实页面验收

**浏览器 CDP 端点 `127.0.0.1:9222` 不可连接，当前页面的 DOM、外观、悬浮和点击行为未实测。** 原生组件测试通过、HTML 广告了插件，均不能代替实际浏览器渲染验证。

按照批准计划没有为此启动替代 GUI，也没有自动重启任何服务。

用户可刷新现有 DSH 页面，在插件启用后完成的新回复下方查看原生操作栏：应显示 `effort: high` 等服务端值；旧回复、未捕获或已淘汰的数据不会补出标签。仍受原生操作栏 hover/显隐规则影响。

## 环境提示

- pnpm 报告的 peer 提示属于既有 `@lolkda/dsh-prompt-manager@3.5.0` 缺少 `@deepseek-ai/cordis-plugin-loader@1.0.5`；未为此修改无关依赖或全局策略。
- 此目录不是 Git 仓库，笔记校验跳过 Git append-only 对照，格式/目录/归档文件哈希校验正常执行；没有创建提交。

## 停用与回滚

在原生插件管理器禁用/移除 `dsh-response-effort`，或把其自身配置 `enabled` 设为 false。移除时仅移除本插件及自己的配置，不整体覆盖其他 profile 修改。观测内存会被清空，插件不会从磁盘恢复历史 effort。
