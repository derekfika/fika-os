import type { IdentityKind } from "./authmod-core/model";

export type LauncherGreetingIdentity = {
  principalType?: "interactive" | "service";
  identityKind?: IdentityKind;
  /** A structured, trusted personal-name field. Never derive this from displayName. */
  firstName?: string;
};

export function launcherGreeting(identity: LauncherGreetingIdentity, now = new Date()) {
  const hour = now.getHours();
  const period = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = identity.principalType !== "service" && identity.identityKind === "person" && identity.firstName?.trim();
  return firstName ? `${period}, ${firstName}` : period;
}
