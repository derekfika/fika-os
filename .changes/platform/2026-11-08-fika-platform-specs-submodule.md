# 2026-11-08 — Restore platform specification submodule mapping

Restores the `.gitmodules` mapping for the existing `fika-platform-specs` gitlink. The URL is sourced from the Hub validation workflow's explicit repository checkout; GitHub resolves that historical repository name to `derekfika/fika-os`, where the pinned commit and specification history are retained. No application, deployment, WIF, Firebase, or platform specification content changed.

Validation: verified the gitlink mode and SHA against the existing workflow, checked the repository redirect and pinned commit through GitHub, and ran `git submodule status` successfully after the mapping was added.
Deployment: none.
