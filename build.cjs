'use strict';

// The build reads only the public source tree. Requiring this module never writes files.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const manifest = require('./build/manifest.cjs');

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const markerFor = key => '/*__' + key + '__*/';
const markerPattern = /\/\*__[A-Z][A-Z0-9_]*__\*\//g;

function applyBrand(text, brand) {
  if (brand === 'public') return text;
  for (const [from, to] of manifest.brands.local.replacements) text = text.replaceAll(from, to);
  return text.replaceAll(manifest.brands.public.connectionHelp, manifest.brands.local.connectionHelp);
}

function safeJson(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
}

function inlineScripts(html) {
  const scripts = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\bsrc\s*=/i.test(match[1])) throw Error('External script sources are not allowed in the standalone build');
    scripts.push(match[2]);
  }
  if (!scripts.length) throw Error('The shell contains no inline scripts');
  return scripts;
}

function hashScripts(html) {
  return inlineScripts(html).map((source, index) => ({
    index: index + 1,
    sha256: hash(source),
    csp: 'sha256-' + crypto.createHash('sha256').update(source).digest('base64')
  }));
}

function secureCsp(html, scripts) {
  let count = 0;
  const secured = html.replace(/(<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*content=)(["'])([\s\S]*?)\2([^>]*>)/gi,
    (whole, prefix, quote, policy, suffix) => {
      count++;
      const directives = policy.split(';').map(x => x.trim()).filter(Boolean);
      const scriptIndex = directives.findIndex(x => /^script-src(?:\s|$)/i.test(x));
      if (scriptIndex < 0) throw Error('CSP must explicitly declare script-src');
      if (directives.some(x => /^(?:script-src-elem|script-src-attr)(?:\s|$)/i.test(x))) {
        throw Error('Separate script CSP directives are not supported by the standalone builder');
      }
      directives[scriptIndex] = 'script-src ' + [...new Set(scripts.map(s => "'" + s.csp + "'"))].join(' ');
      return prefix + quote + directives.join('; ') + quote + suffix;
    });
  if (count !== 1) throw Error('The shell must contain exactly one Content-Security-Policy meta tag');
  return secured;
}

function buildArtifact({root = __dirname, brand = 'public'} = {}) {
  root = path.resolve(root);
  if (!Object.hasOwn(manifest.brands, brand)) throw Error('Unknown brand: ' + brand);
  const inputPaths = [manifest.shell, ...manifest.slots.flatMap(slot => slot.files)];
  const inputs = new Map([...new Set(inputPaths)].map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]));
  let html = inputs.get(manifest.shell);
  const expected = new Set(manifest.slots.map(slot => markerFor(slot.key)));
  for (const marker of html.match(markerPattern) || []) {
    if (!expected.has(marker)) throw Error('Unknown shell placeholder: ' + marker);
  }
  let previousPosition = -1;
  for (const slot of manifest.slots) {
    const marker = markerFor(slot.key);
    const first = html.indexOf(marker);
    if (first < 0 || html.indexOf(marker, first + marker.length) >= 0) {
      throw Error('Expected exactly one placeholder: ' + marker);
    }
    if (first <= previousPosition) throw Error('Incorrect load order at placeholder: ' + marker);
    previousPosition = first;
  }
  html = applyBrand(html, brand);
  for (const slot of manifest.slots) {
    let source;
    if (slot.kind === 'json') {
      source = safeJson(JSON.parse(inputs.get(slot.files[0])));
    } else {
      source = slot.files.map(file => {
        const value = applyBrand(inputs.get(file), brand);
        if (slot.kind === 'script') {
          if (/<\/script/i.test(value)) throw Error('Unsafe closing script tag in ' + file);
          new vm.Script(value, {filename: file});
        } else if (/<\/style/i.test(value)) throw Error('Unsafe closing style tag in ' + file);
        return value;
      }).join('\n');
    }
    html = html.replace(markerFor(slot.key), () => source);
  }
  if (markerPattern.test(html)) throw Error('Unresolved placeholder in generated HTML');
  // HTML parsing normalizes line endings before CSP hashing and JavaScript execution.
  html = html.replace(/\r\n?/g, '\n');
  const scripts = inlineScripts(html);
  scripts.forEach((source, index) => new vm.Script(source, {filename: 'inline-' + (index + 1) + '.js'}));
  new vm.Script(scripts.join('\n;\n'), {filename: 'combined-inline.js'});
  const scriptHashes = hashScripts(html);
  html = secureCsp(html, scriptHashes);
  const inputHashes = Object.fromEntries([...inputs].map(([file, source]) => [file, hash(source)]));
  const rules = inputs.get('src/rules.json');
  const samples = inputs.get('src/samples.json');
  const contract = inputs.get('src/tool-contract.cjs');
  const report = {
    format: 'score-desk-build-1', brand,
    sourceSha256: hash(JSON.stringify(inputHashes)),
    htmlSha256: hash(html),
    rulesSha256: hash(rules),
    rulesSemanticSha256: hash(JSON.stringify(JSON.parse(rules))),
    samplesSha256: hash(samples),
    samplesSemanticSha256: hash(JSON.stringify(JSON.parse(samples))),
    contractSha256: hash(contract),
    builderSha256: hash(fs.readFileSync(__filename, 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, 'build/manifest.cjs'), 'utf8')),
    bytes: Buffer.byteLength(html), inputs: inputHashes, scripts: scriptHashes
  };
  return {html, report};
}

function renderHtml(options) { return buildArtifact(options).html; }

function buildReport(options = {}) {
  const result = buildArtifact(options);
  if (options.html !== undefined && options.html !== result.html) throw Error('HTML does not match the declared source and brand');
  return result.report;
}

function atomicWrite(target, contents) {
  const temporary = path.join(path.dirname(target), '.' + path.basename(target) + '.' + process.pid + '.' + crypto.randomUUID() + '.tmp');
  try {
    fs.writeFileSync(temporary, contents, {encoding: 'utf8', flag: 'wx'});
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function parseArgs(args) {
  const options = {brand: 'public', check: false, out: path.join(__dirname, 'index.html')};
  for (const arg of args) {
    if (arg === '--check') options.check = true;
    else if (arg.startsWith('--brand=')) options.brand = arg.slice(8);
    else if (arg.startsWith('--out=')) {
      options.out = arg.slice(6);
      if (!path.isAbsolute(options.out)) throw Error('--out must be an absolute path');
    } else throw Error('Unknown build option: ' + arg);
  }
  if (options.brand === 'local' && !args.some(arg => arg.startsWith('--out='))) {
    throw Error('--brand=local requires an explicit absolute --out path');
  }
  return options;
}

function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  const result = buildArtifact({brand: options.brand});
  if (options.check) {
    if (!fs.existsSync(options.out) || fs.readFileSync(options.out, 'utf8') !== result.html) {
      throw Error('Build is stale or missing: ' + options.out);
    }
  } else atomicWrite(options.out, result.html);
  console.log(JSON.stringify({action: options.check ? 'checked' : 'built', target: options.out, ...result.report}, null, 2));
  return result.report;
}

module.exports = {renderHtml, buildReport, buildArtifact, inlineScripts, safeJson, atomicWrite, parseArgs, main};
if (require.main === module) {
  try { main(); } catch (error) { console.error('Build failed: ' + error.message); process.exitCode = 1; }
}
