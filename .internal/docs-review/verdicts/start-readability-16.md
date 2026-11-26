# start-readability-16

## Finding as given

- page: getting-started/install
- anchor: ## Builds (line 63) and ## Run the sketch (line 81)
- category: scan-order
- severity: medium
- claim: Seventeen lines on the shader cache sit between adding the plugin and running the sketch. Line 71 gives the cache key, which a user needs only to trust the cache.
- evidence: stats.json line 64 (file 71): 79 words, 5 sentences. Order: Install the packages, Add the Vite plugin, Builds, Run the sketch.
- proposedEdit: Move ## Run the sketch to follow ## Add the Vite plugin. Rename ## Builds to ## The shader cache. Keep the first-build pause, the cache use and how to ignore or clear it; move line 71's key into <summary>Technical details: what the cache keys on</summary>.

Verdict: partly

## Evidence

- docs/getting-started/install.md:63-79 is the Builds section, 17 lines. Lines 65-69 list what the plugin compiles; lines 71-79 are the cache. So the section is not only about the cache.
- install.md:81-89 (Run the sketch) is the step a newcomer wants next after the plugin. Moving it up is a real scan-order gain. Line 89 says "the two headers", which line 48 (plugin section) introduces, so the move keeps that reference valid.
- install.md:71: the key sentence ("The key of an entry is the WGSL, the variant spec ... and the compiler's version") is restated in effect by the next sentence ("A changed shader, a changed variant or a newer compiler misses ... so the cache never serves a wrong shader"). The main text stays clear without it, so a details block is fine.
- packages/vite-plugin/src/shader-cache.ts:5-8: the real key also holds the path the WGSL came from, and the compiler version is the engine version plus the shader build's stamp. The page omits the path. A details block should state the full key.
- docs/guides/custom-shaders.md:150 links to `../getting-started/install.md#builds`. The proposed rename to "The shader cache" breaks that anchor. The proposed edit does not update it.
- The first-build pause (install.md:73) is what a reader meets on the first `bunx vite`. With Run the sketch moved above, the pause is explained after the reader has seen it; the plugin prints a line during the pause, so this order is acceptable.

## Corrected claim

The Builds section (17 lines: what the plugin compiles, then the cache) sits between adding the plugin and running the sketch. Line 71's cache key is restated by the next sentence, so it can go into a details block.

## Corrected edit

Move ## Run the sketch to follow ## Add the Vite plugin. Rename ## Builds to ## Shader compiles and the cache (it still holds the list of what the plugin compiles), and update the link in docs/guides/custom-shaders.md:150 to the new anchor (#shader-compiles-and-the-cache). Keep the list, the first-build pause, the "a changed shader, variant or compiler compiles again" sentence, and how to ignore or clear the cache. Move line 71's key sentence into:

<details>
<summary>Technical details: what the cache keys on</summary>

An entry's key is a hash of the WGSL, the path it came from, the variant spec the compiler is given, and the compiler's version. That version is the engine's version plus the shader build's own stamp, so any engine or compiler upgrade misses every entry.

</details>
