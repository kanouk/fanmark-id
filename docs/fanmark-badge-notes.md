# Fanmark badge (inactive view) layout notes

- Applies to `/a/:shortId` and emoji-path inactive screens only (not the `/f/:shortId` detail view).
- Badge sizing:
  - Uses `createFanmarkBadgeStyle` for height, fontSize, and base sizing.
  - Responsive width is computed per emoji count: `count * 2.1rem + (count - 1) * 0.4rem + 1.6rem`（左右0.8remずつ）で背景を絵文字より広めに確保。
  - width: `calc(...)` equivalent in JS, `minWidth: max-content`, borderRadius: `18px`.
- Emoji glyph layout:
  - Container gap is `0.375rem` (`gap-1.5`).
  - Each emoji span has `min-width: 1.15rem` to balance compactness and legibility.
- If further tuning is required, adjust only the local overrides in:
  - `src/components/FanmarkAccess.tsx` (emoji-path inactive)
  - `src/components/FanmarkAccessByShortId.tsx` (`/a/:shortId` inactive)
