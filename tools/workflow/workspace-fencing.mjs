import path from 'node:path';
import { existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { common, root, git, stateDir, jsonFile, save } from './runtime.mjs';
import { authorityForCurrentWorkspace } from './workspace-state.mjs';

/** Git invokes this from the checkout, including when an old agent uses its older CLI. */
export function checkGitWorkspaceFence() { authorityForCurrentWorkspace(); }
export function installWorkspaceFences({ sourceRoot = path.resolve(common(), '..') } = {}) {
  if (path.resolve(root()) !== path.resolve(common(), '..')) throw Error('Install workspace fencing from the canonical checkout');
  const gateModule = path.join(sourceRoot, 'tools/workflow/workspace-fencing.mjs');
  if (!existsSync(gateModule)) throw Error('Upgrade the canonical checkout before installing fencing');
  const dir = path.join(stateDir(), 'git-hooks'); const config = path.join(stateDir(), 'git-hook-fence.json');
  let current; try { current = git('config', '--get', 'core.hooksPath'); } catch { current = null; }
  if (existsSync(config)) {
    const installed = jsonFile(config);
    if (path.resolve(current || '') !== dir || installed.directory !== dir) throw Error('Git hook configuration changed; inspect it before reinstalling fencing');
    return { installed: true, directory: dir, original: installed.original, alreadyInstalled: true };
  }
  const original = current ? path.resolve(root(), current) : path.join(common(), 'hooks');
  mkdirSync(dir, { recursive: true });
  const entry = path.join(dir, 'workspace-fence.mjs');
  writeFileSync(entry, `import {checkGitWorkspaceFence} from ${JSON.stringify(pathToFileURL(gateModule).href)};\ntry {checkGitWorkspaceFence();} catch(e) {console.error('FIKA HOLD: '+e.message);process.exitCode=1;}\n`, { flag: 'wx' });
  const quote = s => `'${s.replace(/\\/g, '/').replace(/'/g, `'"'"'`)}'`;
  // Forward every standard hook. Original programs and their stdin/arguments are preserved.
  const hookNames = ['applypatch-msg','pre-applypatch','post-applypatch','pre-commit','pre-merge-commit','prepare-commit-msg','commit-msg','post-commit','pre-rebase','post-checkout','post-merge','pre-push','pre-receive','update','proc-receive','post-receive','post-update','reference-transaction','push-to-checkout','pre-auto-gc','post-rewrite','sendemail-validate','fsmonitor-watchman','p4-changelist','p4-prepare-changelist','p4-post-changelist','p4-pre-submit','post-index-change'];
  for (const name of hookNames) {
    const fenced = ['pre-commit','pre-merge-commit','pre-push','pre-rebase'].includes(name);
    const script = `#!/bin/sh\n${fenced ? `${quote(process.execPath)} ${quote(entry)} || exit $?\n` : ''}if [ -x ${quote(path.join(original, name))} ]; then exec ${quote(path.join(original, name))} "$@"; fi\n`;
    const file = path.join(dir, name); writeFileSync(file, script, { flag: 'wx' }); chmodSync(file, 0o755);
  }
  save(config, { schema: 'fika.workspace-git-fence.v1', directory: dir, original, installedAt: new Date().toISOString() });
  git('config', '--local', 'core.hooksPath', dir);
  return { installed: true, directory: dir, original, alreadyInstalled: false };
}
