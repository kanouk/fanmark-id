// Aggregate-only, read-only D1 preflight. No remote CLI, credentials or writes.
// These checks do not compare source identities, prove MFA portability or grant migration approval.
export const AUTH_IDENTITY_PREFLIGHT_SQL = `SELECT
  (SELECT count(*) FROM "user") AS users,
  (SELECT count(*) FROM "account") AS accounts,
  (SELECT count(*) FROM "twoFactor") AS factors,
  (SELECT count(*) FROM "adminRole") AS admins,
  (SELECT count(*) FROM "user" WHERE typeof("emailVerified") <> 'integer' OR "emailVerified" NOT IN (0,1)
    OR typeof("twoFactorEnabled") <> 'integer' OR "twoFactorEnabled" NOT IN (0,1)
    OR typeof(banned) <> 'integer' OR banned NOT IN (0,1)) AS invalidUserFlags,
  (SELECT count(*) FROM "twoFactor" WHERE typeof(verified) <> 'integer' OR verified NOT IN (0,1)) AS invalidFactorFlags,
  (SELECT CASE WHEN EXISTS (SELECT 1 FROM pragma_index_list('account') i
    WHERE i.name = 'account_providerId_accountId_key' AND i."unique" = 1 AND i.partial = 0
      AND (SELECT count(*) FROM pragma_index_info('account_providerId_accountId_key')) = 2
      AND EXISTS (SELECT 1 FROM pragma_index_info('account_providerId_accountId_key') WHERE seqno = 0 AND name = 'providerId')
      AND EXISTS (SELECT 1 FROM pragma_index_info('account_providerId_accountId_key') WHERE seqno = 1 AND name = 'accountId'))
    THEN 0 ELSE 1 END) AS missingIdentityUniquenessConstraint,
  (SELECT count(*) FROM (SELECT 1 FROM "account" GROUP BY "providerId", "accountId" HAVING count(*) > 1)) AS duplicateIdentityGroups,
  (SELECT count(*) FROM (SELECT 1 FROM "account" WHERE "providerId" = 'credential' GROUP BY "userId" HAVING count(*) > 1)) AS duplicateCredentialUsers,
  (SELECT count(*) FROM "account" a LEFT JOIN "user" u ON u.id = a."userId" WHERE u.id IS NULL) AS orphanAccounts,
  (SELECT count(*) FROM "account" WHERE trim("providerId") = '' OR trim("accountId") = '') AS emptyIdentityKeys,
  (SELECT count(*) FROM "account" WHERE "providerId" NOT IN ('credential','google','github','discord','apple')) AS unsupportedProviderAccounts,
  (SELECT count(*) FROM "account" WHERE "providerId" = 'credential' AND "accountId" <> "userId") AS credentialSubjectMismatches,
  (SELECT count(*) FROM (SELECT 1 FROM "twoFactor" GROUP BY "userId" HAVING count(*) > 1)) AS duplicateFactorUsers,
  (SELECT count(*) FROM "twoFactor" f LEFT JOIN "user" u ON u.id = f."userId" WHERE u.id IS NULL) AS orphanFactors,
  (SELECT count(*) FROM "user" u WHERE u."twoFactorEnabled" = 1 AND NOT EXISTS
    (SELECT 1 FROM "twoFactor" f WHERE f."userId" = u.id AND f.verified = 1)) AS enabledMfaWithoutVerifiedFactor,
  (SELECT count(*) FROM "twoFactor" f JOIN "user" u ON u.id = f."userId"
    WHERE f.verified = 1 AND u."twoFactorEnabled" <> 1) AS verifiedFactorWithoutEnabledMfa,
  (SELECT count(*) FROM "adminRole" a LEFT JOIN "user" u ON u.id = a."userId" WHERE u.id IS NULL) AS orphanAdminRoles,
  (SELECT count(*) FROM "adminRole" WHERE role <> 'admin') AS unsupportedAdminRoles,
  (SELECT count(*) FROM "adminRole" a JOIN "user" u ON u.id = a."userId" WHERE a.role = 'admin' AND
    (u."twoFactorEnabled" <> 1 OR NOT EXISTS (SELECT 1 FROM "twoFactor" f WHERE f."userId" = u.id AND f.verified = 1))) AS adminsWithoutReadyMfa`;

const totals = ["users", "accounts", "factors", "admins"];
const checks = ["invalidUserFlags", "invalidFactorFlags", "missingIdentityUniquenessConstraint", "duplicateIdentityGroups", "duplicateCredentialUsers", "orphanAccounts", "emptyIdentityKeys",
  "unsupportedProviderAccounts", "credentialSubjectMismatches", "duplicateFactorUsers", "orphanFactors",
  "enabledMfaWithoutVerifiedFactor", "verifiedFactorWithoutEnabledMfa", "orphanAdminRoles", "unsupportedAdminRoles", "adminsWithoutReadyMfa"];

export async function inspectAuthIdentityReadiness(database) {
  let result;
  try { result = await database.prepare(AUTH_IDENTITY_PREFLIGHT_SQL).all(); }
  catch { throw new Error("auth_identity_preflight_read_failed"); }
  const row = result?.results?.[0];
  if (result?.success !== true || !Array.isArray(result.results) || result.results.length !== 1 || !row ||
      JSON.stringify(Object.keys(row).sort()) !== JSON.stringify([...totals, ...checks].sort()) ||
      Object.values(row).some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error("auth_identity_preflight_result_invalid");
  }
  return { scope: "auth-d1-aggregate-only", productionReady: false,
    identityAndMfaChecksPassed: checks.every((name) => row[name] === 0),
    totals: Object.fromEntries(totals.map((name) => [name, row[name]])),
    blockers: Object.fromEntries(checks.map((name) => [name, row[name]])) };
}
