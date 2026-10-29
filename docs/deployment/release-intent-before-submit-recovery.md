# Staging intent saved before submission

A release-ledger push can succeed while its following Git fetch fails. The local journal then has neither an intent commit result nor any submission marker, because Firebase submission is write-ahead marked only after the append returns.

The existing governed `deploy --resume --execute` can recover that narrow staging-only gap. The original pending journal must have no intentCommit, submission start/finish/failure or attempt list, and its creation time must exactly match the distributed intent. The ten-minute quiet period runs from that creation time. The existing two identical complete Firebase snapshots, unchanged stable serving traffic, disabled automatic rollouts, absence of new builds/rollouts/operations, readable Cloud Audit Logs with zero create calls, source/approval/rollback binding, per-app release lock and durable single-use claim remain mandatory.

Recovery records the original phase as `not-started-before-intent-readback`, without invented submission timestamps, followed by the one claimed submission. Partial or uncertain submission markers remain blocked. Production is excluded. Do not edit journals, discard the intent or submit an ad hoc rollout.
