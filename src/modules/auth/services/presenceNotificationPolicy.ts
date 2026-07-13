export type PresenceNotificationUser = {
  globalAdmin?: boolean;
  primaryCompanyId?: string;
  companyIds?: string[];
};

export function shouldDispatchSiteEnteredNotification(
  user: PresenceNotificationUser
): boolean {
  const hasCompany =
    Boolean(user.primaryCompanyId?.trim()) ||
    Boolean(user.companyIds?.some((companyId) => companyId.trim().length > 0));

  return user.globalAdmin !== true || hasCompany;
}
