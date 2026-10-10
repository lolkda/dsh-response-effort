# Agent Note: 移除插件的 DSH 版本门禁

Status: implemented

## Problem

当前管理器在 DSH 0.2.1-alpha.2 上以 incompatible-version 拒绝加载 dsh-response-effort 0.2.2：包把 @deepseek-ai/dsh peer 精确锁在 0.2.0-rc.2。用户要求去掉版本限制、更新 GitHub、发布 npm 并安装 registry 版本，而不是为当前 profile 添加版本豁免。

## Decision

发行包删除 @deepseek-ai/dsh peerDependencies 和对应 optional 元数据；Node 24 最低要求不变。0.2.3 保留现有 Host/Client 行为、模型路由、白名单、缓存和 Remote 格式。开发与回归依赖对齐 DSH 0.2.1-alpha.2、Cordis 4.0.5-alpha.1、Schemastery 3.18.5-alpha.1 和当前宿主使用的 pi-ai 1.1.0；开发期锁定不构成安装时的 DSH 版本门禁。不修改插件运行时代码。

沿用现有标签触发的 GitHub Actions OIDC 发布，不改变仓库可见性、provenance 设置或其他插件。部署使用原生 plugin_manager 安装 dsh-response-effort@0.2.3，保留本插件用户配置。管理器若返回 restart-required，必须记录待重启，不能以磁盘文件或插槽存在冒充完整生效。

## History audit

[功能笔记](../feature/2026-10-07-response-effort-v1.md)部分重叠：本篇仅取代其中的精确 DSH 兼容目标，响应观测与 UI 决策仍保留，双方互链。[发布流程笔记](../process/2026-10-08-npm-oidc-publishing.md)描述已有 OIDC 路径，继续复用，不取代。没有其他活跃同主题记录。GitHub API 当前返回 isPrivate=false；README 不再声称源仓库保持私有，本次未改变仓库可见性。

## Alternatives considered

- 仅改为当前 DSH 的精确版本：最容易明确声明已验收范围，但下一次升级仍会阻止加载，不符合用户去掉限制的要求。
- 把 peer 改为 *：保留宿主依赖提示且改动最少，但标准 semver 的通配范围默认不接纳预发布版本，不能表达对 alpha/rc 一并取消门禁。
- 添加 profile 版本豁免：无需重新发布即可在单个运行版本上放行，但不修复 npm 包声明，也不满足安装 npm 新版的要求，因此不改管理器策略。

## Testing

新增发布回归断言包根和 lockfile 根均没有 DSH peer 或其 optional 元数据，同时保留 Node >=24。改动前该测试以实际旧声明 0.2.0-rc.2 失败，移除限制后通过。

当前依赖上的 npm run check 通过：类型检查、Host/Client 构建、49 项测试和笔记门禁。真实 pi-ai SDK + 生产 AgentLoop 的合成 SSE 测试覆盖请求 high/响应 max、精确消息关联、并发 Agent、失败重试和工具续轮；原生 Gateway、ClientRemoteService 与 SlotRegistry 测试覆盖订阅、插槽、重载清理。实时 Inspect 确认两个目标插槽及 llm/stream、agent/assistant-stream 契约仍存在。

旧锁文件与已安装依赖一起参与增量解析时 npm 返回 ERESOLVE，引用旧版 transitive peers。保留旧依赖备份后，干净解析当前声明成功；不使用 force 或 legacy-peer-deps。发布和部署的实际结果另记于 [验收记录](../../../../VERIFICATION.md)，测试通过不代替 registry 发布或运行时生效。

## Consequences

收益是 DSH 升级不再仅因本插件的精确版本声明而被拒绝加载，不需要维护每个 runtime 的版本豁免。代价是取消门禁不承诺任意 DSH 兼容；后续升级仍可能破坏事件、Remote、插槽或 fetch transport，需要重新验收。浏览器 CDP 不可用时不声称视觉或点击验收完成。重载会清空有限内存里的 effort 历史，不增加持久化或回填。
