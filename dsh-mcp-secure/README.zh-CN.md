# Strique DSH MCP Client

代码仓库由 DigiStrique Solutions 维护。为兼容现有安装，插件包名继续使用 `dsh-mcp-manager-secure`，状态目录保持独立。尚未发布到 npm。

本项目是 `hyqhyq3/dsh-mcp-manager` 0.6.0（提交 `69d5cbc`）的本地安全修复分支，包名为 `dsh-mcp-manager-secure`，版本为 0.9.2，尚未发布到 npm。

在 **Settings > MCP (Secure)** 中管理 HTTP 和 stdio MCP 服务器。支持无认证、自定义请求头、环境变量令牌和基于 MCP SDK 的 OAuth / PKCE。服务器必须支持相应的 MCP 协议和认证方式，任意网址并不一定可用。

当前开发分支的验证目标为 Harness `0.2.1-rc.2`、Cordis `4.0.5`、MCP SDK `1.29.0`。插件依赖 `tools`、`webServer`、`connection`、`agents`，旧版没有认证服务的 Harness 无法激活。

工作区的 `.dsh/dshmm/mcp.json` 只提出配置，必须在已认证的设置页面批准具体配置后才能启动。修改文件会撤销原有批准；在设置页面保存工作区配置会批准该配置。stdio 子进程只继承最小环境变量，但仍拥有当前操作系统账户的文件和网络权限，并非沙箱。

令牌绑定完整 MCP URL。管理 API 不返回原始请求头或环境变量密钥。OAuth 从外部站点返回后可能需要点击 **Continue authorization**，然后利用 Harness 的 Strict Cookie 完成认证。

预注册的公共 OAuth 客户端可通过 Host 配置 `oauthClientIds` 设置：将全局服务器 ID 映射到提供商 App ID，使用 PKCE 并跳过动态注册；不支持客户端密钥。更改 App ID 会清除该客户端的旧凭据，并重置工具权限。Meta 应用仍需启用 MCP 用例、取得所需权限并注册完整回调 URL。

使用 ngrok 等 HTTPS 反向代理时，将 `publicOrigin` 设为准确的 HTTPS 源，并把该主机名加入 Harness Connection 的 `trustedHosts`。从公开 HTTPS 页面开始认证，回调地址为 `<publicOrigin>/mcp-manager/callback/<server-id>`。不信任转发请求头来决定回调源；管理 API 仍要求 Harness 登录。关闭隧道请求检查，避免记录 OAuth 授权码和 Cookie。本地 HTTP 页面继续可用。

状态位于 `$DSH_HOME/mcp-manager-secure/<profile-hash>/state.json`，默认主目录为 `~/.dsh`。目录权限为 `0700`，文件为 `0600`，使用原子替换和单进程写锁。不会自动导入或执行原版配置。

构建与验证：

```sh
pnpm install --ignore-scripts --frozen-lockfile
pnpm check
pnpm test
mkdir -p artifacts
pnpm pack --pack-destination artifacts
```

先用独立测试主目录安装本地 tarball：

```sh
DSH_HOME=/absolute/test-home dsh plugin --profile web add /absolute/path/dsh-mcp-manager-secure-0.9.2.tgz --ignore-scripts
DSH_HOME=/absolute/test-home dsh --profile web --dump-config
DSH_HOME=/absolute/test-home dsh --profile web --port 3198
```

不要同时运行原版和安全版，它们使用相同路由与工具名称。卸载命令为 `dsh plugin --profile web remove dsh-mcp-manager-secure`；卸载保留私有状态，以便重新安装。

完整配置、限制及恢复说明见 [英文 README](README.md)、[安全说明](SECURITY.md) 与 [更新记录](CHANGELOG.md)。测试不会操作真实 Meta Ads 账户。

## 工具权限

在服务器的 **Tool permissions** 页面中，为每个工具选择 **Always allow**（始终允许）、**Ask each time**（每次询问）或 **Block**（阻止）。支持搜索和批量修改当前显示的工具。新工具默认每次询问，即使服务器声明工具为只读。重连和禁用后重新启用会保留权限；修改服务器配置、工具输入/输出结构或执行注解后，相关工具会重新要求审批。仅修改描述或标题（包括结构内的说明文字）会保留原权限。服务器列表和权限行会显示需要重新审核的工具，明确保存权限后提示消失。升级时，旧记录只有在完整定义仍匹配时才保留原选择；已有的 Ask 不会自动恢复为 Allow。过期页面不能覆盖已变更的定义。

审批复用 Harness 的会话审批界面和审计日志。请在对话中检查工具参数，然后选择允许一次或拒绝。缺少审批服务、无交互会话、取消、超时或等待期间权限变更均禁止执行。`approvalTimeoutMs` 默认为五分钟。始终允许仅跳过本管理器的审批，其他 Harness 策略仍然有效。Harness 的 Full access 会关闭审批提示；仍设为 Ask 的工具会被拒绝，错误信息会引导用户重新审核权限或开启审批提示。阻止策略在实际 MCP 调用前执行，同样适用于按需发现工具的间接调用。

## 0.9.3 兼容性

支持 Harness `0.2.1-rc.2`、Cordis `4.0.5` 和 Schemastery `3.18.5`。`engines.dsh` 限定为已验证的 Harness 版本。
