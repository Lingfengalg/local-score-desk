# AI / MCP（可选）

普通录入不需要 Node.js，也不需要联网。只有接入外部 AI 客户端时才运行 MCP。

1. 安装 Node.js 22 或更高版本，解压仓库到固定目录。
2. 在项目目录执行 `npm run mcp:config`，或双击 `mcp/生成客户端配置.cmd`。
3. 把生成的 `mcp/MCP客户端配置.json` 中 local-score-desk 一项合并到 AI 客户端配置，不要覆盖其他服务。
4. 在客户端启用服务；打开主应用的 **AI / MCP → 连接 AI 机器人 / MCP**，选择 `%LOCALAPPDATA%\LocalScoreDeskMCP\connection.json` 并授权。非 Windows 默认路径为 `~/.local/share/LocalScoreDeskMCP/connection.json`。
5. 让 AI 查询信息或提出变更，在页面审核草稿、勾选确认后写入。

移动目录后请重新生成配置。生成的客户端配置、连接文件及令牌不提交仓库、不转发。服务通过 stdio 运行；13125 端口仅是本机页面桥接，不是 MCP HTTP 地址。同一时间只连接一个页面，刷新或更换班级后重新授权。

## 可用工具

- workspace_summary：班级概况
- students_search / student_get：学生查询
- rules_search / rule_get：规则查询
- score_explain：计分解释
- tasks_list：待处理事项
- changes_propose / changes_get / changes_discard：变更草稿

没有自动提交、人工审批、执行脚本或任意文件读写工具。奖项草稿需人工审核后才计分。工具定义和参数校验见 `src/tool-contract.cjs`；服务入口见 `mcp/mcp-server.cjs`。

可用环境变量：`SCORE_DESK_MCP_PORT`（默认 13125）、`SCORE_DESK_MCP_STATE_DIR`（连接文件保存目录）。页面内也提供兼容 Chat Completions 的可选模型接口；密钥仅在当次页面内存中使用。
