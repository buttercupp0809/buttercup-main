# Phase 08 - Voice (TTS) job handler + player

## Goal
Plug a **voice job handler** into the Phase-07 media pipeline. Deliver per-character text-to-speech using **ElevenLabs Flash v2.5 over WebSocket streaming** with a **connection pre-warm** to cut time-to-first-audio (TTFA), a **provider-chain fallback** (ElevenLabs -> Cartesia -> Google) mirroring Pellow `voice.ts`, per-character `VoiceProfile` mapping, **voice-decision** logic (when a reply is delivered as voice) mirroring Pellow `voice-decision.ts`, a frontend audio player with waveform + playback, and a token debit per clip (via the Phase-07 ledger).

Target: TTFA < 1.5s p50 locally with pre-warm (PRD §6).

Reference: PRD §5.5 (voice TTS), §11 (media pipeline), §6 (latency targets).

## Prerequisites
- Phase 07 green: media queue, worker, `handlers/index.ts` registry, `MediaAsset` lifecycle, S3 upload + signed URL, `media.ready` WS push, atomic `TokenLedger` debit/refund.
- Phase 02 green: `VoiceProfile` table (provider, voiceId, params, previewKey) and `CharacterVersion.voiceProfileId`.
- Phase 04 green: chat streaming so a reply's text exists to voice, and the WS gateway to deliver `media.ready`.
- Env: `ELEVENLABS_API_KEY` (primary). Optional fallbacks: `CARTESIA_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS` / `GOOGLE_TTS_API_KEY`.

## Context to paste into Cursor
```
You are implementing Phase 08 of ButterCupp (see prds/master-prd.md §5.5, §11, §6).

Register a "voice" handler into the Phase-07 pipeline (backend/src/media/handlers/index.ts). Do NOT re-implement the queue, worker, S3, or token ledger, reuse Phase 07.

Mirror Pellow ../Pellow/backend/src/media/voice.ts EXACTLY in shape:
- Provider chain with per-provider try/catch and session-level disable flags (elevenLabsDisabled, cartesiaDisabled, googleTtsDisabled).
- 401/403 -> disable that provider for the session, do not retry it.
- Voice IDs / params come from a per-character VoiceProfile (ButterCupp is multi-character; Pellow keyed by archetype). Keep the VOICES-map shape from ../Pellow/backend/src/media/constants.ts but source the id from VoiceProfile.
- ffmpeg -> ogg/opus conversion helper (Docker already has ffmpeg per PRD §14).
- Truncate to MAX_VOICE_WORDS.

Mirror ../Pellow/backend/src/media/voice-decision.ts for shouldSendAsVoice + isVoiceRequest.

NEW vs Pellow: ElevenLabs over WEBSOCKET STREAMING (not the batch convert() call) with a pre-warmed connection to cut TTFA. Batch convert() is the fallback path if the WS stream errors.

Token debit happens in the Phase-07 worker (reason: "voice_gen"). No new debit code here.
No em dashes. TypeScript strict. Zod on any new route/DTO.
```

## Build steps

1. **Voice constants**: `backend/src/media/voice/constants.ts`
   - `MAX_VOICE_WORDS = 250` (mirror Pellow).
   - `ELEVENLABS_MODEL = "eleven_flash_v2_5"`, `ELEVENLABS_OUTPUT = "opus_48000_64"`.
   - `VOICE_TOKEN_COST` (add to the Phase-07 `MEDIA_TOKEN_COSTS` map in `packages/shared`).
   - Default fallback voice ids for Cartesia / Google when a `VoiceProfile` is missing (mirror the maps in `../Pellow/backend/src/media/constants.ts`).

2. **VoiceProfile resolver**: `backend/src/media/voice/profile.ts`
   - `resolveVoiceProfile(characterVersionId)`: load `VoiceProfile` via `CharacterVersion.voiceProfileId`; return `{ provider, voiceId, params }`. Fall back to a system default profile when null (e.g. a system character with no custom voice).

3. **Provider: ElevenLabs WS streaming + pre-warm**: `backend/src/media/voice/elevenlabs-stream.ts`
   - `prewarmElevenLabs(voiceId)`: open the ElevenLabs streaming WS (`/v1/text-to-speech/{voiceId}/stream-input?model_id=eleven_flash_v2_5`) and hold it briefly so the first real request skips TLS + handshake. Cache warm sockets per voiceId in an LRU with a short idle TTL; close idle ones.
   - `streamElevenLabs(text, voiceId, params)`: send text over the warm WS, collect audio chunks, resolve to a Buffer. Measure and log TTFA (time to first audio chunk). On WS error/close mid-stream, throw so the caller falls back to batch.
   - `convertElevenLabsBatch(text, voiceId)`: the non-streaming `client.textToSpeech.convert(...)` path from Pellow `voice.ts` as the fallback within the ElevenLabs step.

4. **Providers: Cartesia + Google**: `backend/src/media/voice/providers.ts`
   - Port `generateWithCartesia` and `generateWithGoogleTTS` verbatim from Pellow `voice.ts` (adjust imports to `@buttercupp/*`). Keep the wav -> ogg/opus conversion via `convertToOggOpus` (ffmpeg).

5. **Audio conversion**: `backend/src/media/voice/audio.ts`
   - `convertToOggOpus(input, "mp3" | "wav")` ported from Pellow `voice.ts` (write to `/tmp`, `ffmpeg -c:a libopus -b:a 48k -ar 48000 -ac 1`, cleanup in `finally`).
   - `truncateForVoice(text)` (MAX_VOICE_WORDS).

6. **Main chain**: `backend/src/media/voice/generate.ts`
   - `generateVoiceNote(text, voiceProfile)`: order = ElevenLabs streaming -> ElevenLabs batch -> Cartesia -> Google. Per-provider try/catch with session disable flags; 401/403 disables the provider (Pellow pattern). Return `{ audio: Buffer, provider, contentType: "audio/ogg" }`.
   - Throw when all providers are exhausted (worker will mark `failed` + refund).

7. **Register the handler**: `backend/src/media/handlers/voice.ts` + wire into `handlers/index.ts`
   - `voiceHandler(job)`: read `job.payload.text` + `job.payload.characterVersionId`; `resolveVoiceProfile`; `generateVoiceNote`; return `{ buffer, contentType: "audio/ogg", meta: { provider, durationMs } }`. Phase-07 worker then uploads to S3 + emits `media.ready`.
   - Replace the Phase-07 `mockHandler` for `kind: "voice"` with `voiceHandler`.

8. **Voice-decision**: `backend/src/media/voice/decision.ts`
   - Port `isVoiceRequest(text)` (the regex set) and `shouldSendAsVoice(...)` from Pellow `voice-decision.ts`. Adapt gating to ButterCupp: check the user's tier/token balance (voice is a paid consumable per PRD §13) and per-(user,character) recent-voice count instead of Pellow's `Boundary.voiceNotesEnabled`. Keep the `userRequested` fast path.

9. **Chat integration**: extend the Phase-04 chat turn
   - After the assistant text is produced, call `shouldSendAsVoice`. If true (or `isVoiceRequest` on the user's message), enqueue a `voice` media job (Phase-07 `enqueueMediaJob`) with `payload.text` = the reply and `tokenCost = VOICE_TOKEN_COST`. The text reply still streams immediately; the voice clip arrives later via `media.ready`. Chat is never blocked.
   - Also expose the explicit `POST /api/media/voice` route (already added in Phase 07) for a manual "voice note" button.

10. **Frontend audio player**: `frontend/components/chat/VoiceMessage.tsx`
    - On a `media.ready` event with `kind: "voice"`, render an audio bubble: play/pause, a **waveform** (Web Audio `AnalyserNode` or a precomputed peaks array from `meta`), scrubber, duration. Lazy-load the signed URL.
    - Loading state while the job is `queued`/`processing` (spinner in the bubble); swap to the player on ready. Error state on `error` event.
    - Reuse design tokens + component library (Pellow pattern); no em dashes in copy.

11. **Metrics**: increment voice-provider outcome counters (which provider served, TTFA) mirroring Pellow `metrics.ts`.

## Test instructions
```
# Vitest (backend)
npm run test -w backend -- voice

# With a real ElevenLabs key for a live TTFA check (optional):
ELEVENLABS_API_KEY=sk-... npm run test -w backend -- voice.live

# Frontend player (Playwright / manual)
npm run dev            # start web + backend + worker
# In chat, type: "send me a voice note" -> audio bubble appears and plays
```
Vitest cases (`backend/src/media/voice/__tests__/`):
- **provider fallback chain**: with ElevenLabs key absent/erroring, chain falls to Cartesia then Google; 401 disables a provider for the session (assert it is not retried).
- **voice-decision heuristics**: `isVoiceRequest` matches the request patterns; `shouldSendAsVoice` respects the `userRequested` fast path, tier/token gating, and recent-voice limit.
- **token debit**: a voice job debits `VOICE_TOKEN_COST` via the Phase-07 ledger; failure refunds.
- **profile mapping**: `resolveVoiceProfile` returns the character's `VoiceProfile`, default when null.
- (live, optional) **TTFA**: first audio chunk arrives < 1.5s p50 with pre-warm.

Playwright/manual: request a voice note in chat; the audio bubble renders, plays, and shows a waveform; text reply was not delayed by the voice job.

## Sanity checklist
- [ ] TTFA < 1.5s p50 locally with pre-warm (measured + logged); pre-warm socket reused across requests.
- [ ] Fallback works when the primary (ElevenLabs) key is missing or the WS stream errors -> Cartesia -> Google.
- [ ] Correct character voice used (`VoiceProfile.voiceId`), not a global default, when the character has one.
- [ ] Voice job runs async on the Phase-07 queue; the text reply streams without waiting for audio.
- [ ] Token debited once per clip (`reason: "voice_gen"`); failed clip refunds.
- [ ] Player plays ogg/opus in-browser with a working waveform + scrubber.

## Done criteria
- `voiceHandler` registered in the Phase-07 registry; mock handler for voice removed.
- Provider chain + pre-warm + fallback proven by tests; TTFA target met locally.
- Chat can deliver a reply as voice without blocking the text stream.
- Frontend renders and plays voice bubbles from `media.ready`.

## Guardrail note
STOP before any commit, push, non-local DB migration, secret writes (ElevenLabs/Cartesia/Google keys into SSM/Secrets Manager), or ECS deploy. Each requires an explicit, fresh, per-action human approval. Local-only work (edits, local tests, local dev server, local worker) proceeds without it. Prior approval never carries to the next action.
