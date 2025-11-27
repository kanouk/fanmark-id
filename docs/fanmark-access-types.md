# Fanmark Access Types

This document tracks how each fanmark access type behaves in the product and which UI surfaces configure them.

## Supported access types

| Value      | Behavior                                                                 | Primary UI                                      |
|------------|---------------------------------------------------------------------------|-------------------------------------------------|
| `redirect` | Redirect visitors to an external destination (website or phone dialer)   | `FanmarkSettings`, `FanmarkRegistrationForm`    |
| `profile`  | Show the hosted profile page                                             | `FanmarkSettings`, `FanmarkRegistrationForm`    |
| `text`     | Render the built-in message board                                        | `FanmarkSettings`, `FanmarkRegistrationForm`    |
| `inactive` | Take no action; the fanmark is effectively paused                        | `FanmarkSettings`, `FanmarkRegistrationForm`    |

## Redirect sub-types

The redirect access type now exposes an additional sub-selection in the UI so creators can choose between a website URL and a phone number. The form logic keeps the `access_type` value as `redirect`, while `fanmark_redirect_configs.target_url` stores the final URI.

### Website URL

- Only `http://` or `https://` URLs are allowed. Other schemes are rejected.
- Validation is handled in both `FanmarkSettings` and `FanmarkRegistrationForm` via `URL` parsing.
- The UI keeps using a standard URL input (type `url`). Helper text reminds creators about allowed schemes.

### Phone number (tel:)

- Creators enter raw digits (optionally with a leading `+`). Hyphens or spaces are ignored.
- The UI automatically converts the sanitized number into a `tel:+<digits>` URI and stores it as `target_url`.
- Validation ensures that a phone number is present and that the derived `tel:` URI matches the stored value.
- The redirect configuration ultimately saves `tel:<number>` so downstream access components can continue to use a single `window.location.href` assignment.

### Shared UI notes

- Both `FanmarkSettings` and `FanmarkRegistrationForm` render a segmented control (`URL` / `Phone`) inside the redirect card.
- When switching from phone back to URL, the stored `target_url` is cleared to avoid sending `tel:` URIs with the wrong subtype.
- Draft persistence (settings) and default form values (registration) now include `redirectLinkType` and `redirectPhoneNumber`.

## Impacted components

- `src/components/FanmarkSettings.tsx`
- `src/components/FanmarkRegistrationForm.tsx`
- Translation bundles in `src/translations/*.json`

## Testing checklist

1. Set an existing fanmark to `redirect → Website` with a valid HTTPS URL and confirm navigation works.
2. Switch the same fanmark to `redirect → Phone` and verify:
   - The UI auto-populates the tel link preview.
   - The settings form saves successfully.
   - Visiting the fanmark opens the system dialer (desktop browsers typically show a confirmation prompt).
3. Register a new fanmark using both sub-types to ensure registration payloads persist the expected `target_url`.


