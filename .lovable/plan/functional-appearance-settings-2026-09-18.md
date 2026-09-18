# Functional Appearance settings

## What will change
- Keep Petals, Plain, Peach, and Sky, and apply the selected background to every P2P conversation.
- Add Custom Image with device selection, an undistorted preview, save/replace controls, and removal back to a built-in choice.
- Apply Small, Default, and Large to message body text in P2P conversations.
- Apply Rounded, Soft, and Square to sent and received message bubbles.
- Make Reduce Motion suppress non-essential chat animations and transitions.
- Continue using the existing account settings record so all Appearance choices load after sign-in on another device.

## Custom image storage
- Follow N Connect's existing private media pattern: compress the image in the browser, obtain a signed upload target from an authenticated server function, and store only its private path in account settings.
- Use a dedicated private appearance-media bucket and authenticated access rules, rather than storing image bytes or base64 in the database.
- Resolve the stored path to a short-lived viewing URL when Appearance or P2P Chat loads.
- When replacing or removing an image, delete the previous owned file after the new choice is safely saved.

## Interface behavior
- The Appearance preview will reflect the chosen background, message size, bubble shape, and reduced-motion state.
- Choosing Custom Image opens the device picker and shows a preview before Save; cancel leaves the saved background unchanged.
- The conversation background uses cover sizing with centered positioning, preserving aspect ratio without distortion.
- Loading or upload failures keep the previous saved choice and show a concise retryable message.

## Technical details
- Extend the typed appearance settings with an optional custom background storage path while preserving backward compatibility with existing settings JSON.
- Add focused media repository/server helpers for signed upload, signed viewing URL, and owned-file deletion.
- Add the private bucket access policy migration and create the bucket through managed storage tooling.
- Use chat-level classes/data attributes for size, shape, and motion so the setting is scoped to the applicable chat experience.
- Update the roadmap, then run the TypeScript check and production build and fix regressions caused by this work.
