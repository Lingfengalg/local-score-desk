'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const B = require('../build.cjs');
const manifest = require('../build/manifest.cjs');

let checks = 0;
function test(name, fn) { fn(); checks++; console.log('PASS ' + name); }
const marker = key => '/*__' + key + '__*/';
const hash = text => crypto.createHash('sha256').update(text).digest('hex');

function fixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'score-build-test-'));
  const ownedRoot = path.resolve(root);
  const put = (file, text) => {
    const target = path.resolve(root, file);
    assert.ok(target.startsWith(ownedRoot + path.sep));
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, text, 'utf8');
  };
  const get = file => fs.readFileSync(path.join(root, file), 'utf8');
  try {
    for (const slot of manifest.slots) {
      for (const file of slot.files) put(file, slot.kind === 'json' ? '{}' : slot.kind === 'style' ? '/* ' + file + ' */' : '/* ' + file + ' */\nvoid 0;');
    }
    put('src/rules.json', JSON.stringify({obs: [], dims: [], label: '本地记录工作台'}));
    put('src/samples.json', JSON.stringify([{id: 'SYNTHETIC', name: '本地记录工作台'}]));
    put('src/automation.js', 'globalThis.help=' + JSON.stringify(manifest.brands.public.connectionHelp) + ';\nglobalThis.brand="本地记录工作台 LocalScoreDeskMCP SCORE_DESK_MCP local-score-desk";');
    const scripts = manifest.slots.filter(slot => slot.kind === 'script').map(slot => '<script>' + marker(slot.key) + '</script>').join('\n');
    put(manifest.shell, '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; connect-src https: http://127.0.0.1:* http://localhost:*; base-uri \'none\'; form-action \'none\'"><title>本地记录工作台</title><style>' + marker('STYLE') + '</style></head><body><script>const RULES=' + marker('RULES') + ';const SAMPLES=' + marker('SAMPLES') + ';</script>' + scripts + '<script>void 0;</script></body></html>');
    return fn({root, put, get});
  } finally {
    // This exact mkdtemp directory is the only recursive cleanup target.
    assert.equal(path.resolve(root), ownedRoot);
    assert.equal(path.dirname(ownedRoot), path.resolve(os.tmpdir()));
    assert.ok(path.basename(ownedRoot).startsWith('score-build-test-'));
    fs.rmSync(ownedRoot, {recursive: true, force: true});
  }
}

function dataFrom(html) {
  const context = vm.createContext({});
  vm.runInContext(B.inlineScripts(html)[0], context);
  return JSON.parse(vm.runInContext('JSON.stringify({rules:RULES,samples:SAMPLES})', context));
}

test('public 构建为可重复纯读取，不生成 index', () => fixture(({root}) => {
  const a = B.renderHtml({root}), b = B.renderHtml({root});
  assert.equal(a, b);
  assert.ok(a.includes('<title>本地记录工作台</title>'));
  assert.equal(fs.existsSync(path.join(root, 'index.html')), false);
}));

test('local 同源生成品牌与 MCP 标识，不残留 public 接法文案', () => fixture(({root}) => {
  const html = B.renderHtml({root, brand: 'local'});
  assert.ok(html.includes('<title>综测管理器</title>'));
  assert.ok(html.includes('综测管理器 BUPTScoreMCP BUPT_MCP bupt-score'));
  assert.ok(html.includes(manifest.brands.local.connectionHelp));
  assert.ok(!html.includes(manifest.brands.public.connectionHelp));
}));

test('两种品牌不替换规则或示例 JSON 的任何值', () => fixture(({root, get}) => {
  const a = dataFrom(B.renderHtml({root})), b = dataFrom(B.renderHtml({root, brand: 'local'}));
  assert.deepEqual(a, b);
  assert.deepEqual(a.rules, JSON.parse(get('src/rules.json')));
  assert.deepEqual(a.samples, JSON.parse(get('src/samples.json')));
}));

test('manifest 明确 JS 加载顺序、AI 双源与两份 CSS', () => fixture(({root}) => {
  const html = B.renderHtml({root});
  const ordered = manifest.slots.filter(slot => slot.kind === 'script').flatMap(slot => slot.files);
  let position = -1;
  for (const file of ordered) { const next = html.indexOf('/* ' + file + ' */'); if (file !== 'src/automation.js') { assert.ok(next > position, file); position = next; } }
  assert.ok(html.includes('/* src/style.css */\n/* src/workbench.css */'));
  assert.deepEqual(manifest.slots.find(slot => slot.key === 'AI').files, ['src/tool-contract.cjs', 'src/automation.js']);
  assert.ok(Object.isFrozen(manifest.slots));
}));

test('占位符缺失立即失败', () => fixture(({root, put, get}) => {
  put(manifest.shell, get(manifest.shell).replace(marker('APP'), ''));
  assert.throws(() => B.renderHtml({root}), /exactly one placeholder.*APP/);
}));

test('占位符重复立即失败', () => fixture(({root, put, get}) => {
  put(manifest.shell, get(manifest.shell).replace(marker('APP'), marker('APP') + marker('APP')));
  assert.throws(() => B.renderHtml({root}), /exactly one placeholder.*APP/);
}));

test('未知 shell 标记及源码残留标记均失败', () => {
  fixture(({root, put, get}) => { put(manifest.shell, get(manifest.shell) + marker('TYPO')); assert.throws(() => B.renderHtml({root}), /Unknown shell placeholder/); });
  fixture(({root, put}) => { put('src/app.js', '// ' + marker('TYPO')); assert.throws(() => B.renderHtml({root}), /Unresolved placeholder/); });
});

test('占位符加载顺序错误立即失败', () => fixture(({root, put, get}) => {
  put(manifest.shell, get(manifest.shell).replace(marker('VIEWS'), '@SWAP@').replace(marker('ENGINE'), marker('VIEWS')).replace('@SWAP@', marker('ENGINE')));
  assert.throws(() => B.renderHtml({root}), /Incorrect load order/);
}));

test('恶意 JSON 的 script 结束标签与分隔符被安全编码，语义不变', () => fixture(({root, put}) => {
  const value = {text: '</ScRiPt><script>throw Error("injected")</script>\u2028\u2029<&', numeric: 0};
  put('src/rules.json', JSON.stringify(value));
  const html = B.renderHtml({root});
  assert.deepEqual(dataFrom(html).rules, value);
  assert.ok(html.includes('\\u003c/ScRiPt>'));
  assert.ok(html.includes('\\u2028\\u2029'));
  assert.ok(!html.includes('\u2028') && !html.includes('\u2029'));
  assert.equal(B.inlineScripts(html).length, manifest.slots.filter(slot => slot.kind === 'script').length + 2);
}));

test('JS 中大小写 script 结束标签拒绝构建', () => fixture(({root, put}) => {
  put('src/app.js', 'const hostile="</ScRiPt>";');
  assert.throws(() => B.renderHtml({root}), /Unsafe closing script tag.*app.js/);
}));

test('CSS 中 style 结束标签拒绝构建', () => fixture(({root, put}) => {
  put('src/workbench.css', '/* </STYLE> */');
  assert.throws(() => B.renderHtml({root}), /Unsafe closing style tag/);
}));

test('损坏 JSON 与缺失输入不产出任何构建', () => {
  fixture(({root, put}) => { put('src/rules.json', '{bad'); assert.throws(() => B.renderHtml({root}), SyntaxError); });
  fixture(({root}) => { fs.unlinkSync(path.join(root, 'src/engine.js')); assert.throws(() => B.renderHtml({root}), /ENOENT/); });
});

test('每份 JS 语法以及 shell 最后启动脚本均检查', () => {
  fixture(({root, put}) => { put('src/app.js', 'function broken('); assert.throws(() => B.renderHtml({root}), SyntaxError); });
  fixture(({root, put, get}) => { put(manifest.shell, get(manifest.shell).replace('<script>void 0;</script>', '<script>if (</script>')); assert.throws(() => B.renderHtml({root}), SyntaxError); });
});

test('独立脚本间冲突的全局词法声明也拒绝构建', () => fixture(({root, put}) => {
  put('src/engine.js', 'const duplicateName=1;'); put('src/app.js', 'const duplicateName=2;');
  assert.throws(() => B.renderHtml({root}), /already been declared/);
}));

test('CSP 精确授权每个内联脚本，无 unsafe-eval，连接限制保持不变', () => fixture(({root}) => {
  const {html, report} = B.buildArtifact({root});
  const policy = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.ok(!policy.includes("script-src 'unsafe-inline'"));
  assert.ok(!policy.includes('unsafe-eval'));
  assert.ok(policy.includes("style-src 'unsafe-inline'"));
  assert.ok(policy.includes('connect-src https: http://127.0.0.1:* http://localhost:*'));
  for (const script of report.scripts) assert.ok(policy.includes("'" + script.csp + "'"));
}));

test('CRLF 输入归一后 CSP 哈希匹配浏览器看到的 LF 脚本', () => fixture(({root, put}) => {
  put('src/app.js', 'void 1;\r\nvoid 2;\r');
  const {html, report} = B.buildArtifact({root});
  assert.ok(!html.includes('\r'));
  B.inlineScripts(html).forEach((source, i) => assert.equal(report.scripts[i].sha256, hash(source)));
}));

test('外部 script 与缺失 CSP 不允许悄然通过', () => {
  fixture(({root, put, get}) => { put(manifest.shell, get(manifest.shell).replace('<script>void 0;</script>', '<script src="https://example.invalid/a.js"></script>')); assert.throws(() => B.renderHtml({root}), /External script/); });
  fixture(({root, put, get}) => { put(manifest.shell, get(manifest.shell).replace(/<meta[^>]+>/, '')); assert.throws(() => B.renderHtml({root}), /exactly one Content-Security-Policy/); });
});

test('构建报告绑定源码、HTML、规则与共享契约哈希', () => fixture(({root, put, get}) => {
  const first = B.buildArtifact({root});
  assert.equal(first.report.htmlSha256, hash(first.html));
  assert.equal(first.report.rulesSha256, hash(get('src/rules.json')));
  assert.equal(first.report.contractSha256, hash(get('src/tool-contract.cjs')));
  assert.deepEqual(B.buildReport({root, html: first.html}), first.report);
  put('src/engine.js', get('src/engine.js') + '\nvoid 123;');
  const next = B.buildArtifact({root});
  assert.notEqual(next.report.sourceSha256, first.report.sourceSha256);
  assert.notEqual(next.report.htmlSha256, first.report.htmlSha256);
  assert.throws(() => B.buildReport({root, html: first.html}), /does not match/);
}));

test('未知品牌、相对输出路径、未指定 local 输出与未知参数均拒绝', () => {
  fixture(({root}) => assert.throws(() => B.renderHtml({root, brand: 'typo'}), /Unknown brand/));
  assert.throws(() => B.parseArgs(['--out=relative.html']), /absolute/);
  assert.throws(() => B.parseArgs(['--brand=local']), /requires/);
  assert.throws(() => B.parseArgs(['--unknown']), /Unknown build option/);
  assert.equal(B.parseArgs(['--check']).check, true);
});

test('原子写仅替换指定文件且无遗留临时文件', () => fixture(({root}) => {
  const target = path.join(root, 'artifact.html');
  B.atomicWrite(target, 'before'); B.atomicWrite(target, 'after');
  assert.equal(fs.readFileSync(target, 'utf8'), 'after');
  assert.deepEqual(fs.readdirSync(root).sort(), ['artifact.html', 'src']);
}));

console.log('Build unit checks: ' + checks);
