/* Generates configuration only. Never edits a client's existing settings. */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=__dirname,portable=path.join(root,'runtime','node.exe');
const entry={command:fs.existsSync(portable)?portable:process.execPath,args:[path.join(root,'mcp-server.cjs')],env:{SCORE_DESK_MCP_PORT:'13125'}};
const config={mcpServers:{'local-score-desk':entry}};
fs.writeFileSync(path.join(root,'MCP客户端配置.json'),JSON.stringify(config,null,2));
fs.writeFileSync(path.join(root,'MCP单服务配置.json'),JSON.stringify(entry,null,2));
process.stdout.write('已生成：'+path.join(root,'MCP客户端配置.json')+'\n\n'+JSON.stringify(config,null,2)+'\n\n在 AI 客户端中添加此 stdio 服务即可。未修改任何客户端现有设置。\n工具包移动位置后，请重新生成配置并更新客户端。\n');
