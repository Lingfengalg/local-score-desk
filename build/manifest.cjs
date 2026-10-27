'use strict';

// Source and browser execution order are explicit. AI shares one contract with
// the browser adapter. Generated HTML and private reference PDFs are not inputs.
const manifest = {
  version: 1,
  shell: 'src/shell.html',
  slots: [
    {key: 'STYLE', kind: 'style', files: ['src/style.css', 'src/workbench.css']},
    {key: 'RULES', kind: 'json', files: ['src/rules.json']},
    {key: 'SAMPLES', kind: 'json', files: ['src/samples.json']},
    {key: 'VIEWS', kind: 'script', files: ['src/view-runtime.js']},
    {key: 'ENGINE', kind: 'script', files: ['src/engine.js']},
    {key: 'APP', kind: 'script', files: ['src/app.js']},
    {key: 'WORKFLOW', kind: 'script', files: ['src/workflow.js']},
    {key: 'PERSISTENCE', kind: 'script', files: ['src/persistence.js']},
    {key: 'ENTRY', kind: 'script', files: ['src/ergonomics.js']},
    {key: 'AI', kind: 'script', files: ['src/tool-contract.cjs', 'src/automation.js']},
    {key: 'SIMPLIFY', kind: 'script', files: ['src/simplify.js']},
    {key: 'UX', kind: 'script', files: ['src/usability.js']},
    {key: 'DESK', kind: 'script', files: ['src/workbench.js']},
    {key: 'MOTION', kind: 'script', files: ['src/motion.js']}
  ],
  brands: {
    public: {connectionHelp: '下载并解压仓库，在 mcp 文件夹双击“生成客户端配置.cmd”（需要先安装 Node.js）。'},
    local: {
      connectionHelp: '解压“综测管理器_MCP工具包.zip”，双击其中的“生成客户端配置.cmd”。',
      replacements: [
        ['本地记录工作台', '综测管理器'],
        ['LocalScoreDeskMCP', 'BUPTScoreMCP'],
        ['SCORE_DESK_MCP', 'BUPT_MCP'],
        ['local-score-desk', 'bupt-score']
      ]
    }
  }
};

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
module.exports = freeze(manifest);
