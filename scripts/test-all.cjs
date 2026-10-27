'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {buildReport, atomicWrite} = require('../build.cjs');
const repository = path.resolve(__dirname, '..');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function parseArgs(args) {
  const options = {
    manifest: path.join(repository, 'tests/test-manifest.cjs'),
    html: path.join(repository, 'index.html'),
    report: path.join(repository, 'test-results/verified.json'),
    group: 'all', timeoutMs: 600000
  };
  for (const arg of args) {
    const match = /^--(manifest|html|report|group|timeout-ms)=(.+)$/.exec(arg);
    if (!match) throw Error('Unknown test runner option: ' + arg);
    const [, name, value] = match;
    if (name === 'manifest') options.manifest = path.resolve(repository, value);
    else if (name === 'group') options.group = value;
    else if (name === 'timeout-ms') options.timeoutMs = Number(value);
    else {
      if (!path.isAbsolute(value)) throw Error('--' + name + ' must be an absolute path');
      options[name] = value;
    }
  }
  if (!['all', 'core', 'browser'].includes(options.group)) throw Error('--group must be all, core or browser');
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1) throw Error('Invalid suite timeout');
  if (path.resolve(options.report) === path.resolve(options.html)) throw Error('The report must not overwrite the tested HTML');
  return options;
}

function readManifest(filename, group) {
  let entries;
  if (path.extname(filename) === '.json') entries = JSON.parse(fs.readFileSync(filename, 'utf8'));
  else {
    delete require.cache[require.resolve(filename)];
    entries = require(filename);
  }
  if (!Array.isArray(entries)) throw Error('Test manifest must export an array');
  const ids = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id) || typeof entry.script !== 'string') throw Error('Invalid or duplicate test manifest entry');
    if (entry.args !== undefined && (!Array.isArray(entry.args) || entry.args.some(arg => typeof arg !== 'string'))) throw Error('Test arguments must be strings');
    if (entry.env !== undefined && (!entry.env || typeof entry.env !== 'object' || Array.isArray(entry.env) || Object.values(entry.env).some(value => typeof value !== 'string'))) throw Error('Test environment values must be strings');
    ids.add(entry.id);
  }
  const selected = entries.filter(entry => group === 'all' || entry.group === group);
  if (!selected.length) throw Error('No suites selected');
  return selected;
}

function captureBinding({html, manifest, entries, root = repository}) {
  const contents = fs.readFileSync(html, 'utf8');
  let build;
  for (const brand of ['public', 'local']) {
    try { build = buildReport({root, brand, html: contents}); break; } catch (error) {
      if (brand === 'local') throw Error('Test HTML is not a current public/local build: ' + error.message);
    }
  }
  const suiteHashes = Object.fromEntries(entries.map(entry => [entry.id, sha256(fs.readFileSync(path.resolve(root, entry.script)))]));
  const dependencies = ['tests/qa-paths.mjs', 'tests/ui-test-helpers.mjs', 'tests/sample-expected.json', 'scripts/package.cjs', 'mcp/mcp-server.cjs', 'mcp/tool-contract.cjs', 'mcp/generate-mcp-config.cjs'];
  const dependencyHashes = Object.fromEntries(dependencies.filter(file => fs.existsSync(path.join(root, file))).map(file => [file, sha256(fs.readFileSync(path.join(root, file)))]));
  return {build, testedHtmlSha256: sha256(contents), manifestSha256: sha256(fs.readFileSync(manifest)), runnerSha256: sha256(fs.readFileSync(__filename)), suiteHashes, dependencyHashes};
}

function runSuite(entry, options) {
  return new Promise(resolve => {
    const started = Date.now();
    let passCount = 0, lineBuffer = '', stderrTail = '', childError = '';
    const child = spawn(process.execPath, [path.resolve(repository, entry.script), ...(entry.args || [])], {
      cwd: repository, windowsHide: true, shell: false, timeout: options.timeoutMs,
      env: {...process.env, ...(entry.env || {}), SCORE_TEST_HTML: options.html}, stdio: ['ignore', 'pipe', 'pipe']
    });
    const count = text => {
      lineBuffer += text;
      let newline;
      while ((newline = lineBuffer.indexOf('\n')) >= 0) {
        const line = lineBuffer.slice(0, newline).replace(/\r$/, '');
        lineBuffer = lineBuffer.slice(newline + 1);
        if (/^PASS(?:\s|$)/.test(line)) passCount++;
      }
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', text => { count(text); process.stdout.write(text); });
    child.stderr.on('data', text => { stderrTail = (stderrTail + text).slice(-8000); process.stderr.write(text); });
    child.on('error', error => { childError = error.message; });
    child.on('close', (exitCode, signal) => {
      if (/^PASS(?:\s|$)/.test(lineBuffer)) passCount++;
      const passed = exitCode === 0 && !childError && passCount > 0;
      resolve({id: entry.id, script: entry.script, status: passed ? 'passed' : 'failed', passCount,
        exitCode, signal, durationMs: Date.now() - started,
        ...(childError ? {error: childError} : {}), ...(!passCount ? {error: childError || 'Suite produced no PASS checks'} : {}),
        ...(stderrTail ? {stderrTail} : {})});
    });
  });
}

async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  const report = {format: 'score-desk-test-run-1', status: 'failed', complete: false, fullSuite: options.group === 'all', group: options.group,
    startedAt: new Date().toISOString(), suites: [], passCount: 0, errors: []};
  try {
    const entries = readManifest(options.manifest, options.group);
    report.selectedSuiteIds = entries.map(entry => entry.id);
    report.before = captureBinding({...options, entries});
    for (const entry of entries) {
      console.log('\n=== ' + entry.id + ' ===');
      report.suites.push(await runSuite(entry, options));
      report.passCount = report.suites.reduce((total, suite) => total + suite.passCount, 0);
    }
    report.complete = report.suites.length === entries.length;
    report.after = captureBinding({...options, entries});
    if (JSON.stringify(report.before) !== JSON.stringify(report.after)) report.errors.push('Source, HTML, rules, contract, manifest or suite hashes changed during this run');
    if (report.complete && !report.errors.length && report.suites.every(suite => suite.status === 'passed')) report.status = 'passed';
  } catch (error) { report.errors.push(error.message); }
  report.completedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(options.report), {recursive: true});
  atomicWrite(options.report, JSON.stringify(report, null, 2) + '\n');
  console.log('\n' + (report.status === 'passed' ? 'Verified' : 'FAILED') + ' (' + options.group + ' selection): ' + report.passCount + ' live PASS checks; report: ' + options.report);
  if (report.status !== 'passed') process.exitCode = 1;
  return report;
}

module.exports = {parseArgs, readManifest, captureBinding, runSuite, main};
if (require.main === module) main().catch(error => { console.error('Test runner failed: ' + error.message); process.exitCode = 1; });
