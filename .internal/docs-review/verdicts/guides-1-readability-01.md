# Verdict: guides-1-readability-01

## The finding as given

- page: guides/assets-pipeline
- anchor: "# The asset pipeline (the `assets` command)"
- category: split-page
- severity: high
- claim: The page has 8,386 words, 20 headings and 25 long paragraphs. It covers five commands and a shader-permutation build that is not an assets command. A reader who wants one model optimized, or one environment map, must scroll past all of it.
- evidence: stats.json guides/assets-pipeline: words 8386, 25 longParagraphs; headings run from '## Optimize a model' (line 25) to '## Build only the shader permutations you draw with' (line 465).
- proposedEdit: Split into: guides/assets-pipeline (optimize, Vite, meshes, clips, blockers and trees, textures with the roughness bake and encode time, budget report, shader list, and a short 'Other commands' list); guides/assets-levels-of-detail (lines 175-236); guides/assets-convert (lines 311-359); guides/assets-textures (pack-orm, normal-from-bump, env: lines 361-459). The permutation build gets its own page (see the permutation finding). Add the new pages to AREAS and PAGES in tools/lib/docs.ts.

Verdict: partly

## Evidence

What holds:

- The counts are facts from stats.json: 8,386 words, 20 headings counting the title, and 25 long paragraphs.
- The page covers five commands: optimize, convert, pack-orm, normal-from-bump and env (docs/guides/assets-pipeline.md:25, 311, 361, 386, 408). The last section (line 465 on) is a repository build step (`bun tools/shader-permutations.ts`, `bun run examples:build`), not an `assets` command.
- Words per section: Levels of detail with its three subsections has about 1,880 words (lines 175-236). Convert has about 650, pack-orm about 270, normal-from-bump about 310 and env about 540. The permutation build has about 660.

What does not hold:

1. "A reader who wants one model optimized must scroll past all of it" is wrong. "Optimize a model" is the first section (line 25), with the command, sample output and option table. Only the env-map reader must scroll far, and the CLI page already answers that reader in short form (docs/cli/null3d.md:476-486).
2. Severity high is too strong. Nothing on the page misleads, and the newcomer's task comes first. The cost is length, so medium fits.
3. A new guides/assets-levels-of-detail page would put the same facts in a third place. concepts/lod.md already covers the tool's levels and stages (lines 77-99), the loader's warm-up and `maxLevels` (93-95), measured against hand-set errors (99), cluster trees and their streaming bands (101-117), and the instance-batch copy count (119). The guide repeats these at lines 189, 201-207 and 219-225. AGENTS.md "Docs and skills stay in sync" rule 1 asks for one source per fact. Splitting moves the duplication; it does not remove it.
4. The name guides/assets-textures is misleading. The main page would keep the "Textures" section and the roughness bake (lines 132-173), while a page called textures would hold env maps, which are lighting data. Texture facts would sit on two pages.
5. The edit leaves out the inbound anchor links that the split breaks: docs/cli/null3d.md:486 (#environment-maps), :498 (#convert-other-formats), :525 (#pack-occlusion-roughness-and-metalness); docs/concepts/lod.md:79 (#levels-of-detail), :95 (#levels-as-separate-downloads), :105 (#cluster-levels); docs/concepts/lighting.md:234 and :584 (#environment-maps). It also leaves out the links inside the convert table (lines 346, 349), which would cross pages.
6. AREAS needs no change. The `guides` area already exists (tools/lib/docs.ts:63). Only PAGES gets new entries.
7. The user asked that correct, dense detail move into collapsible blocks rather than be cut. The proposal moves text to new pages, but most of its length is implementer detail that suits such blocks.

## Corrected claim

The page is long (8,386 words, 25 long paragraphs). It mixes the five `assets` commands with a repository build step for shader permutations. The length comes mostly from the levels-of-detail section, which repeats runtime facts from concepts/lod.md, and from file-format and loader detail that most readers do not need. A reader who wants to optimize a model finds that task first. Severity: medium.

## Corrected edit

Keep one guide for the `assets` command, and shorten it:

1. Move the permutation build to its own page, as the separate permutation finding proposes. Update the link at docs/guides/deterministic-simulation.md:214.
2. In "Levels of detail" and its subsections, keep what the tool writes and when to use each option. Drop the runtime behavior that concepts/lod.md already gives: the loader's warm-up and set-aside stages (line 203), `maxLevels` (205), how the loader switches or fades measured and hand-set levels (part of 189), which GPU paths draw patches (end of 219), and the instance-batch caveat (223). Link to the matching concepts/lod.md sections in their place, and move any fact that is missing there into that page.
3. Wrap the dense, correct implementer detail in collapsible blocks, so that the main text reads well with every block closed:
   - the stage file layout and band order (line 207), in "Technical details: the stage file layout";
   - the `MSFT_lod`, `NULL3D_lod_error` and `MSFT_screencoverage` extras (line 189), in "Technical details: what the file stores for each level";
   - the cluster build steps (lines 213-219), in "Technical details: how the tree is built";
   - the blocker checks (lines 111-115) and the stored tree costs (line 128);
   - where the quantization transform goes (line 84);
   - the UASTC cost of a baked map (line 165);
   - the fade rules of the shader list (line 276).
4. Under the title, add a short list of the commands with links to their sections, so that a reader of convert, pack-orm, normal-from-bump or env can jump to their section.
5. Only if the page is still too long after steps 1 to 4, move convert, pack-orm, normal-from-bump and env together to one page, such as guides/assets-other-commands. Add one PAGES entry in tools/lib/docs.ts (AREAS needs no change), and update every anchor link listed in point 5 of the evidence.
