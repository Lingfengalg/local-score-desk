'use strict';

// Exercise the release gate with synthetic child scripts and temporary HTML only.
// No browser, real workspace, repository index or repository source is modified.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const repository = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'score-runner-test-'));
const owned = path.resolve(root);
const runner = path.join(repository, 'scripts/test-all.cjs');
const builder = path.join(repository, 'build.cjs');
const html = path.join(root, 'test.html');
const manifest = path.join(root, 'manifest.json');
const report = path.join(root, 'report.json');
const probe = path.join(root, 'probe.cjs');
let checks = 0;
function test(name, fn) { fn(); checks++; console.log('PASS ' + name); }
function run(file, args) {
  return spawnSync(process.execPath, [file, ...args], {cwd: repository, encoding: 'utf8', windowsHide: true});
}
function runProbe(code, extra = []) {
  fs.writeFileSync(probe, code);
  const processResult = run(runner, ['--manifest=' + manifest, '--html=' + html, '--report=' + report, ...extra]);
  return {processResult, result: JSON.parse(fs.readFileSync(report, 'utf8'))};
}

try {
  test('CLI 可构建并检查独立临时 HTML，不写仓库 index', () => {
    const index = path.join(repository, 'index.html');
    const before = fs.existsSync(index) ? fs.readFileSync(index) : null;
    let result = run(builder, ['--out=' + html]);
    assert.equal(result.status, 0, result.stderr);
    result = run(builder, ['--check', '--out=' + html]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(fs.existsSync(index) ? fs.readFileSync(index) : null, before);
  });
  const originalHtml = fs.readFileSync(html, 'utf8');
  fs.writeFileSync(manifest, JSON.stringify([{id: 'synthetic', script: probe, group: 'core'}]));

  test('runner 仅统计本次 stdout PASS，含末尾无换行，并绑定执行前后哈希', () => {
    const {processResult, result} = runProbe("console.log('PASS one');process.stdout.write('PASS two');", ['--group=core']);
    assert.equal(processResult.status, 0, processResult.stderr + '\n' + processResult.stdout);
    assert.equal(result.passCount, 2);
    assert.equal(result.status, 'passed');
    assert.equal(result.group, 'core');
    assert.equal(result.fullSuite, false);
    assert.deepEqual(result.before, result.after);
    assert.equal(result.before.build.htmlSha256, result.before.testedHtmlSha256);
  });

  test('非零子进程即使输出 PASS 也不能通过发布门禁', () => {
    const {processResult, result} = runProbe("console.log('PASS partial');process.exitCode=2;");
    assert.equal(processResult.status, 1);
    assert.equal(result.status, 'failed');
    assert.equal(result.suites[0].exitCode, 2);
    assert.equal(result.passCount, 1);
  });

  test('零退出但没有 PASS 的空脚本不能证明完成测试', () => {
    const {processResult, result} = runProbe("console.log('no checks');");
    assert.equal(processResult.status, 1);
    assert.equal(result.suites[0].status, 'failed');
    assert.equal(result.passCount, 0);
  });

  test('仅临时 HTML 在测试中改变时，前后绑定校验必然失败', () => {
    const {processResult, result} = runProbe("require('node:fs').appendFileSync(process.env.SCORE_TEST_HTML,'\\n');console.log('PASS changed');");
    assert.equal(processResult.status, 1);
    assert.equal(result.status, 'failed');
    assert.ok(result.errors.some(error => error.includes('not a current')));
    assert.equal(result.passCount, 1);
    fs.writeFileSync(html, originalHtml);
  });

  test('--check 拒绝过时临时构建且不静默修复它', () => {
    fs.writeFileSync(html, originalHtml + '\n');
    const result = run(builder, ['--check', '--out=' + html]);
    assert.equal(result.status, 1);
    assert.equal(fs.readFileSync(html, 'utf8'), originalHtml + '\n');
    fs.writeFileSync(html, originalHtml);
  });

  test('local CLI 使用同一源码，仅写显式指定的临时输出', () => {
    const target = path.join(root, 'local.html');
    const result = run(builder, ['--brand=local', '--out=' + target]);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(fs.readFileSync(target, 'utf8').includes('<title>综测管理器'));
  });
  console.log('Runner unit checks: ' + checks);
} finally {
  assert.equal(path.resolve(root), owned);
  assert.equal(path.dirname(owned), path.resolve(os.tmpdir()));
  assert.ok(path.basename(owned).startsWith('score-runner-test-'));
  fs.rmSync(owned, {recursive: true, force: true});
}
