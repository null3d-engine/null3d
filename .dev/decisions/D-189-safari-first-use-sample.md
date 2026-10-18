# D-189: Safari samples the first-use shader builds too

Status: decided. Date: 2026-10-18. Task: M2-EX36.

Summary: The shaders page's Safari plan compiles the base builds, a sample of the coat builds and a sample of the builds of features that load on first use. Every other browser still compiles every build. The busiest Safari shard's modelled time falls from 11.4 to 9.49 minutes, under the 10-minute limit, with every combination that the shader manifest designs kept.

## Question

The translucency bit joins the lit templates, so it doubles the builds of those templates, and the skin blur adds two templates. That took the shaders page's base set from about 24 parts to 55 and the busiest Safari shard's modelled time to 11.4 minutes, over the limit. How does CI check Safari's shader compiles without shaping the engine's features around its machines?

## Rule

- No feature loses a combination that its design keeps; the manifest is not trimmed to fit CI.
- The Safari limit of 10 minutes per shard stays, and the shard count stays as it is.
- Every build stays compiled in a browser that has the time: `all` still names every build.
- The sample keeps the bits that most materials draw with, alone and together.

## Data

| Measure | Before | After |
| --- | --- | --- |
| GLSL programs, base set | 21,907 | 9,434 |
| GLSL programs, first-use set | (in base) | 6,920 |
| GLSL programs, coat set | 6,144 | 6,144 |
| Parts of the sampled Safari plan | 55 base + 1 coat sample | 24 base + 1 first-use sample + 1 coat sample |
| Busiest Safari shard, modelled | 11.4 min | 9.49 min |
| Shards in CI's Safari job | 7 | 7 |

Measured on 18 October 2026 with the plan's own model: `bun test tests/lib/runs.test.ts`, whose figures come from `expectedSeconds` over the shard's items. The 11.4-minute figure is the failing assertion before the change; the after figures are the seven shards' modelled times, 9.44 to 9.49 minutes.

## Decision

Option A: sample the first-use builds on Safari, as D-147 already samples the coat builds. The shaders page's sets become `base`, `first-use`, `coat`, `coat-sample` and `first-use-sample`. Safari's plan compiles `base`, `first-use-sample` and `coat-sample`. Every other plan compiles `base`, `first-use` and `coat`, which together hold every build.

The first-use set holds the builds of the features that load in a file of their own: the translucency bit on the lit and standard-material templates and the skin blur's four shaders. A build belongs to it by its shader's name or by a bit in its variant. The list is data beside the sets, so a later first-use feature extends the sample with a word.

The sample allows the device's bits with shadows, row values, tone mapping, the draw index and half precision, alone and together. That fits one part of 168 programs. A wider list gave 488 programs, two parts, and the sample is meant to cost one part.

## Consequences

- `tests/pages/lib/shader-list.ts` holds the sets and their membership; `tests/lib/plans.ts` names each plan's sets and counts each sample at 15 seconds a part.
- `tests/lib/shader-programs.ts` counts programs by `shader.variant`, since a set that leaves out a feature needs the shader's name, which the variant alone does not give. The variant-only map remains for the checks that read variants.
- The shaders page takes `?set=first-use` and `?set=first-use-sample` like the other sets.
- Safari no longer compiles every first-use build in CI: it compiles one sample part of each kind. The other browsers, and the local `bun run test:browser` runs that do not sample, still compile every build.
