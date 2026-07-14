const USER_OPERATIONAL_VIEW_VERSION = 2;

function cleanIds(values, primaryCompanyId) {
  const ids = Array.isArray(values)
    ? values.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  const primary = String(primaryCompanyId || '').trim();
  if (primary && !ids.includes(primary)) ids.unshift(primary);
  return [...new Set(ids)];
}

function buildUserOperationalView(userId, companyId, source) {
  const data = source || {};
  return {
    uid: userId,
    companyId,
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
    createdAt: data.createdAt || null,
  };
}

function userOperationalViewId(companyId, userId) {
  return `${companyId}__${userId}`;
}

module.exports = {
  buildUserOperationalView,
  cleanIds,
  userOperationalViewId,
  USER_OPERATIONAL_VIEW_VERSION,
};
