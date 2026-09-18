# Roadmap

## Restore (current)
- [x] Restored uploaded N Connect code; build green; app renders in preview.
- [x] Backend reconnected: fresh Cloud project provisioned, tables + storage policies applied, media buckets (status/chat/appearance) created. Data starts empty.
- [x] Contact Requests: store wired to server helpers (migration 0011); `contact-wire.ts` removed.
- [x] Connect screen wired to the real server matching system (migration 0013): eligibility, waiting/heartbeat, realtime, votes, cancel/end.
- [ ] Connect temporary chat messages are still local to the device (no session-message table exists).

## Signature Pill real-backend audit
- [x] Messages + notifications backend (migration 0006).
- [x] Notification creation on the server (likes, requests, accepted, calls, missed calls, message requests, security) honouring saved settings.
- [x] Signature Pill + Notifications screen fed from the server list with realtime (insert + read-state updates).
- [ ] Apply migration 0016_profile_likes when a live database is connected.
- [ ] Device push notifications (deferred by request).
- [ ] Keep pill hidden in P2P chat; clear state after handled; no duplicates.

## Chat images + calling cleanup (done)
- [x] Chat screen sends photos through the real chat media helper (private storage, signed links, server-side Trust/Block/Request/daily-limit).
- [x] Removed local/mock chat-image persistence; preview, compression, caption, expiry preserved.
- [x] Removed the simulated call service; all call paths use the real WebRTC + backend signaling flow.
- [x] TypeScript check and production build green.

## Earlier phases (from backup)
- [x] Phase 2 — Trust and block/unblock are read and written server-side (`src/lib/social/social-graph.ts`), loaded at start-up, kept live by realtime, and enforced on calls.
- [x] Contact requests are server rows; not verified end to end (no Cloud credentials here).

- [ ] Phase 3 — Subscriptions, entitlement consistency.
- [ ] Phase 4 — Chat, call and status action correctness.
- [ ] Phase 6 — Move remaining critical state from local storage to the backend.
- [ ] Phase 7 — Final QA across user states.
## Appearance settings (current)
- [x] Apply built-in and custom backgrounds to P2P Chat.
- [x] Persist message size, bubble shape, and reduced motion server-side.
- [x] Store custom background images privately with preview, replace, and remove flows.
- [x] Run TypeScript check and production build.


## Settings audit + chat font (current)
- [x] Chat font: SF Pro, OnePlus One Sans, Inter, Plus Jakarta Sans, Satoshi — previews in their own font, Premium ones locked through the existing entitlement (`chatCustomization`), saved in account settings.
- [x] Bubble colour (Classic / Sky / Peach / Violet) now applies to P2P chat and is gated by the same entitlement.
- [x] Appearance preview reflects background, text size, bubble shape, bubble colour and chat font live.
- [x] Account settings changed on another device arrive live (`subscribeSettings` on `user_settings`).
- [x] TypeScript check and production build green.
- [ ] Realtime on `user_settings` needs the table in the Supabase realtime publication when a live database is connected (no migration applied here).
