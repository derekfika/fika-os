import path from 'node:path';
import { mkdtempSync, rmdirSync, statfsSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { command } from './runtime.mjs';
import { canonical, localEntry, requireCanonical, workspaceInventory } from './workspace-capacity.mjs';
import { sharedNpmCache } from './workspace-cache.mjs';

export function sourceWorkspaceHealth(options = {}) {
  requireCanonical();
  const scanRoot = path.dirname(canonical());
  const minimumFreeGB = Number(options['min-free-gb'] ?? process.env.FIKA_WORKSPACE_MIN_FREE_GB ?? 25);
  if (!Number.isFinite(minimumFreeGB) || minimumFreeGB < 0) throw Error('Disk warning threshold must be a nonnegative number of GB');
  const inventory = workspaceInventory();
  const { bsize, bavail } = statfsSync(scanRoot);
  let disk = { scanRoot, volumeFreeBytes: bsize * bavail, physicalScan: 'not requested' };
  if (options.deep || options['storage-audit']) {
    // Recursive NTFS accounting is deliberately opt-in and kept out of admission health.
    if (process.platform === 'win32') {
      process.stderr.write(`workspace deep health: scanning NTFS allocation under ${scanRoot} (120-second limit)\n`);
      const script = fileURLToPath(new URL('./workspace-disk.ps1', import.meta.url));
      const scratch = mkdtempSync(path.join(tmpdir(), 'fika-workspace-health-'));
      const candidateFile = path.join(scratch, 'candidates.json');
      try {
        writeFileSync(candidateFile, JSON.stringify([]));
        disk = JSON.parse(command('pwsh', ['-NoProfile', '-File', script, '-ScanRoot', scanRoot, '-CandidatesFile', candidateFile],
          { maxBuffer: 8 * 1024 * 1024, timeout: 120000 }));
      } finally {
        if (localEntry(candidateFile)) unlinkSync(candidateFile);
        rmdirSync(scratch);
      }
      const downloadCache = path.join(sharedNpmCache(), '_cacache');
      const cacheEntry = localEntry(downloadCache);
      const cache = cacheEntry?.isDirectory() ? JSON.parse(command('pwsh', ['-NoProfile', '-File', script, '-ScanRoot', downloadCache],
        { maxBuffer: 8 * 1024 * 1024, timeout: 120000 })) : null;
      disk.sharedNpmDownloads = { directory: downloadCache, fileAllocationBytes: cache?.fileAllocationBytes ?? 0,
        ...(cache ? { unreadableDirectories: cache.unreadableDirectories } : {}) };
    } else disk.physicalScan = 'Windows NTFS scan unavailable on this platform';
  }
  return { observedAt: new Date().toISOString(), ...inventory, disk, minimumFreeGB,
    completedAwaitingCleanup: inventory.entries.filter(entry => entry.state === 'awaiting-cleanup').length,
    retirementResidues: inventory.entries.filter(entry => entry.state === 'retirement-residue').length,
    activeWorktrees: inventory.entries.filter(entry => entry.state === 'active').length,
    warnings: [
      ...(disk.volumeFreeBytes < minimumFreeGB * 1e9 ? [`Free volume space is below ${minimumFreeGB} GB`] : []),
      ...(disk.fileAllocationBytes > 50e9 ? ['FIKA OS file allocation exceeds the 50 GB target'] : []),
      ...(disk.unreadableDirectories ? ['Some directories could not be measured'] : []),
    ] };
}
