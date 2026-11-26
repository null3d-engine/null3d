# start-readability-15

## Finding as given

- Page: getting-started/cdn
- Anchor: lines 31, 43, 187
- Category: long-paragraph. Severity: medium.
- Claim: Line 31 mixes what the build writes, its size, where to upload it and --out. Line 43 gives three header rules and a versioned prefix in five sentences. Line 187 gives the add-on layout and entries in six sentences. The upload rules are a checklist hidden in prose.
- Evidence: stats.json lines 24, 36, 180 (file 31, 43, 187).
- Proposed edit: Add '### Upload the folder' with numbered steps: upload target/cdn under a per-version prefix and keep its layout; send Access-Control-Allow-Origin: *; send .wasm as application/wasm; send Cache-Control: public, max-age=31536000, immutable. For 187, a two-row table Entry | Add-on path, and one sentence that the add-on imports the engine from the same build.

Verdict: partly

## Evidence

- The page says what the finding claims. Line 31 has five sentences on build output, size, the shared shader builds, the upload prefix and `--out`. Line 43 has five sentences: the wasm type, browser keeping, Chrome's code cache, no content hash, the per-version prefix and the cache header. Line 187 has six sentences on add-on layout, import by full address, same-build import, and the two entry paths. The paragraph counts are facts from stats.json.
- The upload rules really are a checklist spread over three places: the prefix and layout (line 31), the CORS header in its own block (lines 37-41) and three more rules in prose (line 43). A reader who hosts the folder must collect them. The claim holds.
- The proposed edit is partly wrong:
  1. Numbered steps imply an order. The header rules have no order. A bulleted list fits better.
  2. The terse items drop detail that matters. "With nothing after it" (line 43) is a real rule: the hosting page (hosting.md line 262) says Chrome refuses a parameter such as `; charset=utf-8`. The reasons also go: CORS mode for module imports and wasm downloads (line 37), the Chrome code cache link (line 43), and "file names hold no hash" (the reason for the per-version prefix and `immutable`). Those reasons tell an implementer why a rule exists. They must stay, short in each bullet or in a details block.
  3. Line 127 links back to "the headers of [Make the CDN build](#make-the-cdn-build)". If the rules move under a new subheading, that link must point to the new anchor (`#upload-the-folder`).
  4. For line 187, a two-row table works and matches the entry table at line 49. But line 60 already gives the add-on development path. A two-item list is enough. Either is fine; the table is a matter of taste.
- The rest of line 31 (what `build` and `build:cdn` do, the size, `--out`) stays under "Make the CDN build".

## Corrected edit

Under "## Make the CDN build", keep line 31's first three sentences and the `--out` sentence with its code block. Add `### Upload the folder` with a short lead and a bulleted list (not numbered):

- Upload `target/cdn` under a prefix of its own for each engine version, such as `https://cdn.example.com/null3d/0.1.0/`, and keep its layout. The file names hold no hash of their content, so a new version needs a new prefix.
- Send `Access-Control-Allow-Origin: *` with every file. The engine imports its modules and downloads its `.wasm` files in CORS mode.
- Send each `.wasm` file with `Content-Type: application/wasm`, with nothing after it. Chrome then keeps the compiled engine core, and a repeat visit skips most of its compile ([Let Chrome keep the compiled core](hosting.md#let-chrome-keep-the-compiled-core)).
- Send `Cache-Control: public, max-age=31536000, immutable`, so a repeat visit takes the files from the browser's cache.

Remove the separate CORS http block (lines 37-41) and the prose at line 43, since the list holds them. Change line 127's link to `#upload-the-folder`.

For line 187, keep the first four sentences (layout, full address, same build, same version). Replace the last two with a two-item list or a two-row table: production entry `addons/<name>/lib/index.js`, development entry `addons/<name>/lib-dev/index.js`, each importing the matching engine entry.
