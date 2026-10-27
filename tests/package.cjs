'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const P = require('../scripts/package.cjs');
const {buildArtifact} = require('../build.cjs');
const {readManifest, captureBinding} = require('../scripts/test-all.cjs');
const repository = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'score-package-test-'));
const owned = path.resolve(root);
const manifest = path.join(repository, 'tests/test-manifest.cjs');
const entries = readManifest(manifest, 'all');
const html = path.join(root, 'fixture.html'), reportFile = path.join(root, 'fixture-report.json');
const options = {...P.parseArgs([]), html, report: reportFile, out: path.join(root, 'must-not-exist'), checkOnly: true};
const clone = value => JSON.parse(JSON.stringify(value));
let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log('PASS ' + name); }

function syntheticReport(binding) {
  const now = Date.now();
  return {format: 'score-desk-test-run-1', status: 'passed', complete: true, fullSuite: true, group: 'all',
    startedAt: new Date(now - 1000).toISOString(), completedAt: new Date(now).toISOString(), errors: [],
    selectedSuiteIds: entries.map(entry => entry.id),
    suites: entries.map(entry => ({id: entry.id, script: entry.script, status: 'passed', passCount: 1, exitCode: 0, signal: null})),
    passCount: entries.length, before: binding, after: clone(binding)};
}

async function main() {
  fs.writeFileSync(html, buildArtifact().html);
  const binding = captureBinding({html, manifest, entries});
  const valid = syntheticReport(binding);
  const validate = report => P.validateReport(report, {entries});

  await test('完整合成报告通过纯结构门禁，套件数量随当前 manifest 变化', () => assert.equal(validate(clone(valid)).passCount, entries.length));
  await test('失败、不完整、非 fullSuite 或 core 报告不可发行', () => {
    for (const change of [{status: 'failed'}, {complete: false}, {fullSuite: false}, {group: 'core'}]) assert.throws(() => validate({...clone(valid), ...change}), /full-suite/);
  });
  await test('只伪改 full 标志而缺少全套 id 仍被拒绝', () => {
    const bad = clone(valid); bad.selectedSuiteIds.pop(); bad.suites.pop(); bad.passCount--;
    assert.throws(() => validate(bad), /canonical test manifest/);
  });
  await test('套件 id/script/顺序必须与 canonical manifest 一致', () => {
    for (const mutate of [r => r.suites[0].id = 'other', r => r.suites[0].script = 'tests/missing.cjs', r => r.suites.reverse(), r => r.selectedSuiteIds.reverse()]) {
      const bad = clone(valid); mutate(bad); assert.throws(() => validate(bad));
    }
  });
  await test('每个套件须 passed、exit0、无signal且有正整数 PASS', () => {
    for (const change of [{status: 'failed'}, {exitCode: 2}, {signal: 'SIGTERM'}, {passCount: 0}, {passCount: 1.5}]) {
      const bad = clone(valid); Object.assign(bad.suites[0], change); assert.throws(() => validate(bad), /missing or incomplete/);
    }
  });
  await test('总 PASS 必须等于套件求和且 errors 必须为空', () => {
    assert.throws(() => validate({...clone(valid), passCount: valid.passCount + 1}), /inconsistent/);
    assert.throws(() => validate({...clone(valid), errors: ['failed']}), /contains errors/);
  });
  await test('过期、倒序和未来时间的报告不能作为 fresh 发行凭据', () => {
    const now = Date.now();
    for (const [started, completed] of [[now - 49 * 3600000, now - 48 * 3600000], [now + 1000, now], [now + 60000, now + 61000]]) {
      const bad = {...clone(valid), startedAt: new Date(started).toISOString(), completedAt: new Date(completed).toISOString()};
      assert.throws(() => validate(bad), /expired or has invalid timestamps/);
    }
  });
  await test('实际源码/HTML binding 与 before/after 均一致才能发行', () => {
    fs.writeFileSync(reportFile, JSON.stringify(valid));
    assert.deepEqual(P.verifyReport(options).binding, binding);
    const bad = clone(valid); bad.before.build.sourceSha256 = 'stale'; bad.after = clone(bad.before);
    fs.writeFileSync(reportFile, JSON.stringify(bad)); assert.throws(() => P.verifyReport(options), /stale/);
    const divergent = clone(valid); divergent.after.build.contractSha256 = 'different';
    fs.writeFileSync(reportFile, JSON.stringify(divergent)); assert.throws(() => P.verifyReport(options), /stale/);
    fs.writeFileSync(reportFile, JSON.stringify(valid));
  });
  await test('旧 HTML 即使配有 full 报告也不能绕过当前构建校验', () => {
    const original = fs.readFileSync(html); fs.appendFileSync(html, '\n');
    assert.throws(() => P.verifyReport(options), /not a current/); fs.writeFileSync(html, original);
  });
  await test('归档期间必须仍是同一份报告及同一组输入，不能换成另一份有效报告', () => {
    const first = {binding, reportSha256: 'first-report'};
    P.assertUnchanged(first, clone(first));
    assert.throws(() => P.assertUnchanged(first, {...clone(first), reportSha256: 'other-report'}), /report changed/);
    const changed = clone(first); changed.binding.build.rulesSha256 = 'other-rules';
    assert.throws(() => P.assertUnchanged(first, changed), /changed while packaging/);
  });
  await test('runtime 的节点二进制必须匹配所附 win-x64 校验和', () => {
    const temporary = path.join(root, 'runtime-fixture'); fs.mkdirSync(temporary);
    const binary = Buffer.from('MZ synthetic test fixture only');
    fs.writeFileSync(path.join(temporary, 'node.exe'), binary);
    fs.writeFileSync(path.join(temporary, 'LICENSE.node.txt'), 'fixture '.repeat(200));
    fs.writeFileSync(path.join(temporary, 'SHASUMS256.txt'), '0'.repeat(64) + '  win-x64/node.exe\n');
    assert.throws(() => P.readRuntime({runtime: temporary}), /does not match/);
    const digest = crypto.createHash('sha256').update(binary).digest('hex');
    fs.writeFileSync(path.join(temporary, 'SHASUMS256.txt'), digest + '  win-x64/node.exe\n');
    assert.equal(P.readRuntime({runtime: temporary}).sha256, digest);
  });
  await test('发行路径须显式绝对路径，CLI dry-run 不等于正式发行', () => {
    assert.throws(() => P.parseArgs(['--out=relative']), /absolute/);
    assert.throws(() => P.parseArgs(['--out=' + repository]), /dedicated release/);
    assert.equal(P.parseArgs(['--check-only']).checkOnly, true);
    assert.equal(fs.existsSync(options.out), false);
  });

  if (process.env.SCORE_PACKAGE_RUNTIME) {
    const runtime = path.resolve(process.env.SCORE_PACKAGE_RUNTIME);
    let result, JSZip;
    await test('完整 check-only 内存生成三种 ZIP，且不创建发行目录或改受测 HTML', async () => {
      JSZip = require('jszip');
      const original = fs.readFileSync(html);
      const beforeIndex = fs.readFileSync(path.join(repository, 'index.html'));
      result = await P.packageRelease({...options, runtime});
      assert.equal(result.action, 'checked-only');
      assert.equal(fs.existsSync(options.out), false);
      assert.deepEqual(fs.readFileSync(html), original);
      assert.deepEqual(fs.readFileSync(path.join(repository, 'index.html')), beforeIndex);
      for (const name of [P.NAMES.app, P.NAMES.mcp, P.NAMES.source]) assert.ok(result.artifacts.get(name).length > 0);
    });
    await test('small app ZIP 与源码 ZIP 分别携带同源 local/public HTML', async () => {
      const app = await JSZip.loadAsync(result.artifacts.get(P.NAMES.app));
      assert.equal(await app.file(P.NAMES.html).async('string'), buildArtifact({brand: 'local'}).html);
      const source = await JSZip.loadAsync(result.artifacts.get(P.NAMES.source));
      assert.equal(await source.file('local-score-desk/index.html').async('string'), buildArtifact().html);
      assert.ok(source.file('local-score-desk/build/manifest.cjs'));
      assert.ok(!Object.keys(source.files).some(name => /node_modules|connection\.json|results\.json/.test(name)));
    });
    await test('portable MCP 使用兼容 BUPT 标识，其 canonical web-source 可字节重建', async () => {
      const zipped = await JSZip.loadAsync(result.artifacts.get(P.NAMES.mcp));
      const prefix = '综测管理器_MCP工具包/';
      const server = await zipped.file(prefix + 'mcp-server.cjs').async('string');
      assert.ok(server.includes('BUPT_MCP_PORT') && server.includes('BUPTScoreMCP'));
      assert.ok(!server.includes('SCORE_DESK_MCP'));
      const base = path.join(root, 'rebuild'); fs.mkdirSync(base);
      for (const name of Object.keys(zipped.files).filter(name => name.startsWith(prefix + 'web-source/') && !zipped.files[name].dir)) {
        const target = path.resolve(base, name.slice((prefix + 'web-source/').length));
        assert.ok(target.startsWith(base + path.sep)); fs.mkdirSync(path.dirname(target), {recursive: true});
        fs.writeFileSync(target, await zipped.file(name).async('nodebuffer'));
      }
      const expected = await zipped.file(prefix + 'web-source/' + P.NAMES.html).async('nodebuffer');
      fs.unlinkSync(path.join(base, P.NAMES.html));
      const execution = spawnSync(process.execPath, [path.join(base, 'build-html.cjs')], {cwd: root, encoding: 'utf8', windowsHide: true});
      assert.equal(execution.status, 0, execution.stderr);
      assert.deepEqual(fs.readFileSync(path.join(base, P.NAMES.html)), expected);
    });
  } else console.log('SKIP archive integration: set SCORE_PACKAGE_RUNTIME to a verified portable Node directory and make build-only JSZip available.');
  console.log('Package unit checks: ' + checks);
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  assert.equal(path.resolve(root), owned); assert.equal(path.dirname(owned), path.resolve(os.tmpdir()));
  assert.ok(path.basename(owned).startsWith('score-package-test-')); fs.rmSync(owned, {recursive: true, force: true});
});
