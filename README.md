# dsh-response-effort

在 DSH **输入框上方**及时查看每次匹配的 Responses SSE 返回的 `response.reasoning.effort`，展开查看逐次记录，并保留最终回复操作栏的消息标签。这是服务端报告值，不是对模型内部实际推理量的测量。

## 兼容范围

- 插件 `0.2.1`；DSH `0.2.0-rc.2`，Node.js 24+，Web 客户端。
- 仅 POST Responses SSE，读取 `response.completed`、`response.incomplete`、`response.failed`。
- 可用于通过 Responses 协议提供的任意模型，不限定 OpenAI 模型。
- 不支持 Chat Completions、Anthropic Messages、WebSocket、普通 JSON 响应。
- 不修改 DSH/pi-ai 文件、模型请求参数、上游 baseURL 或重试策略。

## 安装与配置

```sh
npm ci --ignore-scripts
npm run check
npm pack --ignore-scripts
# 将生成的 tgz 路径交给 DSH 原生管理器：
dsh plugin --profile web add /absolute/path/dsh-response-effort-0.2.0.tgz --ignore-scripts
```

bundle 默认 `enabled: false`、`targets: []`。安装后还需要在本插件配置中打开观测并明确白名单，例如：

```yaml
- id: response-effort
  name: dsh-response-effort
  config:
    enabled: true
    targets:
      - provider: cpa
        url: http://localhost:8317/v1/responses
```

`url` 必须替换为该 provider 实际使用的完整 Responses 地址，不是仅填写 baseURL。允许 HTTP/HTTPS，禁止凭据、query、fragment；provider、POST 方法、请求 URL、响应 MIME 与最终响应 URL 必须匹配。变更端点后要同步白名单；未匹配不会被误标为“未返回”。

用原生插件管理器配置、禁用或移除本插件。**是否立即生效以管理器的 application 结果为准**；如果返回 `restart-required`，需要操作者重启 DSH，而不是只刷新页面。不应通过改模型协议来使插件命中。

0.2.0 的 Remote 快照增加必需的 `responses` 数组，Host/Client 必须一起升级；不支持新旧版本混用。插件重载会清空观测内存；没有历史数据回填。

## 输入框上方：逐次响应

原生位置为 `conversation.input.dock`，追加在待办、目标和队列之后，不替换原生内容。

```text
最近响应：effort: high · 响应 #28       查看记录 ▾
```

- 每条代表一次 SSE 请求的观测结果，不是其中每个 token 事件。
- 解析到合法终态后立即发布，**不等待消息提交或整轮任务完成**。若服务器只在终态返回 effort，就不能在请求刚开始时知道它。
- 摘要始终称“最近响应”，不是当前请求的设置。只有当前会话存在观测记录时显示；连接中、无记录、断线或订阅失败时完全隐藏，不占位。已捕获但未返回字段或无法确认的记录仍可查看。记录保留期间不因本轮结束而隐藏。
- 卡片采用与 goal 同类的紧凑行高、内缩宽度与主题配色；点击整行展开，清空后再次出现时恢复折叠。
- 默认折叠。展开按最近完成顺序查看响应编号、完成时间、effort、终态、provider/model；滚动区高度有界，每次可多展开 20 条。
- 编号是该会话当前内存段的响应序号；记录全部清空或被淘汰后重新编号，**不是整轮请求总数**。
- 失败重试、没有形成最终消息的响应和同一 attempt 的多个请求分别收录；使用本地 capture ID，不以可能重复的上游 response ID 去重。
- 只显示能归属到当前 sessionId 的观测；没有 sessionId 的辅助调用不显示，其他会话不会混入。

| 观测结果 | 状态栏 |
| --- | --- |
| 合法终态返回非空字符串 effort | `effort: max` 等原值 |
| 合法终态缺失该字段或为 null | `effort: 未返回` |
| 已开始观测但无终态、格式错误、旁路超时/超限 | `无法确认`，可查看原因 |
| 未命中白名单、不支持的协议、未观测或并发限额跳过 | 不产生逐次记录 |
| 尚无保留记录、连接中或订阅不可用 | 完全隐藏，不占位 |

因此这是**有界观测记录，不是完整网络审计日志**。工具自身的 HTTP 请求不在模型请求作用域中，不会计入。

## 最终回复下方：消息标签

保留 `conversation.chat.assistant-actions` 原生插槽：整轮结束后，最后一条有正文的 assistant 回复下方显示标签，跟随原生 hover/显隐规则。

消息标签只查询自身 messageId。没有可靠归属、观测未知或缓存已淘汰时不显示；不取整轮最大值，不拿最近请求值补缺。请求 high、响应 max 时展示 max，绝不使用请求参数猜值。

## 内存与隐私边界

- 不保存原始 SSE、prompt、回复正文、认证头或凭据；不向会话日志添加 effort。
- 不使用 localStorage、IndexedDB 或磁盘缓存。
- 消息映射与逐次记录是两个独立有界内存池，状态栏与消息标签共享每会话一个原生 Remote 订阅。
- 刷新/切换会话可取得尚未淘汰的条目；后端重启、插件关闭/卸载后清空。generation 隔离旧状态。
- 原生 attempt 身份由 Agent 实例生命周期隔离，不依赖上游 response ID 必须存在。

默认 `limits`：

| 配置 | 默认值 |
| --- | ---: |
| maxConcurrent | 8 |
| maxResponseBytes | 16777216 |
| maxEventBytes | 1048576 |
| maxObserveMs | 600000 |
| maxEffortChars | 256 |
| pendingMs | 120000 |
| maxEntries | 2000 |
| maxSessionEntries | 200 |
| ttlMs | 21600000 |

`maxEntries`、`maxSessionEntries`、`ttlMs` **分别应用于两个池**，即默认最多 2000 条消息映射加 2000 条响应记录，每会话各最多 200 条，绝对 TTL 6 小时。访问不延长 TTL；长期任务会淘汰旧记录。慢订阅者只保留最新快照，不积累无限更新队列。

所有限额必须是正安全整数；maxObserveMs 不超过 2147483647，maxEffortChars 不超过 4096，maxSessionEntries 不超过 10000，超出时拒绝加载。读取限额/超时只停止旁路，不取消主模型响应。待关联超时从原生 attempt 结算后计算；attempt 记录另受总数量限制。

## 技术限制

这是运行时 fetch 包装，不是官方 raw-SSE hook。SDK 如果改用已缓存 fetch、自定义 transport 或 WebSocket，可能绕过插件。升级 DSH 时应重新验收。多个 fetch 包装器共存时，卸载只恢复自己仍拥有的全局指针；留在其他包装器调用链里的旧包装器变为透传。

Responses 的 `reasoning.summary` 本版不采集。`reasoning_tokens` 为 0 不能用来否认响应报告的 effort。

## npm 发布（维护者）

npm 包 `dsh-response-effort` 为公开包；GitHub 源仓库保持私有。公开包包含构建产物、声明文件及当前构建生成的 source maps，并不对这些内容保密。

[发布工作流](.github/workflows/publish.yml)使用 GitHub-hosted runner、Node 24 与 npm 11.19.0，通过 OIDC 发布，不需要 `NPM_TOKEN` / `NODE_AUTH_TOKEN` secret。私有源仓库不支持 npm provenance，因此明确关闭 provenance；这不影响 OIDC 认证。

首次发布需要维护者 `npm login --auth-type=web` 并手动发布当前版本，之后在 npm 包 Settings → Trusted Publisher 绑定：

- Provider：GitHub Actions
- Organization or user：`lolkda`
- Repository：`dsh-response-effort`
- Workflow filename：`publish.yml`（不是完整路径）
- Environment name：留空
- Allowed actions：启用直接 `npm publish`（仅允许 staged publish 不够）

新建的 Trusted Publisher 必须在两天内完成首次成功发布。后续稳定版本发布：

```sh
npm version patch --no-git-tag-version
# 同步本文兼容版本及安装示例后，运行完整检查并提交版本变化。
npm run check
git add package.json package-lock.json README.md
git commit -m "Release <version>"
git tag "v$(node -p 'require("./package.json").version')"
git push origin main
git push origin "v$(node -p 'require("./package.json").version')"
```

只有 `vX.Y.Z` 标签与包版本及锁文件一致时才发布；不支持通过此工作流发布 prerelease。工作流重新安装锁定依赖、完整检查、打包并验证文件白名单后，发布刚检查过的 tarball。已存在版本不能覆盖，失败时不会自动改版本或回退到长期 token。

Actions 中手动运行 **Publish npm** 仅执行检查和打包，绝不发布；日常主分支推送不会触发 npm 发布。首次初始化流程为手动发布 0.2.1、绑定 Trusted Publisher、仅升级发布版本至 0.2.2 后运行一次真实 OIDC 发布。

## 开发与验证

```sh
npm run check
```

包含类型检查、Host/Client 构建、测试与笔记门禁。测试使用合成 SSE；包括真实 pi-ai/OpenAI SDK、生产 AgentLoop、原生 Gateway/ClientRemoteService/SlotRegistry，以及状态栏展开、逐次更新、隔离、淘汰、重载和断线清理。测试通过不等于真实页面已验证，部署状态另行记录。

Client 复用宿主 React，只通过原生插槽、主题令牌和 locale 服务接入；不导入 Harness Client 的运行时代码。Remote 仅暴露经原生 Session lookup 的只读内存快照流，未新增模型工具或独立网络服务器。
