import { digest, derivedId } from './identity.js';

export function semanticSnapshotValidation(snapshot, config) {
  const errors = [];
  if (snapshot.scope.windowStart >= snapshot.scope.windowEnd) {
    errors.push({ keyword: 'windowOrder', message: 'windowStart must be before windowEnd' });
  }
  if (snapshot.scope.asOf < snapshot.scope.windowEnd) {
    errors.push({ keyword: 'asOf', message: 'asOf must not precede windowEnd' });
  }
  if (snapshot.scope.producingOperationalLocationId !== config.producingOperationalLocationId) {
    errors.push({ keyword: 'producingOperationalLocationId', message: 'snapshot producer differs from approved test configuration' });
  }
  if (snapshot.source.intakeReference !== config.intakeReference) {
    errors.push({ keyword: 'intakeReference', message: 'snapshot intake differs from approved test configuration' });
  }
  const expectedIntegrity = digest(snapshot.observations);
  if (snapshot.integrity.observationsSha256 !== expectedIntegrity) {
    errors.push({ keyword: 'observationsSha256', message: 'observation integrity digest does not match canonical observations' });
  }
  const observationIds = new Set();
  for (const observation of snapshot.observations) {
    if (observationIds.has(observation.observationId)) {
      errors.push({ keyword: 'uniqueObservationId', message: `duplicate observationId: ${observation.observationId}` });
    }
    observationIds.add(observation.observationId);
  }
  return { valid: errors.length === 0, errors };
}

export function quarantineEvidence({ snapshot, errors, config, asOf }) {
  const inputDigest = digest(snapshot);
  return {
    evidenceType: 'fika.cpu-shadow.quarantine-evidence',
    evidenceVersion: '1.0.0',
    quarantineId: derivedId('quarantine', { inputDigest, errors, asOf }),
    inputDigest,
    asOf,
    contract: snapshot?.contract ?? null,
    configVersion: config?.configVersion ?? null,
    producingOperationalLocationId: config?.producingOperationalLocationId ?? null,
    intakeReference: config?.intakeReference ?? null,
    outcome: 'rejected',
    errors,
    sourceInputPreserved: true,
  };
}
