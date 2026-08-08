# Perxona Connect Samples

Minimal sample apps for building with Perxona Connect.

> All samples and tools in this repository use a Perxona Connect account. Create one through the Connect Sign Up API:
> `POST /api/v1/connect/auth/signup` followed by `POST /api/v1/connect/auth/confirm-signup`. See
> [`samples/express/README.md`](samples/express/README.md) for the full steps.

## Samples

- [`samples/express/`](samples/express/) — an Express-based starter that shows the basic Connect flow. See
  [`samples/express/README.md`](samples/express/README.md) for setup and usage.

## Tools

- [`tools/motion-browser/`](tools/motion-browser/) — a web UI for previewing and controlling Perxona avatars. See
  [`tools/motion-browser/README.md`](tools/motion-browser/README.md) for setup and usage.

## Presenter SDK Integration FAQs

Common questions when integrating the `<sv-presenter>` Presenter SDK, across any sample or tool in this repo. For
setup/environment issues specific to one sample or tool, see its own README instead.

**Why doesn't the avatar speak after `present()`?** `present()` resolves with a `PresentationResult` whose `success`
is `false` — check the status message it surfaces (`code`/`message`) for why (e.g. no target resolved yet, or the
Connect API rejected the presentation request). Also confirm the presenter reached `Ready` first.

**Why doesn't a motion cued via `[MOTION ...]` markup in `present()` play?** Two common causes: the motion ID isn't
in the target avatar's motion catalog (check `GET /api/v1/connect/assets/avatars/:id/motions` for what it actually
supports); or the cue lands too close to the end of the speech — motion playback stops when its accompanying speech
finishes, so a motion cued near the end of a sentence, or in a very short utterance, may not have enough time to
play. To play a motion on its own, independent of the speech queue, call `presenter.playMotion(motionId)` instead.
