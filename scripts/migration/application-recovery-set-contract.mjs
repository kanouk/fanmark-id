/** Synthetic proof constants only; importing this never loads the Worker runtime. */
export const databaseRoles=Object.freeze(['S_AUTH','S_BUSINESS','S_MASTER','T_AUTH','T_BUSINESS','T_MASTER']);
export const bucketRoles=Object.freeze(['S_AVATARS','S_COVERS','T_AVATARS','T_COVERS','CONTROL']);
export const fixturePassword='Synthetic-owned-recovery!2026';
export const fixtureUser='90000000-0000-4000-8000-000000000001';
export const PROOF_MASTER_BODY_BYTES=16*1024*1024;
export const PROOF_RESTORE_BODY_BYTES=64*1024*1024;
