import { parseCanonical } from "./schemas";
import { sha256, stableId } from "./profiler";
import type { CanonicalRecord } from "./types";

export type LegendReemploymentMerge = {
  survivorCanonicalId: string;
  memberCanonicalIds: string[];
  profileSourceCanonicalId: string;
};

export type MergeActor = { uid: string; name: string };

export function planLegendReemploymentMerge(
  records: CanonicalRecord[],
  input: LegendReemploymentMerge,
  actor: MergeActor,
  now: string,
) {
  const members = input.memberCanonicalIds.map((canonicalId) => {
    const record = records.find((candidate) => candidate.canonicalId === canonicalId);
    if (!record || record.entityType !== "Legend")
      throw new Error(`Legend merge member ${canonicalId} does not exist.`);
    if (record.lifecycleStatus === "archived")
      throw new Error(`Legend merge member ${canonicalId} is already archived.`);
    return record;
  });
  if (new Set(input.memberCanonicalIds).size !== input.memberCanonicalIds.length)
    throw new Error("Legend merge members must be unique.");
  const survivor = members.find(
    (record) => record.canonicalId === input.survivorCanonicalId,
  );
  const profileSource = members.find(
    (record) => record.canonicalId === input.profileSourceCanonicalId,
  );
  if (!survivor || !profileSource)
    throw new Error("The survivor and profile source must both be merge members.");

  const identities = uniqueExternalIdentities(
    members.flatMap((record) => externalIdentities(record.record)),
  );
  if (identities.length !== members.length)
    throw new Error(
      "Each re-employment Legend must have one distinct provider identity before merging.",
    );

  const mergedRecord = structuredClone(survivor.record);
  mergedRecord.displayName = profileSource.record.displayName;
  if (profileSource.record.preferredName)
    mergedRecord.preferredName = profileSource.record.preferredName;
  else delete mergedRecord.preferredName;
  if (profileSource.record.workEmail)
    mergedRecord.workEmail = profileSource.record.workEmail;
  else delete mergedRecord.workEmail;
  delete mergedRecord.jobTitle;
  delete mergedRecord.employmentState;
  delete mergedRecord.terminationDate;
  delete mergedRecord.terminated;
  mergedRecord.active = true;
  mergedRecord.externalIdentities = identities;
  mergedRecord.provenanceIds = [
    ...new Set(
      members.flatMap((record) =>
        Array.isArray(record.record.provenanceIds)
          ? record.record.provenanceIds.map(String)
          : [],
      ),
    ),
  ];
  mergedRecord.ownership = mergedOwnership(members, profileSource, identities);
  mergedRecord.version = Number(survivor.record.version || 0) + 1;
  mergedRecord.updatedAt = now;
  mergedRecord.updatedBy = actor.uid;

  const nextSurvivor: CanonicalRecord = {
    ...survivor,
    record: mergedRecord,
    dataHash: sha256(JSON.stringify(mergedRecord)),
  };
  assertValid("Legend", nextSurvivor.record);

  const archived = members
    .filter((record) => record.canonicalId !== survivor.canonicalId)
    .map((record) => {
      const historical = structuredClone(record.record);
      historical.externalIdentities = [];
      historical.active = false;
      historical.version = Number(record.record.version || 0) + 1;
      historical.updatedAt = now;
      historical.updatedBy = actor.uid;
      const next: CanonicalRecord = {
        ...record,
        record: historical,
        dataHash: sha256(JSON.stringify(historical)),
        lifecycleStatus: "archived",
        publicationStatus: "withdrawn",
        archivedAt: now,
      };
      assertValid("Legend", next.record);
      return next;
    });

  const employments = members.map((source) => {
    const identity = externalIdentities(source.record)[0];
    const provider = providerFacts(source.record);
    const employmentRecord: Record<string, unknown> = {
      schemaVersion: "0.1.0",
      version: 1,
      createdAt: now,
      createdBy: actor.uid,
      updatedAt: now,
      updatedBy: actor.uid,
      active: true,
      externalIdentities: [identity],
      provenanceIds: Array.isArray(source.record.provenanceIds)
        ? source.record.provenanceIds.map(String)
        : [],
      ownership: {
        providerOwned: {
          employmentState: String(
            provider.employmentState || source.record.employmentState || "Unknown",
          ),
          ...(provider.terminationDate
            ? { terminationDate: provider.terminationDate }
            : {}),
          ...(provider.jobTitle ? { contractualJobTitle: provider.jobTitle } : {}),
          externalIdentity: identity,
        },
        fikaOwned: {},
      },
      entityType: "Employment",
      canonicalId: stableId(
        "employment",
        `${identity.provider}:${identity.externalId}`,
      ),
      legendId: survivor.canonicalId,
      employmentState: String(
        provider.employmentState || source.record.employmentState || "Unknown",
      ),
      ...(provider.terminationDate
        ? { terminationDate: String(provider.terminationDate) }
        : {}),
      ...(provider.jobTitle
        ? { contractualJobTitle: String(provider.jobTitle) }
        : {}),
    };
    assertValid("Employment", employmentRecord);
    return {
      canonicalId: String(employmentRecord.canonicalId),
      entityType: "Employment" as const,
      record: employmentRecord,
      dataHash: sha256(JSON.stringify(employmentRecord)),
      lifecycleStatus: "needs-review" as const,
    } satisfies CanonicalRecord;
  });

  return { survivor: nextSurvivor, archived, employments };
}

function externalIdentities(record: Record<string, unknown>) {
  return (Array.isArray(record.externalIdentities) ? record.externalIdentities : [])
    .filter(
      (identity): identity is Record<string, unknown> =>
        Boolean(identity && typeof identity === "object"),
    )
    .map((identity) => ({
      provider: String(identity.provider || "").trim().toLowerCase(),
      externalId: String(identity.externalId || "").trim(),
      ...(identity.providerVersion !== undefined
        ? { providerVersion: String(identity.providerVersion) }
        : {}),
      ...(identity.providerUpdatedAt
        ? { providerUpdatedAt: String(identity.providerUpdatedAt) }
        : {}),
    }))
    .filter((identity) => identity.provider && identity.externalId);
}

function uniqueExternalIdentities(
  identities: ReturnType<typeof externalIdentities>,
) {
  return [
    ...new Map(
      identities.map((identity) => [
        `${identity.provider}\u0000${identity.externalId}`,
        identity,
      ]),
    ).values(),
  ];
}

function providerFacts(record: Record<string, unknown>) {
  const ownership = record.ownership as
    | { providerOwned?: Record<string, unknown> }
    | undefined;
  return ownership?.providerOwned || {};
}

function mergedOwnership(
  members: CanonicalRecord[],
  profileSource: CanonicalRecord,
  identities: ReturnType<typeof externalIdentities>,
) {
  const sourceOwnership = structuredClone(
    (profileSource.record.ownership as Record<string, unknown> | undefined) || {},
  );
  const sourceProviderOwned = providerFacts(profileSource.record);
  const fikaOwned = Object.assign(
    {},
    ...members.map((record) => {
      const ownership = record.record.ownership as
        | { fikaOwned?: Record<string, unknown> }
        | undefined;
      return ownership?.fikaOwned || {};
    }),
  );
  const providerOwned: Record<string, unknown> = {
    ...sourceProviderOwned,
    externalIdentities: identities,
  };
  delete providerOwned.jobTitle;
  delete providerOwned.employmentState;
  delete providerOwned.terminationDate;
  delete providerOwned.terminated;
  return { ...sourceOwnership, providerOwned, fikaOwned };
}

function assertValid(type: "Legend" | "Employment", record: unknown) {
  const result = parseCanonical(type, record);
  if (!result.success)
    throw new Error(
      `${type} merge output is invalid: ${result.error.issues[0]?.message || "unknown validation error"}`,
    );
}
