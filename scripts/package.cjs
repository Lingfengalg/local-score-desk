'use strict';

// Release-only tooling. JSZip is a build-time dependency, never an application dependency.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {buildArtifact, atomicWrite} = require('../build.cjs');
const buildManifest = require('../build/manifest.cjs');
const {readManifest, captureBinding} = require('./test-all.cjs');
const repository = path.resolve(__dirname, '..');
const suiteManifest = path.join(repository, 'tests/test-manifest.cjs');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const NAMES = Object.freeze({
  html: '综测管理器_独立版.html', app: '综测管理器_独立应用.zip',
  mcp: '综测管理器_MCP工具包.zip', source: '综测管理器_源码.zip',
  readme: '综测管理器_开始使用.txt', notes: '综测管理器_v2_发行说明.txt',
  manifest: '综测管理器_发行清单.json'
});

function parseArgs(args) {
  const options = {
    out: path.join(repository, 'release'), html: path.join(repository, 'index.html'),
    report: path.join(repository, 'test-results/verified.json'), runtime: null,
    checkOnly: false, maxAgeHours: 24
  };
  for (const arg of args) {
    if (arg === '--check-only') options.checkOnly = true;
    else {
      const match = /^--(out|html|report|runtime|max-age-hours)=(.+)$/.exec(arg);
      if (!match) throw Error('Unknown package option: ' + arg);
      if (match[1] === 'max-age-hours') options.maxAgeHours = Number(match[2]);
      else {
        if (!path.isAbsolute(match[2])) throw Error('--' + match[1] + ' must be an absolute path');
        options[match[1]] = path.resolve(match[2]);
      }
    }
  }
  if (!Number.isFinite(options.maxAgeHours) || options.maxAgeHours <= 0 || options.maxAgeHours > 168) throw Error('Fresh report age must be 0–168 hours');
  if (options.out === repository || options.out === path.join(repository, 'src')) throw Error('Choose a dedicated release directory');
  return options;
}

function validateReport(report, {entries, now = Date.now(), maxAgeHours = 24} = {}) {
  if (!Array.isArray(entries) || !entries.length) throw Error('The current full test manifest is required');
  if (!report || report.format !== 'score-desk-test-run-1' || report.status !== 'passed' || report.complete !== true || report.fullSuite !== true || report.group !== 'all') {
    throw Error('A successful, complete, full-suite runner report is required');
  }
  if (!Array.isArray(report.errors) || report.errors.length) throw Error('Runner report contains errors');
  const started = Date.parse(report.startedAt), completed = Date.parse(report.completedAt);
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started || completed > now + 5000 || now - completed > maxAgeHours * 3600000) {
    throw Error('Runner report is expired or has invalid timestamps; run the full suite again');
  }
  const ids = entries.map(entry => entry.id);
  if (!same(report.selectedSuiteIds, ids) || !Array.isArray(report.suites) || report.suites.length !== entries.length) throw Error('Report does not cover the current canonical test manifest');
  for (let i = 0; i < entries.length; i++) {
    const suite = report.suites[i];
    if (suite.id !== entries[i].id || suite.script !== entries[i].script || suite.status !== 'passed' || suite.exitCode !== 0 || suite.signal || !Number.isSafeInteger(suite.passCount) || suite.passCount < 1) {
      throw Error('A test suite is missing or incomplete: ' + entries[i].id);
    }
  }
  if (report.passCount !== report.suites.reduce((total, suite) => total + suite.passCount, 0)) throw Error('Report PASS count is inconsistent');
  return report;
}

function verifyReport(options) {
  const reportBytes = fs.readFileSync(options.report);
  const report = JSON.parse(reportBytes);
  const entries = readManifest(suiteManifest, 'all');
  validateReport(report, {entries, maxAgeHours: options.maxAgeHours});
  const current = captureBinding({html: options.html, manifest: suiteManifest, entries, root: repository});
  if (!same(report.before, report.after) || !same(report.before, current)) throw Error('Report is stale: source, HTML, rules, contract, builder, MCP or tests changed');
  return {report, reportSha256: sha256(reportBytes), binding: current, entries};
}

function assertUnchanged(initial, current) {
  if (!same(current.binding, initial.binding) || current.reportSha256 !== initial.reportSha256) throw Error('Release inputs or the verified report changed while packaging');
}

function brandLocal(text) {
  for (const [from, to] of buildManifest.brands.local.replacements) text = text.replaceAll(from, to);
  return text.replaceAll(buildManifest.brands.public.connectionHelp, buildManifest.brands.local.connectionHelp);
}

function readRuntime(options) {
  const candidates = options.runtime ? [options.runtime] : [
    path.join(options.out, '综测管理器_MCP工具包/runtime'), path.join(repository, 'vendor/node-win-x64')
  ];
  const root = candidates.find(candidate => ['node.exe', 'LICENSE.node.txt', 'SHASUMS256.txt'].every(file => fs.existsSync(path.join(candidate, file))));
  if (!root) throw Error('Provide --runtime=<directory containing node.exe, LICENSE.node.txt and official SHASUMS256.txt>');
  const node = fs.readFileSync(path.join(root, 'node.exe'));
  const license = fs.readFileSync(path.join(root, 'LICENSE.node.txt'));
  const sums = fs.readFileSync(path.join(root, 'SHASUMS256.txt'));
  const expected = sums.toString('utf8').match(/^([a-f0-9]{64})\s+\*?win-x64\/node\.exe\s*$/im)?.[1].toLowerCase();
  if (!expected || sha256(node) !== expected) throw Error('Portable Node does not match the accompanying official win-x64/node.exe SHA256');
  if (node.subarray(0, 2).toString('ascii') !== 'MZ' || license.length < 1000) throw Error('Portable runtime or license is incomplete');
  return {node, license, sums, sha256: expected};
}

function canonicalSources() {
  const files = [...new Set([buildManifest.shell, ...buildManifest.slots.flatMap(slot => slot.files)])];
  const out = new Map([['build.cjs', fs.readFileSync(path.join(repository, 'build.cjs'))], ['build/manifest.cjs', fs.readFileSync(path.join(repository, 'build/manifest.cjs'))]]);
  for (const name of files) out.set(name, fs.readFileSync(path.join(repository, name)));
  return out;
}

function sourceFiles(publicBuild, verification, entries) {
  const files = canonicalSources();
  const names = [
    'README.md', 'package.json', '.gitignore', '.gitattributes',
    'scripts/test-all.cjs', 'scripts/package.cjs', 'tests/test-manifest.cjs',
    'tests/qa-paths.mjs', 'tests/ui-test-helpers.mjs', 'tests/sample-expected.json',
    'mcp/mcp-server.cjs', 'mcp/tool-contract.cjs', 'mcp/generate-mcp-config.cjs', 'mcp/生成客户端配置.cmd',
    ...entries.map(entry => entry.script)
  ];
  for (const name of names) {
    const target = path.join(repository, name);
    if (fs.existsSync(target)) files.set(name, fs.readFileSync(target));
  }
  for (const item of fs.readdirSync(path.join(repository, 'docs'), {withFileTypes: true})) {
    if (item.isFile() && /\.(md|html)$/i.test(item.name)) files.set('docs/' + item.name, fs.readFileSync(path.join(repository, 'docs', item.name)));
  }
  files.set('index.html', Buffer.from(publicBuild.html));
  files.set('发行验证.json', Buffer.from(JSON.stringify(verification, null, 2) + '\n'));
  return files;
}

function mcpFiles(localBuild, runtime, verification, readme) {
  const files = new Map();
  const sourceContract = fs.readFileSync(path.join(repository, 'src/tool-contract.cjs'));
  if (!sourceContract.equals(fs.readFileSync(path.join(repository, 'mcp/tool-contract.cjs')))) throw Error('Canonical MCP and browser contracts have drifted');
  for (const name of ['mcp-server.cjs', 'generate-mcp-config.cjs']) files.set(name, Buffer.from(brandLocal(fs.readFileSync(path.join(repository, 'mcp', name), 'utf8'))));
  files.set('tool-contract.cjs', Buffer.from(brandLocal(sourceContract.toString('utf8'))));
  const C = require('../src/tool-contract.cjs');
  files.set('工具定义.json', Buffer.from(brandLocal(JSON.stringify({version: C.version, instructions: C.instructions, tools: C.tools}, null, 2))));
  files.set('给AI机器人的说明.txt', Buffer.from('\ufeff' + brandLocal(C.instructions) + '\n\n所有写入仅成为草稿；请用户回原页面逐项检查并人工确认。工具不能登记老师核对、修改规则或执行任意脚本。\n'));
  files.set('开始使用.txt', Buffer.from('\ufeff' + readme));
  files.set('接口与安全边界.md', Buffer.from(brandLocal(fs.readFileSync(path.join(repository, 'docs/ai-mcp.md'), 'utf8'))));
  files.set('生成客户端配置.cmd', Buffer.from('@echo off\r\nchcp 65001 >nul\r\nsetlocal\r\nif exist "%~dp0runtime\\node.exe" (\r\n "%~dp0runtime\\node.exe" "%~dp0generate-mcp-config.cjs"\r\n) else (\r\n node "%~dp0generate-mcp-config.cjs"\r\n)\r\nif errorlevel 1 echo Please use the complete Windows x64 package or install Node.js 22+.\r\npause\r\n'));
  files.set('打开连接文件夹.cmd', Buffer.from('@echo off\r\nif exist "%LOCALAPPDATA%\\BUPTScoreMCP" (\r\n explorer.exe "%LOCALAPPDATA%\\BUPTScoreMCP"\r\n) else (\r\n echo Enable bupt-score in your MCP client first.\r\n pause\r\n)\r\n'));
  files.set('runtime/node.exe', runtime.node);
  files.set('runtime/LICENSE.node.txt', runtime.license);
  files.set('runtime/SHASUMS256.txt', runtime.sums);
  files.set('runtime/运行时来源.txt', Buffer.from('Node.js Windows x64\nOfficial distribution: https://nodejs.org/dist/\nSHA256 win-x64/node.exe: ' + runtime.sha256 + '\nVerified against the accompanying SHASUMS256.txt. License is included.\n'));
  for (const [name, contents] of canonicalSources()) files.set('web-source/' + name, contents);
  files.set('web-source/' + NAMES.html, Buffer.from(localBuild.html));
  files.set('web-source/build-html.cjs', Buffer.from("'use strict';\nconst path=require('node:path');\nrequire('./build.cjs').main(['--brand=local','--out='+path.join(__dirname,'综测管理器_独立版.html'),...process.argv.slice(2)]);\n"));
  files.set('发行验证.json', Buffer.from(JSON.stringify(verification, null, 2) + '\n'));
  return files;
}

async function zipFiles(JSZip, files, prefix = '') {
  const zip = new JSZip();
  for (const [name, data] of [...files].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    zip.file(prefix + name, data, {date: new Date('2000-01-01T00:00:00Z'), createFolders: false, unixPermissions: 0o644});
  }
  const data = await zip.generateAsync({type: 'nodebuffer', platform: 'UNIX', compression: 'DEFLATE', compressionOptions: {level: 6}});
  const checked = await JSZip.loadAsync(data);
  const archived = Object.values(checked.files).filter(file => !file.dir);
  if (archived.length !== files.size) throw Error('ZIP entry count mismatch');
  for (const [name, wanted] of files) {
    const entry = checked.file(prefix + name);
    if (!entry || !(await entry.async('nodebuffer')).equals(wanted)) throw Error('ZIP round-trip mismatch: ' + name);
  }
  return data;
}

async function packageRelease(options) {
  const verified = verifyReport(options);
  const publicBuild = buildArtifact({root: repository, brand: 'public'});
  const localBuild = buildArtifact({root: repository, brand: 'local'});
  if (publicBuild.report.rulesSemanticSha256 !== localBuild.report.rulesSemanticSha256 || publicBuild.report.samplesSemanticSha256 !== localBuild.report.samplesSemanticSha256) throw Error('Branding changed rule/sample semantics');
  const runtime = readRuntime(options);
  let JSZip;
  try { JSZip = require('jszip'); } catch { throw Error('Release tooling requires build-only JSZip; install it locally or set NODE_PATH to the bundled build dependencies'); }
  const version = JSON.parse(fs.readFileSync(path.join(repository, 'package.json'), 'utf8')).version;
  const verification = {
    format: 'score-desk-release-verification-1', version, verifiedAt: verified.report.completedAt,
    reportSha256: verified.reportSha256, passCount: verified.report.passCount,
    suites: verified.report.suites.map(({id, passCount}) => ({id, passCount})),
    testedBinding: verified.binding, publicBuild: publicBuild.report, localBuild: localBuild.report,
    portableNodeSha256: runtime.sha256
  };
  const readme = `综测管理器 v${version}\n\n双击“${NAMES.html}”，在 Edge 或 Chrome 普通窗口使用。无需安装办公软件、Node.js 或后台。\n\n日常顺序：管理名单 → 数据录入 → 老师核对 → 导出结果。数据仅保存在当前浏览器；换路径、浏览器或电脑前，先下载完整 JSON 备份，再在新位置恢复。\n已有 JSON 格式、计分规则和老师人工核对边界保持兼容。工作台与“大字”等显示变化不会代替材料核验。\n\nAI / MCP 完全可选：\n1. 解压“综测管理器_MCP工具包.zip”到固定目录，双击“生成客户端配置.cmd”。Windows x64 包已带经 SHA256 核验的 Node.js。\n2. 把生成配置中的 bupt-score 合并到 MCP 客户端配置，不覆盖其他服务；启用后在 HTML 的 AI / MCP 中明确授权，选择 %LOCALAPPDATA%\\BUPTScoreMCP\\connection.json。\n3. AI 只提交草稿；回原页面检查内容、依据，人工确认后才写入。奖项仍须人工审核，老师核对不会由 AI 自动登记。\n移动工具包后重新生成配置。13125 是本机私有桥接端口，不是 MCP HTTP 服务地址。环境变量沿用 BUPT_MCP_PORT / BUPT_MCP_STATE_DIR。\n\n本包不会创建开机自启，不会自动启动 MCP、浏览器或其他程序。\n`;
  const notes = `v${version} 发行说明\n\n采用单一 canonical 源码构建公开版与本地版；不再把旧 standalone 镜像作为发行输入。\n页面从加载顺序包装转为显式视图管线与启动入口；工作台保留名单、录入、老师核对的基本动线。\n计分规则、JSON 备份兼容性和 AI 人工确认边界不因本轮界面/工程重构改变。\n\n本次完整测试：${verified.report.passCount} 项实时 PASS，${verified.report.suites.length} 个测试套件。测试报告、源码、HTML、规则、契约和测试清单哈希在发行前重新核对。该检查不等同于所有浏览器或无障碍场景的认证。\n\n源码包为可重建的公开仓库快照；MCP 包 web-source 使用相同 build.cjs、manifest 和 src，运行 build-html.cjs 可重建字节一致的本地 HTML。构建与应用运行无第三方依赖；完整浏览器测试使用 Playwright，ZIP 制作仅构建时使用 JSZip。\n`;
  const proof = Buffer.from(JSON.stringify(verification, null, 2) + '\n');
  const app = new Map([[NAMES.html, Buffer.from(localBuild.html)], [NAMES.readme, Buffer.from('\ufeff' + readme)], [NAMES.notes, Buffer.from('\ufeff' + notes)], ['发行验证.json', proof]]);
  const portable = mcpFiles(localBuild, runtime, verification, readme);
  const source = sourceFiles(publicBuild, verification, verified.entries);
  const outputs = new Map([
    [NAMES.html, Buffer.from(localBuild.html)],
    [NAMES.app, await zipFiles(JSZip, app)],
    [NAMES.mcp, await zipFiles(JSZip, portable, '综测管理器_MCP工具包/')],
    [NAMES.source, await zipFiles(JSZip, source, 'local-score-desk/')],
    [NAMES.readme, Buffer.from('\ufeff' + readme)], [NAMES.notes, Buffer.from('\ufeff' + notes)]
  ]);
  // Compression can take time. Recheck the report and complete binding before any write.
  const finalVerification = verifyReport(options);
  assertUnchanged(verified, finalVerification);
  const release = {
    format: 'score-desk-release-1', version, verifiedAt: verification.verifiedAt,
    reportSha256: verification.reportSha256, passCount: verification.passCount,
    localHtmlSha256: localBuild.report.htmlSha256, publicHtmlSha256: publicBuild.report.htmlSha256,
    sourceSha256: localBuild.report.sourceSha256, rulesSha256: localBuild.report.rulesSha256,
    contractSha256: localBuild.report.contractSha256, portableNodeSha256: runtime.sha256,
    files: Object.fromEntries([...outputs].map(([name, contents]) => [name, {bytes: contents.length, sha256: sha256(contents)}]))
  };
  if (!options.checkOnly) {
    fs.mkdirSync(options.out, {recursive: true});
    for (const [name, contents] of outputs) atomicWrite(path.join(options.out, name), contents);
    for (const [name, contents] of outputs) {
      if (sha256(fs.readFileSync(path.join(options.out, name))) !== sha256(contents)) throw Error('Release read-back mismatch: ' + name);
    }
    atomicWrite(path.join(options.out, NAMES.manifest), JSON.stringify(release, null, 2) + '\n');
  }
  const summary = {action: options.checkOnly ? 'checked-only' : 'packaged', out: options.out, ...release};
  // Programmatic verification can inspect the already-checked archives without
  // writing or recompressing them. CLI JSON contains only the small release manifest.
  Object.defineProperty(summary, 'artifacts', {value: outputs, enumerable: false});
  return summary;
}

async function main(args = process.argv.slice(2)) {
  if (args.includes('--help')) {
    console.log('node scripts/package.cjs [--check-only] [--report=<absolute full-run JSON>] [--html=<absolute tested HTML>] [--out=<absolute release directory>] [--runtime=<absolute Node runtime directory>] [--max-age-hours=24]');
    return;
  }
  const result = await packageRelease(parseArgs(args));
  console.log(JSON.stringify(result, null, 2));
  return result;
}

module.exports = {NAMES, parseArgs, validateReport, verifyReport, assertUnchanged, brandLocal, readRuntime, canonicalSources, zipFiles, packageRelease, main};
if (require.main === module) main().catch(error => { console.error('Release refused: ' + error.message); process.exitCode = 1; });
