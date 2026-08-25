import { getPrimaryCustodian } from "./authmod-core";
import type { AuthModRepository } from "./authmod-core";
import { isEffective } from "./authmod-core";

export async function buildAuthmodAccounts(repository: AuthModRepository, query: { search?: string; kind?: string; status?: string; siteId?: string; appId?: string; special?: boolean } = {}) {
  const [identities, applications, oplocs, legends] = await Promise.all([repository.listIdentities(), repository.listApplications(), repository.listActiveOplocs(), repository.listLegendReferences()]);
  const legendNames = new Map(legends.map(value => [value.id, value.label])); const oplocNames = new Map(oplocs.map(value => [value.id, value.label])); const appNames = new Map(applications.map(value => [value.appId, value.displayName])); const needle = query.search?.trim().toLowerCase();
  const rows = [];
  for (const identity of identities) {
    const unresolved = identity.identityKind === "person" ? identity.identityLinkStatus !== "matched" : !identity.representedOplocId && !identity.operationalPurpose;
    if (query.kind && identity.identityKind !== query.kind) continue; if (query.status && query.status !== "all" && (query.status === "unresolved" ? !unresolved : identity.status !== query.status)) continue;
    const [sites, apps, grants, custodian] = await Promise.all([repository.listSiteAssignments(identity.id), repository.listAppAssignments(identity.id), repository.listAuthorityGrants(identity.id, "interactive"), getPrimaryCustodian(repository, identity.id)]);
    const activeSites = sites.filter(value => isEffective(value)).map(value => ({ id: value.oplocId, label: oplocNames.get(value.oplocId) || value.oplocId })); const activeApps = apps.filter(value => isEffective(value)).map(value => ({ id: value.appId, label: appNames.get(value.appId) || value.appId })); const special = grants.filter(value => isEffective(value) && value.provenance !== "standard-app-access").map(value => ({ id: value.id, resource: value.resource, action: value.action, scope: value.scope, reason: value.reason, provenance: value.provenance }));
    const text = [identity.displayName, identity.normalizedEmail, identity.operationalPurpose, identity.representedOplocId, identity.legendId, custodian?.custodianLegendId, ...activeSites.map(value => value.label)].filter(Boolean).join(" ").toLowerCase();
    if (needle && !text.includes(needle)) continue; if (query.siteId && !activeSites.some(value => value.id === query.siteId)) continue; if (query.appId && !activeApps.some(value => value.id === query.appId)) continue; if (query.special && !special.length) continue;
    rows.push({ identity: { id: identity.id, displayName: identity.displayName, email: identity.normalizedEmail, identityKind: identity.identityKind, status: identity.status, identityLinkStatus: identity.identityLinkStatus, legendId: identity.legendId, legendLabel: identity.legendId ? legendNames.get(identity.legendId) || identity.legendId : undefined, representedOplocId: identity.representedOplocId, representedOplocLabel: identity.representedOplocId ? oplocNames.get(identity.representedOplocId) || identity.representedOplocId : undefined, operationalPurpose: identity.operationalPurpose, provenance: identity.provenance, version: identity.version }, custodian: custodian ? { id: custodian.id, legendId: custodian.custodianLegendId, label: legendNames.get(custodian.custodianLegendId) || custodian.custodianLegendId, version: custodian.version } : undefined, sites: activeSites, apps: activeApps, specialAuthority: special, fullAccess: identity.identityKind === "person" && identity.fullAccess, authmodAdmin: identity.identityKind === "person" && special.some(value => value.resource === "authmod" && value.action === "Administer") });
  }
  return rows.sort((a, b) => a.identity.displayName.localeCompare(b.identity.displayName));
}

export async function buildAuthmodAccount(repository: AuthModRepository, id: string) { const rows = await buildAuthmodAccounts(repository); const row = rows.find(value => value.identity.id === id); if (!row) throw Object.assign(new Error("AUTHMOD identity not found."), { status: 404 }); return row; }
