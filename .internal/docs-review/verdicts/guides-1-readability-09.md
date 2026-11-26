# guides-1-readability-09

## Finding as given

- Page: guides/assets-pipeline
- Anchor: ## Encode time (line 461), line 463
- Category: unclear. Severity: medium.
- Claim: The one-paragraph H2 says "those 40 sets, 144 textures in all". The 40 sets are defined at line 147, about 300 lines earlier. A reader who jumps here cannot tell what they are, and the H2 is too small to stand alone.
- Evidence: line 463 "On a MacBook Pro with 18 cores, those 40 sets, 144 textures in all, took 18 to 26 seconds."; line 147 "In 40 sets of photographed materials at 1024 x 1024".
- Proposed edit: Move the paragraph under "## Textures" after line 147 as "### Encode time", and write "The same 40 sets, 144 textures in all, took 18 to 26 seconds on a MacBook Pro with 18 cores."

Verdict: survives

## Evidence

- docs/guides/assets-pipeline.md:461-463 is a one-paragraph H2. It sits between "## Environment maps" (line 408) and "## Build only the shader permutations you draw with" (line 465). Neither neighbor is about texture encoding.
- Line 463 says "those 40 sets". The only other mention is line 147, in "## Textures" (line 132). No other page uses the phrase, and no page links to `#encode-time`, so moving the section breaks no link.
- The paragraph is about texture encoding only. The source confirms its first sentence: packages/cli/src/assets/encoder-pool.js:10 sizes the pool to `availableParallelism()`, and line 35 starts one worker per job. So the text belongs with the texture section.
- Inserting after line 147 puts it before "### The roughness bake" (line 149), which is a clean place in the outline. The edit breaks no writing rule and does not touch the website contract.

## Note on the edit

The proposed edit is sound. A plain paragraph right after line 147, with no heading, would also work and avoids a new one-paragraph H3. Either choice fixes the dangling reference.
