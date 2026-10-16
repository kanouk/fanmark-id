# Credential transform design

This document defines the next private migration unit: transforming one
credential-bearing source row into one destination bcrypt credential and
reconciling that result in D1. It is a design contract only. It does not read
source rows, create D1 resources, write credentials, change a runtime writer,
or switch the frontend.

The contract deliberately contains no source password values, source hashes,
user rows, current format classifications, or provider-specific weakness
findings. The source envelope and all credential-bearing artifacts stay in the
restricted migration channel described below.

## Boundaries and authority

The source row is read from one independently verified, encrypted, and
access-controlled private source artifact. That artifact is byte-for-byte
immutable. It may contain the credential-bearing source bytes needed by the
restricted transform, but public manifests and reports carry only an opaque
artifact identity and digest; they never contain or export those bytes. The
importer consumes the exact source bytes and must not normalize, rewrite, or
construct a replacement source envelope.

The immutable artifact's canonical bytes and digest are bound to the source
snapshot manifest, catalog/schema contract, row identity, transform contract
version, destination identity, and codec policy. Reusing a source primary key
with different artifact bytes is a new source revision and is rejected by the
original artifact binding; it cannot silently replace a previous destination
credential. Encryption, access control, and the private source-artifact
retention/cleanup gate are prerequisites for any real source export.

A migration phase has one write authority for a license. Supabase and D1 must
not both accept writes for the same password configuration. A wrapper that
writes Supabase and D1 cannot make those two databases atomic. Before D1
writes are enabled, the existing writer is frozen or revoked at a reviewed
snapshot/drain boundary. During the D1 phase, the Worker and its D1
transaction are the single authority. A compatibility adapter may route to
that authority, but it may not dual-write. Any rollback first freezes the
current authority and performs a reviewed state transition; live dual-writer
rollback is out of contract.

## Stable artifact binding

The importer creates one transform artifact per source-row binding. The
binding key is the canonical tuple of:

```text
(destination_identity,
 source_manifest_digest,
 source_relation,
 source_primary_key,
 source_envelope_digest,
 destination_license_id,
 destination_incarnation,
 transform_contract_version,
 codec_id,
 policy_version)
```

The tuple is encoded canonically and stored as an internal
`source_binding_digest`. It does not contain a caller-selected label or a
runtime request token. The destination identity and license incarnation stop a
new or recreated D1 target from being mistaken for the old target.

The destination transform has a separate `destination_transform_digest`. It is
computed over the canonical destination artifact, including the exact
bcrypt-encoded result, destination license/incarnation, enabled state,
codec/parameters, and the source binding digest. The source binding digest and
the destination transform digest are different fields with different jobs:
source identity is used for idempotency, while the destination digest is used
for transformed-artifact readback. Neither digest is exposed through the
public access API or ordinary logs.

The protected transform ledger has, at minimum, the following fields:

```text
artifact_id
artifact_key                 UNIQUE
source_binding_digest        UNIQUE per destination identity
source_manifest_digest
source_relation
source_primary_key
source_envelope_digest
source_revision
destination_license_id
destination_incarnation
codec_id
codec_parameters_version
policy_version
destination_hash              protected; never in public reports
destination_transform_digest UNIQUE per destination identity
state                        reserved | prepared | applied | reconciled | rejected
lease_id                     internal, expiring, never caller-supplied
lease_expires_at
fencing_token                monotonic per artifact claim
created_at
prepared_at
applied_at
reconciled_at
failure_code                 bounded, non-secret
```

The exact target schema may place the destination bcrypt string in the
protected access-config row and keep a protected copy in the transform
artifact for recovery. It must never put that string in a public migration
report. The artifact key is unique, and a destination row with the same
binding but a different transform digest is a hard reconciliation failure;
the importer never overwrites it.

## Transform codec

The accepted password input remains the existing four-ASCII-digit user
contract. The transform does not trim, normalize, substitute, or broaden that
input. The destination codec is explicitly pinned to `bcryptjs` 3.0.3 with
cost 10 for this migration contract. The package lock, codec identifier, and
cost are recorded in every artifact. This local codec choice does not satisfy
the separate Cloudflare remote CPU gate, and that gate must not be passed by
weakening the cost.

For an enabled source row, the restricted process validates the existing input
contract, generates one bcrypt result with a cryptographically random salt,
and immediately checks both the expected input and a wrong-input negative
vector. The result is bound to the artifact's separate destination transform
digest. The source input is then discarded. No runtime plaintext comparison is
allowed after cutover.

For a disabled row, the effective destination state is disabled. The importer
must not turn a UI disable sentinel into an enabled credential. It may retain a
previous protected hash or use a non-usable dummy hash if the destination
schema requires a non-null value, but `enabled=false` remains authoritative.

The artifact state machine is:

```text
reserved -> prepared -> applied -> reconciled
     \-> rejected
```

`reserved` records the stable binding and an expiring lease. A claim carries a
server-generated `lease_id` and monotonic `fencing_token`; neither is accepted
from a caller. Only the current unexpired fence may prepare or apply the
artifact. `prepared` durably stores the exact bcrypt result and its
`destination_transform_digest` in the protected artifact/target store. It is
the replay point: every later apply or recovery uses that same result.

Exactly-once bcrypt computation cannot be claimed across a crash after bcrypt
returns but before the `prepared` record is durable. Therefore only an
unprepared `reserved` artifact whose lease has expired may be recomputed under
a new fence. Once `prepared` exists, recomputation is forbidden even when the
destination has not yet been applied; recovery replays the same stored hash.
An ambiguous acknowledgement is reconciled by reading the artifact and target
before retrying. If a prepared hash or destination row cannot be reconciled,
the run stops and requires private repair. This guarantees one applied
transform per binding without pretending that pre-persistence computation is
exactly once.

A rerun first looks up the stable artifact key and then reads the protected
artifact and destination row. If the artifact is `prepared`, `applied`, or
`reconciled`, it verifies the stored destination digest and resumes the
state-machine transition with the same hash; it does not call bcrypt again or
generate a new random salt. A destination row with a different digest is a
hard reconciliation failure. A new source revision, target incarnation, codec
policy, or reviewed repair gets a new binding and artifact ID; it cannot mutate
the old history.

## Credential columns in the general importer

Credential-bearing source columns must not pass through the ordinary scalar
text codec. The general snapshot manifest carries a transformed-column
descriptor for each such column:

```text
source_relation
source_column
source_primary_key_columns
source_envelope_digest
source_row_identity_digest
destination_relation
destination_column
transform_kind              credential_to_bcrypt
codec_id                    bcryptjs@3.0.3
codec_parameters_version
policy_version
coverage                    transformed | disabled
artifact_binding_digest
destination_transform_digest
```

The descriptor is private migration metadata and contains no source credential
bytes. Its `source_envelope_digest` binds the immutable private source
artifact; its `destination_transform_digest` binds the independently produced
bcrypt artifact. They must never be substituted for one another.

When a descriptor is present, the ordinary row converter retains all UUIDs,
foreign-key values, timestamps, and other non-credential columns exactly as
normal, but omits the original credential column from text bindings. It emits
the descriptor's transformed destination relation/column through the
credential transformer. If a credential column appears without a matching
validated descriptor, the general importer fails closed instead of importing
that column as text. This prevents a complete table import from accidentally
placing source credential material in D1.

Readback classifies every source column and row as `copied`, `transformed`, or
`disabled` and requires complete coverage. It checks the source row identity,
UUID relationships, and non-credential values against the ordinary converted
row. For a transformed column it checks the source envelope digest against the
artifact binding and the destination transformed-value digest against the
protected target row; it never compares a source credential value with a D1
text column. Missing descriptors, an extra unclassified credential column, a
mismatched source envelope digest, or a destination digest mismatch blocks
reconciliation. This preserves full-row accounting while keeping the original
credential out of the general D1 snapshot path.

## D1 importer protocol

The row-level importer follows this sequence. The prepared record is durable
before the destination configuration is applied, so recovery can replay one
random-salted result instead of computing another one.

1. Validate the immutable private artifact against the source manifest,
   catalog/schema contract, UUID relationships, enabled state, and destination
   identity. The public manifest contains only the opaque artifact identity and
   digest; it cannot supply credential bytes.
2. Insert or claim the unique `reserved` artifact binding. Claiming creates an
   expiring server-side lease and fencing token. An existing `applied` or
   `reconciled` binding goes straight to readback. An existing `prepared`
   binding may be reclaimed after lease expiry, but its stored hash is reused.
   An incompatible binding fails closed.
3. Resolve the destination license and incarnation without trusting caller IDs.
   Check the owner/resource relationship and current migration lock. A lease
   holder that is no longer current cannot prepare or apply anything.
4. For a current-fence `reserved` artifact only, transform the restricted input
   once with `bcryptjs` 3.0.3/cost 10, verify the positive and negative vectors
   in memory, compute the independent destination transform digest, and issue a
   guarded D1 batch that stores the exact destination hash, digest, codec
   metadata, lease/fence, and state `prepared`. Discard the source input after
   the batch. A crash between bcrypt completion and this batch may cause a
   later recomputation after the unprepared lease expires; exactly-once
   computation cannot be claimed for that interval.
5. For a current-fence `prepared` artifact, issue a guarded D1 batch that
   applies the stored hash to the destination access-config, updates the
   password generation, and transitions the artifact to `applied`. The guard
   requires the same artifact key, destination digest, license incarnation,
   and fencing token. It must not run bcrypt. A zero-row guard or generation
   mismatch aborts the complete batch.
6. Read back explicit destination columns and the protected artifact. Verify
   UUID/incarnation, `enabled`, codec metadata, generation, and the exact
   destination transform digest. If the source input is still present in the
   same controlled process, repeat the bcrypt positive/negative check; never
   persist it for this purpose. A missing target, changed digest, or ambiguous
   acknowledgement is a bounded repair gate.
7. Mark the artifact `reconciled` in a guarded transaction, retaining the
   applied digest and source binding. An expired lease, stale fence, changed
   source artifact, destination row, generation, or target identity remains a
   failure and cannot create another transformed value.

The importer must use the same canonical timestamp/UUID and D1 binding codecs
as the general migration importer. It must preserve existing UUIDs and
relationships; it must not create placeholder Better Auth users or call
application registration flows. Credential transformation is complete only
when the destination row and artifact ledger agree, not when the importer has
successfully called `bind()`.

## Writer and generation handoff

The transform artifact is an import record, not a public verification proof.
After cutover, the authenticated owner writer hashes a new accepted input in
the D1 Worker and updates the same protected access-config representation.
Every effective hash or enabled-state change increments
`password_generation`; license status, expiry, parent-resource state,
selector mapping, profile visibility, protected-content selection, and
license-incarnation changes increment the corresponding lifecycle generation.
Proof revocation and generation updates occur in the same transaction as the
mutation.

The following paths must use the same D1 mutation authority before the
frontend is switched:

- the owner password-settings operation;
- transfer approval and replacement of an old license;
- administrative expiry and scheduled expiry cleanup;
- administrative reset and protected-resource deletion;
- direct license/config/profile/resource delete or replace operations; and
- any future writer that can change the selected protected projection.

A source import is run after the old writer freeze and before the D1 writer is
opened. The final readback must prove that no old writer changed a source row
between snapshot and activation. Adding a new writer without adding its
version bump/revocation operation is a migration stop condition.

## Verification contract

Local synthetic evidence must cover the following without emitting a secret or
hash:

- one accepted existing input transforms and verifies against the destination
  bcrypt row;
- a wrong input is denied and does not create a proof;
- disabled state remains denied;
- rerunning the same source envelope and destination identity reuses one
  artifact and one destination transform digest, despite bcrypt's random salt;
- changing envelope bytes, source revision, destination identity, license
  incarnation, codec version, or policy version cannot overwrite the old
  artifact;
- concurrent import attempts resolve to one artifact binding, and an
  acknowledged-but-uncertain D1 batch is reconciled before retry;
- a destination hash/digest mismatch, missing target row, duplicate source
  binding, or stale generation fails closed; and
- the artifact and target rows contain no caller token, raw address, source
  input, or public response data.

The full migration remains gated on restricted source conversion rehearsal,
remote D1 schema/readback, Cloudflare CPU and concurrency measurements, writer
coverage, rollback evidence, and the separate Better Auth account/OAuth/MFA
migration. This contract does not claim any of those gates are complete.

## References

- [D1 import and reconciliation design](d1-import-design.md)
- [Local D1 importer](d1-import.md)
- [Schema conversion](schema-conversion.md)
- [Verified public access design](verified-access-design.md)
