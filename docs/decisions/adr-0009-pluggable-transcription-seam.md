# ADR-0009: Pluggable transcription behind a Transcriber seam (deterministic stub now)

Status: accepted (2026-07)

## Context

Phase 8 adds voice notes: a user uploads audio and expects a searchable, convertible
**transcript** back. Real speech-to-text means a paid provider (Whisper, Deepgram, Google STT,
…) — an external dependency with per-minute cost, API keys, rate limits and network latency.
Committing to one now would be premature: the product first needs the *shape* of the feature
(upload → transcript → segments → recording → task/invoice) working end to end, not a specific
vendor. Three constraints shaped the decision. **Cost** — every test run and local demo would
otherwise bill a provider. **Offline/reproducible development** — the pipeline must be runnable
with no internet and no secret, and tests must be deterministic (an assertion on transcript
text cannot depend on a provider's non-deterministic output). **Correctness of the async
lifecycle** — transcription is slow, so it runs off the request thread through the outbox, which
raises the usual at-least-once questions (idempotent redelivery, re-transcription, and how the
recording's state reflects progress and failure) that must be settled *independently* of which
STT engine runs.

## Decision

**Transcription runs behind a small `Transcriber` interface, with a deterministic
`StubTranscriber` as the only implementation in Phase 8; a real provider drops in at Phase 9
behind the same seam.** The interface
(`apps/worker/src/transcription/transcriber.ts`) takes the audio bytes, content type, an
optional language and a human hint, and returns full text, a language and time-coded segments.
The rules:

- **Deterministic stub, not a mock.** `StubTranscriber` derives a stable pseudo-transcript from
  a **hash of the audio bytes** (seeded PRNG, no `Math.random`): identical audio always yields
  identical text and segments, so the full pipeline is exercisable offline and every test is
  reproducible. It folds the recording title (the `hint`) into the first segment for readable
  demos. It does **not** decode speech — it is an honest stand-in, not a fake that pretends to.
- **Two-field lifecycle.** A recording carries `status`
  (`UPLOADED` → `TRANSCRIBING` → `TRANSCRIBED`/`FAILED`) and, separately, `transcriptStatus`
  (`NONE` for a call log, else `PENDING` → `COMPLETED`/`FAILED`). Separating them keeps "the
  recording exists / is being processed" distinct from "the transcript is ready / failed", and
  leaves a call log (no audio, `NONE`) unambiguous.
- **Idempotent async processing.** Upload enqueues `recording.uploaded` on the transactional
  outbox; the worker consumer moves the row to `TRANSCRIBING`, calls the `Transcriber`, then in
  **one transaction deletes and rewrites all segments** and sets `TRANSCRIBED`/`COMPLETED`. A
  `processed_messages` ledger suppresses redelivery; a storage/STT failure flips the row to
  `FAILED` and **acks** the message (no infinite retry loop).
- **Re-transcription via a fresh message.** `POST /v1/recordings/:id/retranscribe` resets the
  row to `UPLOADED`/`PENDING` and enqueues a **new** `recording.uploaded` envelope. A fresh
  envelope id is deliberately *not* suppressed by the idempotency ledger, and the segment
  rewrite replaces the previous transcript wholesale — so re-running is safe and repeatable.

## Consequences

- **Swapping in a real provider is a one-file change**: implement `Transcriber` against the
  vendor SDK and construct it in `apps/worker/src/main.ts` in place of `StubTranscriber`. The
  audio object-storage path, the outbox wiring, tenancy, idempotency, the segment model and the
  recording → task/invoice flows are all already settled behind the seam — the provider choice
  touches none of them.
- **CI and local dev cost nothing and need no secret or network**: the stub runs the whole
  pipeline, and its determinism means the integration tests assert real transcript state, not a
  hand-mocked value.
- **The stub's text is not a real transcription** — it is deterministic filler seeded by the
  audio bytes. It must never be presented to a user as an accurate transcript of their speech;
  it exists for the demo and the tests. Real accuracy, language detection and diarization
  arrive only with the Phase 9 provider.
- **At-least-once delivery is safe end to end**: redelivery is suppressed by the ledger and
  otherwise idempotent (segments are rewritten, not appended), and a poison/hard failure lands
  in `failed_jobs` rather than looping.
- Choosing a provider later still carries its own review: audio is **personal data** and an STT
  vendor is a **subprocessor** needing a DPA, and nothing here makes any bookkeeping/tax claim
  about invoices drafted from a recording (see
  [legal-review-required.md](../legal-review-required.md)).
