import type { Actor, HubRole } from "./auth";

export const CanonicalPermissions = ["canonical.view", "canonical.create", "canonical.edit", "oploc.approve-identity", "oploc.approve-location-type", "oploc.link-address", "oploc.replace-address", "address.view", "address.create", "address.edit", "address.approve", "address.lifecycle", "address.lock", "address.prepare-publication", "address.publish", "legend.approve", "employment.manage", "operational-assignment.approve", "operational-capability.approve-catalogue", "operational-capability.approve-enablement", "canonical.lifecycle", "canonical.prepare-publication", "canonical.publish", "canonical.lock"] as const;
export type CanonicalPermission = typeof CanonicalPermissions[number];

const grants: Record<HubRole, readonly CanonicalPermission[]> = {
  "integration-admin": CanonicalPermissions,
  reviewer: ["canonical.view", "canonical.create", "canonical.edit", "address.view", "address.create", "address.edit", "address.prepare-publication", "canonical.prepare-publication"],
  viewer: ["canonical.view", "address.view"],
};

export function hasPermission(actor: Actor, permission: CanonicalPermission) { return grants[actor.role].includes(permission); }
export function assertPermission(actor: Actor, permission: CanonicalPermission) { if (!hasPermission(actor, permission)) throw Object.assign(new Error(`Permission denied for ${permission}.`), { status: 403 }); }
export function permissionsForRole(role: HubRole) { return [...grants[role]]; }
