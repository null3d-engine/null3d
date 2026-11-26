# concepts-1-readability-12

## Finding as given

- page: concepts/backends
- anchor: ## Choosing a tier for testing, lines 162-172
- category: wall-of-text
- severity: medium
- claim: Line 168 packs five URL switches into one 162-word paragraph. Lines 164, 166, 170 and 172 add four more. A reader who wants one switch must read them all.
- evidence: backends.md:164-172 (?uploads, ?compile, ?half, ?hdr, ?scene-format, ?prepass, ?occlusion, ?depth, ?compression)
- proposedEdit: Keep line 162 (?gpu=) as the intro. Replace 164-172 with a table 'Switch | Values | What it does', one row per switch. Put the rg11b10 mantissa comparison in a details block under the table. If the Testing guide lists switches, move the table there and link to it.

Verdict: partly

## Evidence

- The claim holds. docs/concepts/backends.md:168 is one paragraph with ?half, ?hdr, ?scene-format, ?prepass and ?occlusion (stats.json: 162 words, 9 sentences). Lines 164, 166, 170 and 172 hold ?uploads, ?compile, ?depth and ?compression.
- The edit is partly wrong. The Testing guide already has a full table, "Switches for tests" (docs/guides/testing.md:212-245). It covers ?gpu, ?depth, ?uploads, ?compile, ?compression, ?scene-format and ?half. A second table on this page would copy it, and two copies drift apart.
- The Testing table lacks three switches that this page names: ?hdr, ?prepass and ?occlusion (grep of docs/guides/testing.md). ?prepass and ?occlusion are named in performance.md:292/300, culling.md:92 and quality-presets.md:220/239. ?hdr appears only in backends.md:168.
- Some text in this section is about how a tier behaves, not about a switch. ?depth=standard draws no shadows on WebGL2 (line 170). WebGL2 keeps RGBA16F by default because the small format drew no faster on the phones measured (line 168). Line 98 also says "The `?depth=standard` switch below", so the depth paragraph cannot be cut without changing that line.

## Corrected claim

Lines 164-172 are a wall of switch descriptions. Most of them repeat the switch table in the Testing guide, which this section does not link to.

## Corrected edit

- Keep line 162 (?gpu=) and add one sentence that links to the Testing guide's table: "The [Testing guide](../guides/testing.md#switches-for-tests) lists every switch."
- Cut the bare switch descriptions from 164, 166, 168 and 172: ?uploads, ?compile, ?half, ?hdr, ?prepass, ?occlusion and ?compression. Do not build a second table here.
- Keep two short facts about the tiers, each in its own short paragraph: the ?depth paragraph (line 170, which line 98 refers to), and the WebGL2 default scene format, RGBA16F, with the reason.
- Put the rg11b10 against rgba16f detail (the 6/6/5 mantissa bits against 10, and 4 against 8 bytes a pixel) in a `<details>` block with the summary "Technical details: the packed scene color format". Put it here or under "Color and anti-aliasing on each tier", next to the table row at line 76.
- In docs/guides/testing.md, add rows for `?hdr=off`, `?prepass=on`/`?prepass=off` and `?occlusion=on`/`?occlusion=off`.
