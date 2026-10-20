import bcrypt from "bcryptjs";

/** Delete through the verified D1 cascades, rather than the SDK's sequential
 * session/account/user deletes. A suppressed cascade or user delete must leave
 * the user's password and sessions intact so the coordinator can be retried.
 */
export async function deleteAuthenticatedAccount(
  database: D1Database,
  userId: string,
  sessionId: string,
  password: string,
): Promise<void> {
  const credentials = await database.prepare(`
    SELECT account.id, account.password
    FROM account JOIN "user" ON "user".id = account.userId
      JOIN session ON session.userId = "user".id
    WHERE "user".id = ? AND "user".banned = 0 AND session.id = ?
      AND julianday(session.expiresAt) > julianday(?)
      AND account.providerId = 'credential'
    LIMIT 2
  `).bind(userId, sessionId, new Date().toISOString()).all<{ id: string; password: string | null }>();
  const credential = credentials.results[0];
  if (!credentials.success || credentials.results.length !== 1 ||
      typeof credential?.password !== "string" || !await bcrypt.compare(password, credential.password)) {
    throw new Error("auth_delete_unavailable");
  }
  const statements = [
    database.prepare(`SELECT CASE WHEN EXISTS (
      SELECT 1 FROM "user" JOIN session ON session.userId = "user".id
        JOIN account ON account.userId = "user".id
      WHERE "user".id = ? AND "user".banned = 0 AND session.id = ?
        AND julianday(session.expiresAt) > julianday(?)
        AND account.id = ? AND account.providerId = 'credential' AND account.password = ?
    ) AND (SELECT count(*) FROM account WHERE userId = ? AND providerId = 'credential') = 1
      THEN 1 ELSE json('auth_delete_identity_changed') END AS verified`
    ).bind(userId, sessionId, new Date().toISOString(), credential.id, credential.password, userId),
    database.prepare('DELETE FROM "user" WHERE id = ?').bind(userId),
    database.prepare(`SELECT CASE WHEN
      NOT EXISTS (SELECT 1 FROM "user" WHERE id = ?)
      AND NOT EXISTS (SELECT 1 FROM session WHERE userId = ?)
      AND NOT EXISTS (SELECT 1 FROM account WHERE userId = ?)
      AND NOT EXISTS (SELECT 1 FROM "twoFactor" WHERE userId = ?)
      AND NOT EXISTS (SELECT 1 FROM "adminRole" WHERE userId = ?)
      AND NOT EXISTS (SELECT 1 FROM "mfaAssurance" WHERE userId = ?)
      THEN 1 ELSE json('auth_delete_cascade_incomplete') END AS verified`
    ).bind(userId, userId, userId, userId, userId, userId),
  ];
  const results = await database.batch(statements);
  if (results.length !== statements.length || results.some(result => !result.success)) {
    throw new Error("auth_delete_unavailable");
  }
}
