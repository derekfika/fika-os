// Child-process driver for historical lifecycle tests. The supported CLI exposes only readback.
import { parse } from './cli.mjs';
import { applyCleanup, checkWorkspace, cleanupPlan, createWorkspace, finishWorkspace, reconcileWorkspace, retireWorkspace, workspaceRecords } from './workspaces.mjs';
import { git, jsonFile } from './runtime.mjs';

if (!process.env.NODE_TEST_CONTEXT) throw Error('Historical workspace fixture must run under node --test');
const { positional: [verb, action, name], options } = parse(process.argv.slice(2));
const actions = { create: createWorkspace, check: checkWorkspace, finish: finishWorkspace, reconcile: reconcileWorkspace, retire: retireWorkspace, list: workspaceRecords };
try {
  let result;
  if (verb === 'cleanup' && options.execute) result = applyCleanup(jsonFile(options.file), options['approve-hash']);
  else if (verb === 'cleanup') { git('fetch', 'origin'); result = cleanupPlan(); }
  else if (verb === 'workspace' && Object.hasOwn(actions, action)) result = actions[action](name, options);
  else throw Error('Unknown historical fixture command');
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
