# Storage content baseline (2026-09-21)

Status: a read-only source baseline, not a cutover snapshot, R2 import, or
restore-tested backup. No remote objects or bucket settings were changed.

The coordinator enumerated the existing `avatars` and `cover-images` buckets
through the authenticated Supabase Storage API. The database CLI role could
not read the storage schema; the existing project API credential was used in
process memory instead. No credential was persisted or logged.

For each listed object, the collection downloaded the original bytes through
the authenticated Storage download API, compared their length with the listed
metadata size, calculated SHA-256, and wrote a local private copy. Object
identities, source timestamps/metadata, byte counts, hashes, and local file
references are retained in a private manifest. Object names, user identifiers,
individual counts, and image contents are excluded from this repository.

The bucket listing was repeated after the downloads. Both listings were equal
for the observed names, IDs, timestamps, and metadata. A separate verification
reread every local file, checked its length and SHA-256 against the manifest,
checked unique bucket/path identities, and confirmed private permissions:
0700 for the containing directory and 0600 for files and the manifest.

This establishes that the collected bytes agree with the saved local
manifest and source metadata sizes. It does not establish a database/Storage
transactional snapshot, a server-side content checksum match, completeness of
external avatar URLs, or absence of writes outside the observation window.
The files are temporary local evidence and are not a durable backup policy.

## Required next steps

- Turn collection and verification into a reviewed, reusable command with
  bounded downloads, failure reporting, restart behavior, and tests.
- Define the public R2 URL mapping and rewrite only URLs owned by these source
  buckets. Preserve external provider URLs unless separately migrated.
- Copy into the target R2 environment and compare bytes/hashes by object key.
- At cutover, freeze all source writers, repeat the final listing and changed
  downloads, then reconcile against the database snapshot before reopening
  writes. The current baseline does not replace that final operation.
- Retain a verified, access-controlled recovery copy before retiring Supabase.
