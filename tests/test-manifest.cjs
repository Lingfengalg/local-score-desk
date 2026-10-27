'use strict';

// Only checks printed by these scripts in the current run are counted. Historical
// *-results.json files are evidence artifacts, never release authorization.
module.exports = Object.freeze([
  {id: 'engine', script: 'tests/engine.cjs', group: 'core'},
  {id: 'mcp', script: 'tests/mcp.cjs', group: 'core'},
  {id: 'build', script: 'tests/build.cjs', group: 'core'},
  {id: 'runner', script: 'tests/runner.cjs', group: 'core'},
  {id: 'runtime', script: 'tests/runtime.cjs', group: 'core'},
  {id: 'package', script: 'tests/package.cjs', group: 'core'},
  {id: 'browser', script: 'tests/browser.mjs', group: 'browser'},
  {id: 'supplement', script: 'tests/supplement.mjs', group: 'browser'},
  {id: 'workflow', script: 'tests/workflow.mjs', group: 'browser'},
  {id: 'storage', script: 'tests/storage.mjs', group: 'browser'},
  {id: 'storage-init', script: 'tests/storage-init.mjs', group: 'browser'},
  {id: 'award-entry', script: 'tests/award-entry.mjs', group: 'browser'},
  {id: 'ergonomics', script: 'tests/ergonomics.mjs', group: 'browser'},
  {id: 'automation', script: 'tests/automation.mjs', group: 'browser'},
  {id: 'simplify', script: 'tests/simplify.mjs', group: 'browser'},
  {id: 'motion', script: 'tests/motion.mjs', group: 'browser'},
  {id: 'usability', script: 'tests/usability.mjs', group: 'browser'},
  {id: 'workbench', script: 'tests/workbench.mjs', group: 'browser'}
].map(Object.freeze));
