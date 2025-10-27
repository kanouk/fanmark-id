# Language Preference Persistence Plan

This note captures the required behavior for persisting user language preferences across the application, plus the validation checklist for each implementation phase. The goal is to ensure the UI language toggle, user settings, and server-side notifications all share a single source of truth.

## Target Behavior

1. Every authenticated user has a `preferred_language` stored in `public.user_settings`.
2. The TranslationProvider initializes to that value (falling back to `ja` when absent).
3. Changing the language via the navigation LanguageToggle or the settings screen updates `preferred_language` and the in-memory translation state.
4. Server-side processes (e.g., `process-notification-events`) render notifications using the stored `preferred_language` when the payload does not specify a language.
5. Documentation clearly states how language preferences are stored, read, and propagated.

Supported languages today: `ja`, `en`. Upcoming languages: `ko`, `id`.

## Phase A – Data & Server Foundations

**Tasks**
- Expose a dedicated hook/client helper to read & update `preferred_language`.
- Ensure TranslationProvider can accept an externally-provided initial language value before falling back to `localStorage`.
- Update notification rendering logic to look up `preferred_language` when `event.payload.language` is missing.

**Checklist (must be green before proceeding)**
1. ✅ `preferred_language` is fetched for authenticated users when the app loads.
2. ✅ Updating the setting via an API helper persists to Supabase and updates any caches.
3. ✅ TranslationProvider initializes from the persisted value (verified by logging in on a fresh browser profile).
4. ✅ Notifications fall back to the stored preference when payload lacks `language`.

## Phase B – UI Integration

**Tasks**
- Add a language dropdown block to the user settings screen that edits `preferred_language`.
- Wire the LanguageToggle to call the same update helper so it remains the single control everywhere.
- Add translation strings for the new settings block.

**Checklist**
1. ✅ Settings screen shows the current language and persists changes.
2. ✅ Navigation LanguageToggle immediately reflects the stored preference and keeps TranslationProvider & DB in sync.
3. ✅ Upcoming languages appear disabled with “coming soon” styling.
4. ✅ Accessibility: dropdown and toggle have localized labels/aria attributes.

## Phase C – Documentation & QA

**Tasks**
- Update service/system documentation describing how language preferences are stored and consumed (front + server).
- Smoke-test: change language → reload (should persist), trigger a notification (should use same language), log in from another browser (should inherit).

**Checklist**
1. ✅ Relevant docs exist (this file + main spec).
2. ✅ Manual test evidence recorded (e.g., QA notes in PR).
3. ✅ Regression risk (loading spinners, fallback) evaluated and addressed.

Only proceed to the next phase once every checklist item in the current phase is satisfied. If any verification fails, fix immediately and re-run the checklist.

## Implementation Notes – 2025-02-07

- `LanguagePreferenceSync` keeps the TranslationProvider aligned with `user_settings.preferred_language` after authentication and updates `localStorage` for guests.
- `usePreferredLanguage` exposes a single mutation path that updates the Supabase row (when logged in) and immediately reflects the change in the TranslationProvider.
- The navigation LanguageToggle and the new settings dropdown both call `usePreferredLanguage`, so the same logic covers instant UI feedback and persistence.
- `process-notification-events` now resolves the language by checking `event.payload.language` first, then falling back to `user_settings.preferred_language`, and finally Japanese.
- Documentation and translations now describe the behavior for current (JA/EN) and upcoming (KO/ID) languages.

### Update (Navigation behavior)
- The Navigation LanguageToggle now **only** changes the in-session language (and browser cache) so users can preview other languages freely. It no longer updates `preferred_language`; that persists only through the settings screen.
