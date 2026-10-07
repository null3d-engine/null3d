# D-101: The roughness bake in the asset tool

Status: decided by the owner on 2026-10-08 at about 00:28 (UTC+8), through the coordinator: option A. Prototype L3's comparison with M2-E7's shader filter is pending, and runs in M2-E7's work after this record's pull request merges. Date: 2026-10-08. Task: M2-B6.

Summary: `assets optimize` bakes each normal map's spread into the roughness mip levels of the material's metal-rough map, with Godot's formula, below the full size. A baked map encodes each level alone in UASTC with RDO, and the tool joins the levels. On BoomBox the metal-rough map grows from 269 KB in ETC1S to 1.65 MB, and the model from 2.1 MB to 3.4 MB. Its mean roughness error falls from 6.7 to about 1.2 steps of 255.

## Question

How should the asset tool bake normal map detail into roughness, as [D-53](D-53-technique-defaults.md) ruling 11 asks, and in which texture format?

## Rule

- Distant normal-mapped surfaces lose the spread of their normals when the GPU filters the normal map. The roughness at the same distance must take that spread, so the highlight widens instead of flickering.
- The same input gives the same bytes on every machine, as for every other texture of the tool.
- The tool runs the official Basis Universal 2.50 encoder build unchanged, as the encoder's unit test checks.
- Up close, the material looks as its author made it.

## The formula

Godot's `Image::generate_mipmap_roughness` (`core/io/image.cpp`, godotengine/godot at commit 6eb8a2b2a of 16 September 2026). For each texel of a mip level, average the unit normals of the normal map under it, and take the average's length r. Then:

- κ = (3r − r³) / (1 − r²), the spread of a von Mises-Fisher lobe with that mean length;
- variance = 0.25 / κ;
- roughness' = √(roughness² + min(3 × variance, 0.4²)).

The tool keeps Godot's rules: level 0 stays as authored, and the added part is at most 0.4². It adds two of glTF's own:

- The normal scale multiplies each normal's x and y before the normal turns to unit length, as glTF's shader does.
- The added part is divided by the square of the material's roughness factor, since the shader multiplies the texel by the factor. A factor of 0 gets no bake.

The tool resizes the metal-rough map to each level from its full size, with its usual filter. So no level takes the rounding of the one above. The normal map is read at the size that the tool encodes it, the size that the GPU samples. Where the normal map is smaller than a level, each texel reads the one normal texel under it, so it takes no bake.

## Data

| Measure | ETC1S, no bake (before) | UASTC, baked | UASTC with RDO, baked (option A) | Source |
| --- | --- | --- | --- | --- |
| BoomBox's 2048 x 2048 metal-rough map | 269 KB | 3.27 MB | 1.65 MB | `assets optimize` on the sample content's BoomBox.glb |
| BoomBox, model and textures | 2.1 MB | 5.0 MB | 3.4 MB | The same runs |
| The same map at 1024 x 1024 | 66 KB | 776 KB | 355 KB | Probe script on the tool's modules |
| Mean roughness error at 1024, of 255 (max) | 6.73 (244), level 0 | 0.57 (180), levels 0 to 2 | 1.20 (180), levels 0 to 2 | The engine's transcoder against the source levels |
| Phone GPU memory of BoomBox's textures (ETC2 and ASTC) | 13.3 MB | 16.0 MB | 16.0 MB | The tool's report |
| Encode time of that map, on a shared Mac with its load between 10 and 19, so only a rough guide | 5.6 s | 2.1 s | 8.9 s | The tool's report, one thread per texture |

How the data was produced: the tool's command ran on BoomBox.glb from the sample content (commit c52dda2f), with `--jobs 4`. It ran through the shared heavy-run slots on 8 October 2026, with and without `--no-roughness-bake`. RDO strengths (UASTC's rate-distortion quality scalar) of 0.5, 1, 2 and 4 at 1024 gave 392, 355, 327 and 302 KB.

## Options

| Option | What | Download cost per baked map | For | Against |
| --- | --- | --- | --- | --- |
| A | Bake by default, in UASTC with RDO at the encoder's default strength | About 5 to 6 times ETC1S | Roughness 5 times closer to the source than ETC1S; Khronos's KTX artist guide asks for UASTC on packed ORM maps | Larger download and twice the GPU memory of ETC2 for these maps |
| B | Bake by default, in plain UASTC | About 12 times ETC1S | The least loss | The largest download |
| C | Bake only with `--texture-quality high`; keep ETC1S, unbaked, by default | None | No size change by default | No bake for most users; shimmer left to the shader filter alone |
| D | Bake in ETC1S | Not possible | | ETC1S files share one codebook across levels, and the encoder makes levels only from the top one. The encoder's JavaScript build takes no levels of our own |

Each option keeps `--no-roughness-bake` (and `roughnessBake: false` in the Vite plugin) to turn the bake off.

## How the levels reach the file

The encoder's JavaScript build has no call that takes mip levels made outside it: `setSliceSourceImage` sets layers, faces or frames, never levels. So the tool encodes each level as a KTX2 file of one level, with no mip generation. It then joins the files into one. The joined file has the first file's header, format descriptor and key-value data, then a level index. Each level's Zstandard data follows, smallest first, packed with no padding. That is the layout the encoder writes for its own levels. A unit test splits an encoder file into levels and joins them back to the same bytes. It works for UASTC, whose levels are separate Zstandard streams. It cannot work for ETC1S, whose BasisLZ data shares one codebook across all levels.

## Whole blocks

The tool already gives every PNG and JPEG texture sides that are powers of two of at least 4 texels. So every texture it encodes is whole 4 x 4 blocks. A 1,023 x 517 image leaves as 1,024 x 512. A KTX2 image that the model already had moves to a file unchanged. The tool has no KTX2 transcoder: the engine's is 353 KB after Brotli, and the command-line package does not ship it. So such an image in partial blocks stays as it is. The report names it, says the engine loads it uncompressed, and counts it as uncompressed in every memory figure. It asks for the PNG or JPEG source instead. Changing only the header to whole-block sizes would not work: the lower levels' block counts would no longer match.

## Decision

Option A, decided by the owner on 2026-10-08 at about 00:28 (UTC+8), through the coordinator. The tool bakes by default, and each baked map is UASTC with RDO at the encoder's default strength.

- On BoomBox, the 2048 x 2048 metal-rough map takes 1.65 MB baked. It took 269 KB unbaked in ETC1S, and would take 3.27 MB baked in plain UASTC. The whole model goes from 2.1 MB to 3.4 MB.
- ETC1S moved the map's roughness by 6.7 steps of 255 on average, and by up to 244. UASTC with RDO moves it by about 1.2 on average.
- Khronos's [KTX artist guide](https://github.com/KhronosGroup/3D-Formats-Guidelines/blob/main/KTXArtistGuide.md) also asks for UASTC on packed occlusion, roughness and metalness maps, since ETC1S mixes their channels.
- Options B and C were weighed and set aside. B costs twice A's bytes for about half a step of 255 less error. C leaves most users with no bake.
- `--no-roughness-bake`, and `roughnessBake: false` in the Vite plugin, turn the bake off.

## Comparison with the shader filter

Prototype L3 compares three.js's term, M2-E7's shader filter, this bake, and the bake with the filter. That comparison runs in M2-E7's work, with this tool, after this record's pull request merges. B6 is complete without it. The plan sent to M2-E7's helper:

- Add a glTF scene to the shimmer page, beside its `bumps` scene. It holds the same metal sphere of roughness 0.2, under the same normal map of 16 bumps on 256 texels. A metal-rough map gives it that roughness.
- Build the file in code, as the asset test scene is built. Optimize it twice, with and without `--no-roughness-bake`, and commit both outputs, as the asset test scene's outputs are.
- Measure the flicker of each file with the filter on and off, on the Mac, the iPad and the cloud phones of L3. The result settles whether the bake stays on by default, and the filter's settings.

## Consequences

- `assets optimize` and the Vite plugin bake by default. `--no-roughness-bake` and `roughnessBake: false` turn it off.
- A metal-rough map that materials read with different normal maps, scales or factors, or with a bake and without, gets one file for each.
- The bake skips a material when its two maps read different texture coordinates or transforms. It also skips a roughness factor of 0, and maps that are KTX2 images of the model. The report lists each such material and its reason.
- The asset test scene's ball has a 32 x 32 metal-rough map and a 64 x 64 normal map. Its metal-rough file is now baked UASTC, so the committed outputs changed.
- Docs: `guides/assets-pipeline` (the roughness bake, the report's new lines), `cli/null3d`. The develop skill's asset step.
