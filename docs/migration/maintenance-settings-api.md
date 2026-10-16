# Maintenance settings API

This slice moves only the three public maintenance settings onto the Cloudflare
staging app. It does not copy `system_settings` wholesale or migrate other
configuration. Production builds continue to use Supabase until an explicit
cutover.

## Contract

`GET /api/system/maintenance` reads only `maintenance_mode`,
`maintenance_message`, and `maintenance_end_time` where `is_public = 1`. It
returns `schemaVersion: 1`, those three typed values, and `Cache-Control:
no-store`. Missing public rows mean maintenance is off, with an empty message
and no scheduled end time. Private rows never appear in the response.

`PATCH /api/admin/system-settings/maintenance` accepts a non-empty subset of
those keys. The request is authorized by the shared Better Auth administrator
check, including session-bound MFA assurance. The message is limited to 2,000
characters; end time must be null or a parseable date string. Writes use a
single D1 batch, refuse a pre-existing private-key collision, and verify the
public readback before returning success.

## Frontend selection

The Cloudflare staging build sets
`VITE_MAINTENANCE_SETTINGS_BACKEND=worker`; the app Worker requires
`MAINTENANCE_SETTINGS_BACKEND=d1` and split D1 topology. The client checks that
the API and auth origins match, sends same-origin credentials, validates a
small versioned response, and does not fall back to Supabase after a Worker
failure. The generic `useSystemSettings` query excludes the three maintenance
keys so maintenance consumers go through `useMaintenanceSettings` only.

If settings cannot be loaded, the public gate keeps regular app routes behind
the maintenance page. The admin route remains available for recovery, and its
staging bypass calls `GET /api/admin/session` to verify admin and MFA state;
production keeps
the existing Supabase `is_admin` check. The admin UI submits maintenance mode,
message, and scheduled end as one PATCH when enabling the mode. Grace-period
settings remain on their existing Supabase path.

## Evidence and limits

The client suite covers backend selection, response validation, bounded
responses, same-origin requests, error handling, and Worker routes. The D1
suite covers the public allowlist, private setting exclusion, defaults, MFA
authorization seam, atomic write/readback, malformed requests, and disabled or
misconfigured backends. The 2026-09-25 workers.dev smoke returned the three
defaults with `no-store`, denied anonymous PATCH with 401, and returned the same
settings on the following GET. No authorized live PATCH or maintenance-mode
activation was performed. This does not prove an authenticated admin browser
session or production behavior.
