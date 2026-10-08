# Agent Note: 私有仓库的 npm OIDC 发布

Status: implemented

## Problem

插件已有本地构建和测试，但没有 npm 包及自动发布入口。用户确认公开发布 `dsh-response-effort`，GitHub 仓库 `lolkda/dsh-response-effort` 保持私有，并要求真实验证 OIDC，而不是只提交一份未经运行的 YAML。

## Decision

新增 `.github/workflows/publish.yml`：GitHub-hosted Ubuntu runner、Node 24、npm 11.19.0、固定 SHA 的官方 Actions。只在推送与包版本严格一致的稳定版 `vX.Y.Z` 标签后发布；手动运行仅检查，不发布。使用 `contents: read` 和发布 job 的 `id-token: write`，不设置 npm token secret，不保存 checkout 凭据，不使用依赖缓存。

发布前执行锁文件安装、`npm run check`、包名/版本/标签/仓库/发布目标校验和打包检查。包只发往 npm 官方 registry，access 为 public，保持原有包文件白名单。包版本已存在或任一步失败时停止，不尝试覆盖。主分支推送不自动发布；不新增 GitHub Release，不改插件运行逻辑或宿主配置。

首次由维护者网页登录发布 0.2.1，以便在 npm 包设置中绑定 `lolkda` / `dsh-response-effort` / `publish.yml`。绑定允许直接 `npm publish`，不指定 GitHub environment。再仅提升发布版本为 0.2.2，通过标签触发真实 OIDC 发布。临时 npm CLI 登录放在 Git 元数据目录，完成后退出并清理，不进入仓库或 Actions。

根据 [npm Trusted Publishing 文档](https://docs.npmjs.com/trusted-publishers/)，私有源仓库可以使用 OIDC，但不支持 provenance；发布显式关闭 provenance，不把仓库公开当作修复。新建的 Trusted Publisher 须在两天内首次成功发布。

## History audit

已检索现有活跃笔记中的 npm、发布、OIDC 和 GitHub 关键词。唯一的 [Responses effort 功能笔记](../../implemented/feature/2026-10-07-response-effort-v1.md)解释插件运行行为和本地安装，属于无关的既有决策；本篇只负责新增发布流程，不取代它。

## Alternatives considered

- 长期 npm 发布 token：最容易复用旧 CI 配置，也能用于多种 runner；但用户要求 OIDC，长期 token 增加保管和撤销负担，因此不创建或保存 Actions 发布 token。
- 将 GitHub 仓库改为公开并开启 provenance：能让用户验证构建来源；但违背用户刚确认的私有仓库要求，因此保持私有并明确没有 provenance。
- 只提交工作流并首次手动发布 0.2.1：能减少一次版本发布；但不能证明 OIDC 绑定实际可用。用户选择再发布仅版本号变化的 0.2.2，取得真实工作流证据。

## Testing

本地 `npm run check` 通过：类型检查、Host/Client 构建、48 项测试和笔记门禁。新增 9 项发布测试覆盖有效标签、手动只检查、版本/锁文件不一致、错误发布目标及敏感或多余文件拒绝。实际 `npm pack` tarball 通过文件白名单检查。

[手动检查运行 37714966303](https://github.com/lolkda/dsh-response-effort/actions/runs/37714966303)成功：GitHub 干净检出、锁文件安装、完整检查和实际打包通过；`Publish with OIDC` 步骤确认为 skipped。仓库 Actions secrets 列表为空。

npm 账号 `lolkda` 完成网页登录与发布二次验证，首次 `0.2.1` 发布命令成功。npm 非交互发布遇到 EOTP 时不会完成网页验证；本次通过交互终端取得官方验证链接，由维护者在浏览器确认后完成，不收集密码或 OTP。

Trusted Publisher 绑定以及无 npm token 的 `0.2.2` 标签发布尚待完成，尚不宣称 OIDC 实际发布成功。

## Consequences

发布流程不保管长期 npm token，版本和包文件错误能在发送至 registry 前被拦截；代价是首次包创建及信任关系配置仍需维护者协作，并需额外一次 0.2.2 发布验证真实 OIDC。

首次 npm 登录、发布的二次验证以及 Trusted Publisher 设置需要维护者协作；浏览器 CDP 当前不可连接，不绕过登录或 2FA。公开 npm 包会公开其构建产物（现有构建也包含 source maps），即使 GitHub 仓库保持私有。工作流静态检查和本地 dry-run 不能代替真实 OIDC 发布验收。
