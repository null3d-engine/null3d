# D-156: Permutation bits whose meaning depends on the template

Status: decided by the coordinator. Built: `AREA_LIGHTS` shares `FXAA`'s value, and the draw list's test and the shader build check every shared value. Task: M2-EX28.

Summary: A value of the permutation word names one feature in each shader template, so two features may share it when no template lists both. Area lights' `AREA_LIGHTS` shares `FXAA`'s value: only the lit templates list it, and only the final pass lists FXAA. The shader build refuses a template with two names of one value, and a first-use table's bit takes only builds of templates that name it.

## Question

Every value of the 32-bit permutation word has a name. Area lights need one more bit, so that scenes without them do not pay for their code ([D-145](D-145-area-lights.md)). Where does a new feature's bit come from?

## Rule

- A feature that a page does not use costs it nothing ([design principle 8](../../AGENTS.md#design-principles)).
- A build of one template never takes another template's feature by mistake: its file, its shader defs and its name stay its own.
- The change touches as little shared code as it can. Several branches change the draw list, the keys and the shader manifest at once.

## Data

The area lights' code in the shared light loop costs S4 5% more GPU time, though S4 has no area light. These are `bun run bench:gpu-check` figures on the Mac (Apple M5 Max, Chrome 155), against main at `3ed5e6c61`:

| GPU time per frame | Medium | High |
| --- | --- | --- |
| S4 with the area lights' code in every lit build | 3.95 to 4.17 ms (+5.3%) | 3.96 to 4.17 ms (+5.4%) |
| S4 with that code left out | 3.96 to 3.96 ms (+0.1%) | 3.95 to 3.96 ms (+0.2%) |
| S6 with the code | 4.76 to 4.63 ms (-2.5%) | 4.84 to 4.90 ms (-0.3%) |
| S6 without it | 4.71 to 4.74 ms (+0.8%) | 4.91 to 4.74 ms (-3.9%) |

The light loop never runs the area lights' code in S4. The code still makes every lit shader larger, and that costs GPU time without a single area light.

How the data was produced: two builds ran in one quiet window, each with `--measure` after `--prepare`. One was the branch. The other was a copy whose light loop had the area lights' branch inside `#ifdef`.

Seven values serve only templates that never draw a lit surface. They are `FXAA` and `BLOOM` (the final pass), `OUTLINE_VISIBLE` (the outline mask), `DEBUG_VIEW_LOW` and `DEBUG_VIEW_HIGH` (the debug view), `PREPASS` (the depth template) and `DEPTH_MULTISAMPLED` (custom effects).

## Options

| Option | Verdict |
| --- | --- |
| A: widen the word to 64 bits | Rejected. It changes the draw list's command, every key and every bit test, while other branches change them too |
| B: a value names one feature in each template | Chosen. It changes only the draw list's table of names and the shader build's checks |
| C: a uniform that turns the area lights' branch off | Rejected. The code stays in the shader, and the cost comes from the code, not from running it |
| D: keep the area lights' code in every lit build | Rejected. S4 pays 5% for a feature that it does not use |

## Decision

Option B, by the coordinator's ruling after the measurements above.

- `permutation::SHARED` in `crates/null3d-gpu/src/drawlist.rs` lists the pairs of names that share a value. The draw list's test refuses any other shared value.
- The shader build refuses a template whose variants list two names of one value.
- A first-use table's bit takes only the builds of the templates that list its name. The shader build's `FirstUseFeatures::listed`, and `FEATURE_MASKS` in the generated main module, hold each template's names for this.
- `AREA_LIGHTS` takes `FXAA`'s value, 256. No first-use table names FXAA, and no code makes a final pass key from a lit key. The debug view, the prepass and the outline mask make their keys from lit keys. `BLOOM` has a first-use table of its own.

## Consequences

- Before a feature takes a shared value, check every place that makes one template's key from another's. Such code must keep only the bits that it names, as `DrawKey::prepass` does.
- The image tests and the size report need no change: each build keeps its own name and its own file.
- Custom materials always build the area lights' code, and have no `AREA_LIGHTS` builds. A custom material compiles every build of its template in the page's own build, so the bit would double its builds and its compile time. A page that draws a custom material therefore pays the area lights' share of the lit shader in those draws, with or without area lights. The engine's own lit templates do not.
