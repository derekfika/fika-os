import { APPS } from './policy.mjs';

export const CHANGELOG_APPS = [...Object.values(APPS).map(a => a.path.slice(5)), 'ad-hoc-production', 'beverage-innovation', 'events-dashboard'];
export const changelogPath = p => p === 'CHANGELOG.md' || /^apps\/[^/]+\/CHANGELOG\.md$/.test(p) || /^\.changes\/(platform|[a-z0-9-]+)\/[a-z0-9][a-z0-9-]*\.md$/.test(p);
const documentation = p => changelogPath(p) || /\.md$/.test(p) || /(^|\/)docs\//.test(p);

/** Paths, not affected deployment targets: this includes every app and shared/tooling changes. */
export function changelogRequirements(paths) {
  const implementation = paths.filter(p => !documentation(p));
  const apps = CHANGELOG_APPS.filter(app => implementation.some(p => p.startsWith(`apps/${app}/`)));
  const platform = implementation.some(p => !/^apps\/[^/]+\//.test(p) || p.startsWith('apps/shared/'));
  const missing = apps.filter(app => !paths.some(p => p === `apps/${app}/CHANGELOG.md` || p.startsWith(`.changes/${app}/`) && changelogPath(p)));
  if (platform && !paths.some(p => p === 'CHANGELOG.md' || p.startsWith('.changes/platform/') && changelogPath(p))) missing.push('platform');
  return { apps, platform, missing, required: implementation.length > 0 };
}
export function assertChangelogs(paths) {
  const result = changelogRequirements(paths);
  if (result.missing.length) throw Error(`Missing changelog for: ${result.missing.join(', ')}. Add a unique .changes/<app-or-platform>/<change-id>.md fragment or the relevant CHANGELOG.md; root is not required for app-only work.`);
  return result;
}
export function assertChangelogContent(paths, read) {
  for (const p of paths.filter(changelogPath)) {
    let content; try { content = read(p); } catch { throw Error(`Changelog entry was deleted or cannot be read: ${p}`); }
    if (typeof content !== 'string' || content.trim().length < 40) throw Error(`Changelog entry is empty or too short: ${p}`);
    if (p.startsWith('.changes/') && (!/^# \d{4}-\d{2}-\d{2} .+/m.test(content) || !/Validation:/i.test(content) || !/Deployment:/i.test(content))) throw Error(`Fragment needs a dated title, Validation and Deployment: ${p}`);
  }
}
