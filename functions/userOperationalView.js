const USER_OPERATIONAL_VIEW_VERSION = 4;

function cleanIds(values, primaryCompanyId) {
  const ids = Array.isArray(values)
    ? values.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  const primary = String(primaryCompanyId || '').trim();
  if (primary && !ids.includes(primary)) ids.unshift(primary);
  return [...new Set(ids)];
}

function cleanNames(values, primaryCompanyName) {
  const names = Array.isArray(values)
    ? values.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  const primary = String(primaryCompanyName || '').trim();
  if (primary && !names.includes(primary)) names.unshift(primary);
  return [...new Set(names)];
}

function buildUserOperationalView(userId, companyId, source) {
  const data = source || {};
  const companyNames = cleanNames(data.companyNames, data.primaryCompanyName);
  return {
    uid: userId,
    companyId,
    primaryCompanyId: String(data.primaryCompanyId || data.companyId || companyId || ''),
    primaryCompanyName: String(data.primaryCompanyName || companyNames[0] || ''),
    companyNames,
    fullName: String(data.fullName || ''),
    email: String(data.email || ''),
    active: data.active === true,
    accessStatus: String(data.accessStatus || ''),
    role: String(data.role || 'angajat'),
    roleTitle: String(data.roleTitle || ''),
    department: String(data.department || ''),
    themeKey: data.themeKey || null,
    avatarUrl: String(data.avatarUrl || ''),
    avatarThumbUrl: String(data.avatarThumbUrl || data.avatarUrl || ''),
    isOnline: data.isOnline === true,
    lastSeenAt: data.lastSeenAt || data.lastSeenAtServer || null,
    lastActiveAt: data.lastActiveAt || data.lastActiveAtServer || null,
    lastSiteEnteredAt: data.lastSiteEnteredAt || data.lastSiteEnteredAtServer || null,
    createdAt: data.createdAt || null,
  };
}

function userOperationalViewId(companyId, userId) {
  return `${companyId}__${userId}`;
}

module.exports = {
  buildUserOperationalView,
  cleanIds,
  cleanNames,
  userOperationalViewId,
  USER_OPERATIONAL_VIEW_VERSION,
};
