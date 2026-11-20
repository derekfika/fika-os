export function fixtureMenuAccess(scopeKey: string) {
  return {
    canManage: true,
    canManageOrganisation: true,
    canManageAllSites: true,
    canPublish: true,
    canPublishAllSites: true,
    manageOplocIds: [],
    scopeKey,
  };
}

export function fixtureMenuScopeHeaders(scopeKey: string) {
  return { "x-fika-menu-identity": scopeKey, "x-fika-menu-cache-scope": scopeKey };
}
