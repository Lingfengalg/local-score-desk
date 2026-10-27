'use strict';

// Pure runtime contracts: only read local source; no browser, storage, or user data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/view-runtime.js'), 'utf8');
const noop = () => {};
let passed = 0;
let failed = 0;

function fresh() {
  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, {filename: 'view-runtime.js', timeout: 1000});
  return {sandbox, views: sandbox.ScoreViews};
}

function pipeline() {
  const fixture = fresh();
  const {sandbox, views} = fixture;
  const events = [];
  const token = {fixtureOnly: true};
  sandbox.ScoreUX = {decorate: () => events.push('ux')};
  sandbox.ScoreAccess = {protect: () => events.push('access')};
  views.provide('entry', {
    beforeView: region => {events.push('before:' + region); return token;},
    decorate: () => events.push('entry.decorate'),
    afterView: (actual, region) => {
      assert.equal(actual, token);
      events.push('after:' + region);
    },
  });
  views.provide('workflow', {
    prepare: () => events.push('workflow.prepare'),
    decorateOverview: () => events.push('workflow.overview'),
    decorateOverviewTable: () => events.push('workflow.table'),
    decorateWorkspace: () => events.push('workflow.workspace'),
    decorateEditor: () => events.push('workflow.editor'),
  });
  views.provide('simple', {
    nav: () => events.push('simple.nav'),
    decorateEditor: () => events.push('simple.editor'),
  });
  views.provide('workbench', {decorate: region => events.push('workbench:' + region)});
  views.provide('storage', {updateUI: options => {
    assert.equal(options.protect, false);
    assert.deepEqual(Object.keys(options), ['protect']);
    events.push('storage');
  }});
  return {...fixture, events};
}

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('PASS ' + name);
  } catch (error) {
    failed++;
    console.error('FAIL ' + name);
    console.error(error.stack || error);
  }
}

test('immutable API and empty counters require no application globals', () => {
  const {views} = fresh();
  assert.ok(Object.isFrozen(views));
  assert.deepEqual(Object.keys(views).sort(), ['define', 'inspect', 'page', 'provide', 'render', 'route', 'service']);
  for (const value of Object.values(views)) assert.equal(typeof value, 'function');
  const state = views.inspect();
  for (const key of ['regions', 'pages', 'services', 'renders', 'outerRenders', 'uxDecorations', 'beforeViews', 'afterViews']) {
    assert.equal(state[key], 0);
  }
  assert.equal(state.rendering, false);
  assert.deepEqual(Object.keys(state.regionRenders), []);
});

test('only fixed regions register once and invalid renderers are rejected', () => {
  const {views} = fresh();
  const regions = ['app', 'overview', 'overviewTable', 'workspace', 'editor', 'roster', 'grid', 'tasks', 'studentchecks'];
  for (const region of regions) views.define(region, noop);
  assert.equal(views.inspect().regions, regions.length);
  assert.throws(() => views.define('editor', noop), /already defined/);
  assert.throws(() => views.define('unbounded-plugin', noop), /Unknown view region/);
  assert.throws(() => views.define('app', null), /Unknown view region/);
  assert.equal(views.inspect().regions, regions.length);
});

test('fixed services are named, frozen, readable, and cannot be replaced', () => {
  const {views} = fresh();
  for (const name of ['workflow', 'entry', 'simple', 'workbench', 'storage']) {
    const value = {fixtureService: name};
    views.provide(name, value);
    assert.equal(views.service(name), value);
    assert.ok(Object.isFrozen(value));
  }
  assert.equal(views.inspect().services, 5);
  assert.equal(views.service('missing'), undefined);
  assert.throws(() => views.provide('storage', {}), /already provided/);
  assert.throws(() => views.provide('unbounded-plugin', {}), /Unknown view service/);
  assert.throws(() => views.provide('entry', null), /Unknown view service/);
  assert.throws(() => views.provide('entry', noop), /Unknown view service/);
});

test('only fixed pages register once and invalid callbacks are rejected', () => {
  const {views} = fresh();
  for (const name of ['overview', 'students', 'tasks', 'gradegrid', 'studentchecks']) views.page(name, noop);
  assert.equal(views.inspect().pages, 5);
  assert.throws(() => views.page('students', noop), /already defined/);
  assert.throws(() => views.page('unbounded-page', noop), /Unknown view page/);
  assert.throws(() => views.page('overview', 'not-a-function'), /Unknown view page/);
});

test('overview and students routes are handled while unknown routes do nothing', () => {
  const {views} = fresh();
  const events = [];
  views.define('overview', () => events.push('overview'));
  views.define('workspace', () => events.push('students'));
  views.page('overview', () => views.render('overview'));
  views.page('students', () => views.render('workspace'));
  assert.equal(views.route('missing'), false);
  assert.equal(views.inspect().renders, 0);
  assert.equal(views.route('overview'), true);
  assert.equal(views.route('students'), true);
  assert.deepEqual(events, ['overview', 'students']);
  assert.deepEqual({...views.inspect().regionRenders}, {overview: 1, workspace: 1});
});

test('nested app rendering has one capture, one UX pass, and fixed finish order', () => {
  const {views, events} = pipeline();
  views.define('app', () => {events.push('app'); views.render('workspace');});
  views.define('workspace', () => {events.push('workspace'); views.render('roster'); views.render('editor');});
  views.define('roster', () => events.push('roster'));
  views.define('editor', () => events.push('editor'));
  views.render('app');
  assert.deepEqual(events, [
    'before:app', 'workflow.prepare', 'app', 'workspace', 'roster', 'editor',
    'workflow.editor', 'workflow.workspace', 'simple.editor', 'simple.nav',
    'ux', 'workbench:app', 'entry.decorate', 'storage', 'access', 'after:app',
  ]);
  const state = views.inspect();
  assert.equal(state.renders, 4);
  for (const key of ['outerRenders', 'uxDecorations', 'beforeViews', 'afterViews']) assert.equal(state[key], 1);
  assert.equal(state.rendering, false);
  assert.deepEqual({...state.regionRenders}, {app: 1, workspace: 1, roster: 1, editor: 1});
});

test('overview and table decorate after their bases without editor-only hooks', () => {
  const {views, events} = pipeline();
  views.define('overview', () => {events.push('overview'); views.render('overviewTable');});
  views.define('overviewTable', () => events.push('table'));
  views.render('overview');
  assert.deepEqual(events, [
    'before:overview', 'overview', 'table', 'workflow.table', 'workflow.overview',
    'simple.nav', 'ux', 'workbench:overview', 'storage', 'access', 'after:overview',
  ]);
  assert.equal(views.inspect().outerRenders, 1);
  assert.equal(views.inspect().uxDecorations, 1);
});

test('partial editor, table, and roster refreshes preserve arguments and results', () => {
  const {views, events} = pipeline();
  const argument = {fixtureArgument: true};
  const result = {fixtureResult: true};
  views.define('editor', (actual, count) => {
    assert.equal(actual, argument);
    assert.equal(count, 2);
    return result;
  });
  views.define('overviewTable', () => 'table-result');
  views.define('roster', () => 'roster-result');
  assert.equal(views.render('editor', argument, 2), result);
  assert.equal(views.render('overviewTable'), 'table-result');
  assert.equal(views.render('roster'), 'roster-result');
  assert.equal(events.filter(x => x === 'entry.decorate').length, 1);
  assert.equal(events.filter(x => x === 'simple.editor').length, 1);
  assert.equal(events.filter(x => x === 'workflow.table').length, 1);
  assert.equal(events.includes('workflow.prepare'), false);
  const state = views.inspect();
  for (const key of ['renders', 'outerRenders', 'uxDecorations', 'beforeViews', 'afterViews']) assert.equal(state[key], 3);
  assert.deepEqual({...state.regionRenders}, {editor: 1, overviewTable: 1, roster: 1});
});

test('undefined regions fail before hooks or counters and do not poison context', () => {
  const {views, events} = pipeline();
  const before = JSON.stringify(views.inspect());
  assert.throws(() => views.render('editor'), /View region not defined/);
  assert.throws(() => views.render('unbounded-plugin'), /View region not defined/);
  assert.equal(JSON.stringify(views.inspect()), before);
  assert.deepEqual(events, []);
  views.define('roster', noop);
  views.render('roster');
  assert.equal(views.inspect().outerRenders, 1);
});

test('nested renderer exceptions clear context before the next independent render', () => {
  const {views, events} = pipeline();
  let fail = true;
  views.define('app', () => views.render('editor'));
  views.define('editor', () => {if (fail) throw Error('fixture-render-error');});
  assert.throws(() => views.render('app'), /fixture-render-error/);
  assert.equal(views.inspect().rendering, false);
  assert.equal(views.inspect().afterViews, 0);
  fail = false;
  views.render('editor');
  assert.equal(views.inspect().outerRenders, 2);
  assert.equal(views.inspect().afterViews, 1);
  assert.equal(views.inspect().uxDecorations, 1);
  assert.ok(events.includes('before:editor'));
  assert.equal(views.inspect().rendering, false);
});

test('before, finish, and after hook errors each leave a reusable clean context', () => {
  for (const stage of ['before', 'finish', 'after']) {
    const {sandbox, views} = fresh();
    let fail = true;
    let completed = 0;
    const throwAt = actual => {if (fail && actual === stage) throw Error('fixture-' + stage);};
    views.provide('entry', {
      beforeView: () => throwAt('before'),
      afterView: () => {throwAt('after'); completed++;},
    });
    sandbox.ScoreAccess = {protect: () => throwAt('finish')};
    views.define('editor', noop);
    assert.throws(() => views.render('editor'), new RegExp('fixture-' + stage));
    assert.equal(views.inspect().rendering, false);
    fail = false;
    views.render('editor');
    assert.equal(completed, 1);
    assert.equal(views.inspect().afterViews, 1);
    assert.equal(views.inspect().rendering, false);
  }
});

test('inspect is a frozen detached count snapshot without project or hook data', () => {
  const {sandbox, views} = fresh();
  const marker = 'fixture-only-private-marker';
  sandbox.project = {students: [{name: marker}]};
  views.provide('entry', {beforeView: () => ({marker}), afterView: noop});
  views.define('overview', noop);
  views.render('overview');
  const first = views.inspect();
  assert.deepEqual(Object.keys(first).sort(), [
    'afterViews', 'beforeViews', 'outerRenders', 'pages', 'regionRenders',
    'regions', 'rendering', 'renders', 'services', 'uxDecorations',
  ]);
  for (const [key, value] of Object.entries(first)) {
    if (key !== 'regionRenders' && key !== 'rendering') assert.equal(typeof value, 'number');
  }
  for (const value of Object.values(first.regionRenders)) assert.equal(typeof value, 'number');
  assert.equal(JSON.stringify(first).includes(marker), false);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.regionRenders));
  assert.throws(() => {first.renders = 999;});
  assert.throws(() => {first.regionRenders.overview = 999;});
  views.render('overview');
  assert.equal(first.renders, 1);
  assert.equal(first.regionRenders.overview, 1);
  assert.equal(views.inspect().renders, 2);
  assert.equal(views.inspect().regionRenders.overview, 2);
});

console.log(`Runtime contracts: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
