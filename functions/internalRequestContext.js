function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildInternalCompanyContext(user, role) {
  const primaryCompanyId = cleanText(user?.primaryCompanyId);
  const companyIds = Array.isArray(user?.companyIds)
    ? [...new Set(user.companyIds.map(cleanText).filter(Boolean))]
    : [];
  const companyId = primaryCompanyId || companyIds[0] || '';
  if (companyId && !companyIds.includes(companyId)) companyIds.unshift(companyId);

  const globalAdmin = role === 'admin' && user?.globalAdmin === true;
  return {
    companyId,
    companyIds,
    globalAdmin,
    requiresCompany: !globalAdmin && !companyId,
  };
}

module.exports = {
  buildInternalCompanyContext,
};
