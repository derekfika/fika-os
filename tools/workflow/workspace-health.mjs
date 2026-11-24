import path from 'node:path';
import { mkdtempSync, rmdirSync, statfsSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { command } from './runtime.mjs';
import { canonical, localEntry, requireCanonical, withCapacityLock, workspaceInventory } from './workspace-capacity.mjs';
import { cleanupSourceWorkspaces } from './workspace-retirement.mjs';
import { sharedNpmCache } from './workspace-cache.mjs';

export function sourceWorkspaceHealth(options = {}) {
  requireCanonical();
  const scanRoot = path.dirname(canonical());
  const minimumFreeGB = Number(options['min-free-gb'] ?? process.env.FIKA_WORKSPACE_MIN_FREE_GB ?? 25);
  if (!Number.isFinite(minimumFreeGB) || minimumFreeGB < 0) throw Error('Disk warning threshold must be a nonnegative number of GB');
  const inventory = withCapacityLock(workspaceInventory);
  const { bsize, bavail } = statfsSync(scanRoot);
  let disk = { scanRoot, volumeFreeBytes: bsize * bavail, physicalScan: 'not requested' };
  let cleanup = null;
  if (!options['inventory-only']) {
    cleanup = cleanupSourceWorkspaces();
    if (process.platform === 'win32') {
      const script = fileURLToPath(new URL('./workspace-disk.ps1', import.meta.url));
      const scratch = mkdtempSync(path.join(tmpdir(), 'fika-workspace-health-'));
      const candidates = path.join(scratch, 'candidates.json');
      try {
        writeFileSync(candidates, JSON.stringify(cleanup.ready.map(entry => entry.directory)));
        disk = JSON.parse(command('pwsh', ['-NoProfile', '-File', script, '-ScanRoot', scanRoot, '-CandidatesFile', candidates],
          { maxBuffer: 8 * 1024 * 1024 }));
      } finally {
        if (localEntry(candidates)) unlinkSync(candidates);
        rmdirSync(scratch);
      }
      const downloadCache = path.join(sharedNpmCache(), '_cacache');
      const cacheEntry = localEntry(downloadCache);
      const cache = cacheEntry?.isDirectory() ? JSON.parse(command('pwsh', ['-NoProfile', '-File', script, '-ScanRoot', downloadCache],
        { maxBuffer: 8 * 1024 * 1024 })) : null;
      disk.sharedNpmDownloads = { directory: downloadCache, fileAllocationBytes: cache?.fileAllocationBytes ?? 0,
        ...(cache ? { unreadableDirectories: cache.unreadableDirectories } : {}) };
    } else disk.physicalScan = 'Windows NTFS scan unavailable on this platform';
  }
  return { observedAt: new Date().toISOString(), ...inventory, disk, minimumFreeGB,
    completedAwaitingCleanup: inventory.entries.filter(entry => entry.state === 'awaiting-cleanup').length,
    activeWorktrees: inventory.entries.filter(entry => entry.state === 'active').length,
    ...(cleanup ? { readyForCleanup: cleanup.ready, cleanupBlocked: cleanup.protected } : {}),
    warnings: [
      ...(disk.volumeFreeBytes < minimumFreeGB * 1e9 ? [`Free volume space is below ${minimumFreeGB} GB`] : []),
      ...(disk.fileAllocationBytes > 50e9 ? ['FIKA OS file allocation exceeds the 50 GB target'] : []),
      ...(disk.unreadableDirectories ? ['Some directories could not be measured'] : []),
    ] };
}
