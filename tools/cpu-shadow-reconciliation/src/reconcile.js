import { canonicalise } from './canonical-json.js';
import { digest, derivedId } from './identity.js';

const unresolvedSemantics = [
  'eligibility',
  'production-lifecycle',
  'required-ready-time',
  'stable-production-line-identity',
  'ordered-and-production-units',
  'conversion-and-yield',
  'production-routing',
  'dietary-allergen-allocation',
  'amendment-meaning',
  'cancellation-meaning',
];

function sorted(values) {
  return [...new Set(values)].sort();
}

export function reconcile(snapshot, config, explicitAsOf) {
  if (explicitAsOf !== snapshot.scope.asOf) {
    throw new Error('Explicit --as-of must exactly match snapshot.scope.asOf.');
  }

  const snapshotDigest = digest(snapshot);
  const configDigest = digest(config);
  const mappingRunId = derivedId('mapping-run', {
    snapshotDigest,
    configDigest,
    mapping: config.mapping,
    asOf: explicitAsOf,
  });
  const reconciliationRunId = derivedId('reconciliation-run', { mappingRunId, snapshotDigest });

  const recordOccurrences = new Map();
  for (const observation of snapshot.observations) {
    const id = observation.sourceRecord.sourceRecordId;
    recordOccurrences.set(id, [...(recordOccurrences.get(id) ?? []), observation.observationId]);
  }

  const discrepancies = [];
  for (const [sourceRecordId, observationIds] of recordOccurrences) {
    if (observationIds.length > 1) {
      const detail = { type: 'duplicate-source-record', sourceRecordId, observationIds: sorted(observationIds) };
      discrepancies.push({ discrepancyId: derivedId('discrepancy', detail), ...detail });
    }
  }

  const observations = snapshot.observations.map((observation) => {
    const shadowOrderId = derivedId('shadow-order', {
      snapshotId: snapshot.snapshotId,
      sourceRecordId: observation.sourceRecord.sourceRecordId,
    });
    const shadowLines = observation.extracted.items.map((item, index) => ({
      shadowLineId: derivedId('shadow-line', {
        shadowOrderId,
        sourceLineReference: item.sourceLineReference,
        index,
        description: item.description,
      }),
      sourceLineReference: item.sourceLineReference,
      orderedQuantity: item.orderedQuantity,
      mappingOutcome: item.sourceLineReference ? 'source-reference-preserved' : 'stable-line-identity-unresolved',
    }));
    const partial = !observation.extracted.serviceLabel
      || shadowLines.some((line) => line.orderedQuantity.value === null || line.orderedQuantity.unit === null);
    return {
      sourceObservationId: observation.observationId,
      sourceRecordId: observation.sourceRecord.sourceRecordId,
      shadowOrderId,
      shadowLines,
      mappingOutcome: partial ? 'partial-source-observation' : 'source-observation-only',
      warnings: sorted(observation.warnings),
      uncertainties: sorted(observation.uncertainties),
      exclusions: sorted([...observation.exclusions, ...unresolvedSemantics]),
      sourceProvenance: {
        observedAt: observation.observedAt,
        providerUpdatedAt: observation.sourceRecord.providerUpdatedAt ?? null,
        recurrenceId: observation.sourceRecord.recurrenceId ?? null,
      },
      stateEvidence: observation.stateEvidence,
      serviceTime: observation.serviceTime,
      dietaryInformationPresence: observation.extracted.dietaryInformationPresence,
    };
  }).sort((a, b) => a.sourceObservationId.localeCompare(b.sourceObservationId));

  const body = {
    evidenceType: 'fika.cpu-shadow.reconciliation-evidence',
    evidenceVersion: '1.0.0',
    contract: snapshot.contract,
    configuration: {
      configName: config.configName,
      configVersion: config.configVersion,
      classification: config.classification,
      canonicalPersistencePermitted: false,
      hostOperationalLocationId: config.hostOperationalLocationId,
      producingOperationalLocationId: config.producingOperationalLocationId,
      intakeReference: config.intakeReference,
      hostingAssertion: config.hostingAssertion,
    },
    governance: config.governance,
    mapping: config.mapping,
    mappingRunId,
    reconciliationRunId,
    snapshot: {
      snapshotId: snapshot.snapshotId,
      snapshotDigest,
      classification: snapshot.classification,
      scope: snapshot.scope,
      provenance: snapshot.provenance,
      omissions: sorted(snapshot.omissions),
    },
    asOf: explicitAsOf,
    outcome: discrepancies.length ? 'completed-with-discrepancies' : 'completed',
    warnings: sorted(observations.flatMap((item) => item.warnings)),
    uncertainties: sorted(observations.flatMap((item) => item.uncertainties)),
    exclusions: sorted(observations.flatMap((item) => item.exclusions)),
    discrepancies: discrepancies.sort((a, b) => a.discrepancyId.localeCompare(b.discrepancyId)),
    observations,
  };

  return canonicalise({
    ...body,
    evidenceExportId: derivedId('evidence-export', body),
  });
}
