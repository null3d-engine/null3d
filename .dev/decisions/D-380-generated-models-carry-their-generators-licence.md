# D-380: A generated model may carry its generator's non-commercial licence

Status: decided by the owner, in their words "Cc by-nc works". Task: the sample check in
`bun run test` holds it.

Summary: The sample content accepts CC0 and CC BY. A model that a generator made may also carry
CC BY-NC 4.0, and only when its manifest entry names the generator. The sample-assets README
prints that name beside the model, so a visitor reads why the licence is non-commercial before
they use it. No other non-commercial licence is accepted, and a non-commercial licence on an entry
that names no generator stays a failure.

## Question

The island showcase's people and vehicles were made by Tripo3D from reference pictures, and the
generator's terms put its outputs under CC BY-NC 4.0. The sample check accepted only CC0 and CC BY,
so it refused the two new entries, and CI could not pass with them in the sample repository. Do the
samples carry generated models at all, and under what licence?

## Rule

- An asset may use CC0 or CC BY, as before.
- An asset that names its `generator`, such as `Tripo3D`, may also use `CC-BY-NC-4.0`.
- An asset under any other non-commercial licence fails the check, and so does `CC-BY-NC-4.0` on an
  asset that names no generator.
- The manifest lists the licence's text in `LICENSES/`, and the sample-assets README prints the
  generator and the licence beside the model.
- A demo that loads such a model carries the same limit: the model cannot be used commercially,
  and the showcase that draws it says so where the model is published.

The island's `showcase/island-life` and `showcase/island-life-raw` entries are the first under the
rule. Their raw files are the generator's own outputs, and the finished file is made from them, so
both carry the licence.

## Consequences

- `tools/lib/samples.ts` gains `GENERATED_LICENCE` and a `generator` field on a sample asset, and a
  test holds both directions: accepted with a name, refused without one.
- `bun run test` is the check, so a pull request that adds a generated model shows the rule.
- The engine's own assets stay CC0 and CC BY; nothing in the engine's code or its other samples
  takes the licence.
