# D-189: Safari samples the first-use shader builds too

Status: decided and built. Task: M2-EX36.

Summary: On Safari, the shaders page compiles the base builds and samples of the coat and first-use builds, all in the base set's parts. Every other browser compiles every build, and the manifest keeps every combination it designs. The busiest Safari shard's modelled time is 9.49 minutes against 11.4 for every build, under the 10-minute limit.

## Question

The translucency bit joins the lit templates, so it doubles the builds of those templates, and the skin blur adds two templates. That gives the shaders page's base set 55 parts, against about 24 without them. The busiest Safari shard's modelled time is then 11.4 minutes, over the limit. How does CI check Safari's shader compiles without shaping the engine's features around its machines?

## Rule

- No feature loses a combination that its design keeps; the manifest is not trimmed to fit CI.
- The Safari limit of 10 minutes per shard stays, and so do the seven shards.
- Every build is compiled in a browser that has the time: `all` names every build.
- The sample keeps the bits that most materials draw with, alone and together.

## Data

| Measure | Every build | Sampled |
| --- | --- | --- |
| GLSL programs, base set | 21,907 | 9,434 |
| GLSL programs, first-use set | (in base) | 6,920 |
| GLSL programs, coat set | 6,144 | 6,144 |
| Parts of the sampled Safari plan | 55 base + 1 coat sample | 24 base + 1 first-use sample + 1 coat sample |
| Busiest Safari shard, modelled | 11.4 min | 9.49 min |
| Shards in CI's Safari job | 7 | 7 |

Measured with the plan's own model: `bun test tests/lib/runs.test.ts`, whose figures come from `expectedSeconds` over the shard's items. The 11.4-minute figure is that test's failing assertion with every build on Safari. The sampled figures are the seven shards' modelled times, 9.44 to 9.49 minutes. They model each sample in a part of its own. The plan puts the samples in the base set's parts instead ([below](#the-samples-share-the-base-sets-parts)), so each part compiles a few more programs.

## Decision

Sample the first-use builds on Safari, as D-147 samples the coat builds. The shaders page's sets include `base`, `first-use`, `coat`, `coat-sample`, `first-use-sample` and `sampled`. Safari's plan compiles `sampled`: the base builds and both samples. Every other plan compiles `base`, `first-use` and `coat`, which together hold every build.

The first-use set holds the builds of the features that load in a file of their own: the translucency bit on the lit and standard-material templates and the skin blur's four shaders. A build belongs to it by its shader's name or by a bit in its variant. The list is data beside the sets, so a new first-use feature extends the sample with a word.

The sample allows the device's bits with shadows, row values, tone mapping, the draw index and half precision, alone and together. That fits one part of 168 programs. A wider list gave 488 programs, two parts, and the sample is meant to cost one part.

## Consequences

- `tests/pages/lib/shader-list.ts` holds the sets and their membership; `tests/lib/plans.ts` names each plan's sets and counts each sample at 15 seconds a part.
- `tests/lib/shader-programs.ts` counts programs by `shader.variant`, since a set that leaves out a feature needs the shader's name, which the variant alone does not give. A variant-only map serves the checks that read variants.
- The shaders page takes `?set=first-use` and `?set=first-use-sample` like the other sets.
- In CI, Safari compiles a sample of the first-use builds, not every one. The other browsers, and the local `bun run test:browser` runs that do not sample, compile every build.

## The samples share the base set's parts

A part downloads its share of every shader module, so a set in a part of its own downloads all of them. In CI runs 39291513923, 39306888159 and 39325388478, the shader build wrote 5,566 modules, about 2.5 GB. In those runs, Safari's sample page in a part of its own noted no step within its 205 seconds. On the Mac, Safari compiles one of the largest programs in about 0.3 s, so the download takes the time, not the compiler.

So Safari's plan compiles one set, `sampled`: the base builds and both samples, in one set of parts. Each part compiles a few more programs and downloads nothing more. A unit test fails when one part of a plan would download more than 200 MB of shader modules.
