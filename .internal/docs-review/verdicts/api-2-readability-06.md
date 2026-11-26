# api-2-readability-06

## Finding as given

- page: api/impostors, api/input, api/lights, api/lines, api/materials, api/math, api/objects, api/page, api/particles, api/points, api/post, api/quality
- anchor: line 11, '> Roadmap step 0.x, first released in null3D 0.1.0...'
- category: scan-order
- severity: medium
- claim: The top callout mixes the release status with feature limits. Readers skip status boxes, so the limits go unread, and the materials limit about materials.shader shows before the reader knows what that call is. 'Roadmap step' is also a maintainer planning term.
- evidence: lights.md:11 'Surfaces show up to four directional lights...'; materials.md:11 '`materials.shader` takes no standard texture maps.'; lines.md:11, points.md:11 and particles.md:11 give shadow limits; quality.md:11 gives the live-settings rule.
- proposedEdit: Keep the callout to the status alone: 'First released in null3D 0.1.0. The API is experimental, so it can still change between versions.' Change shipsSentence in tools/lib/steps.ts and the check in tools/lib/docs.ts to match. Move each limit to the section it limits, or to a '## Limits' section.
- generatedSource: tools/lib/steps.ts

Verdict: partly

## Evidence

1. Six of the twelve pages have no limit in the callout. impostors.md:11, input.md:11, math.md:11, objects.md:11, page.md:11 and post.md:11 carry only the status sentences. For them only the "Roadmap step" part applies.

2. On four pages the limit in the callout already appears in the body, so "the limits go unread" does not hold. The callout repeats it:
   - lights.md:127 gives the four-directional-lights rule in full.
   - materials.md:713 says `materials.shader` takes every standard option but the texture maps. materials.md:749 gives the limit of 6 textures.
   - particles.md:181 and :183 give the no-shadows, no-lights and birth-order rules.
   - quality.md:50, :63 and :71 give the rule for settings that change during play and the fixed ones.
   On these pages the fix is to delete the sentence from the callout, not to move it.

3. On two pages the callout is the only place that states the limit. points.md and lines.md say "do not cast or receive shadows, and overlap queries do not find them" only at line 11. Here the limit must move into the body. If it is cut, it is lost.

4. The materials point holds. materials.md:11 names `materials.shader` about 700 lines before the page introduces it (materials.md:713).

5. "Roadmap step" is not an internal term that the docs hide. The docs explain it in public: index.md:34 ("The step column in All pages gives the roadmap step that adds the page's feature. The steps 0.1, 0.2 and 0.3 all ship in the first release") and pages.md:11. The style check does not block it. So the claim that it breaks the rule against internal plans is overstated. Even so, on an API page the step number tells a user nothing: every step ships in 0.1.0. Dropping it is a fair simplification, not a rule fix.

6. The code claim is partly wrong. The check in tools/lib/docs.ts:651-657 calls shipsSentence() and only tests that the note starts with that sentence. It needs no change of its own. Only the wording in tools/lib/steps.ts changes (shipsSentence/releaseOf). The tests that pin the old wording must change too: tools/lib/steps.test.ts:12 and tools/lib/docs.test.ts:90 and :135-142. The maintainer guide .dev/releases.md:45 quotes the old wording. tools/lib/shader-library.ts:263 also calls shipsSentence, so docs/shaders/library.md changes with it. releases.md:45 says this wording is meant to change in one place, so the edit fits the design.

7. Severity: the cost is small on the four pages where the body repeats the limit. Low fits better than medium, apart from points and lines, where the limit lives only in the callout.

## Corrected claim

The callout under the title (line 11) of lights, materials, particles and quality repeats a limit that the body already states. On lines and points, the callout is the only place that states the shadow and overlap-query limit. On materials it names `materials.shader` before the page explains it. On all twelve pages "Roadmap step 0.x" is a public, explained term, but it gives an API reader nothing, because every step ships in 0.1.0.

## Corrected edit

- In tools/lib/steps.ts, make shipsSentence give "First released in null3D 0.1.0." for the roadmap steps. Leave the docs.ts check as it is, because it follows shipsSentence. Update steps.test.ts:12, docs.test.ts:90 and :135-142, and the quoted wording in .dev/releases.md:45.
- lights.md, materials.md, particles.md, quality.md: delete the limit sentence from the callout. The body already states it (lights:127, materials:713/749, particles:181/183, quality:50/63/71).
- lines.md, points.md: move "do not cast or receive shadows, and overlap queries do not find them" from the callout into the body. Put it in the section about how the batch draws, or in a short limits list near the end. Do not delete it.
