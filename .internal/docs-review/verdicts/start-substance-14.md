# start-substance-14

## The finding as given

- Page: getting-started/cdn
- Anchor: lines 31, 43, 187; "Production and development entries", lines 56-64
- Category: technical-details-block
- Severity: medium
- Claim: Three long paragraphs. The entries section mixes the one rule a trial needs (use the development entry while you work) with how to tell the entries apart through ?threads=off and with the benchmark build.
- Evidence: stats.json getting-started/cdn longParagraphs lines 24, 36, 180; cdn.md:58, :62, :64.
- Proposed edit: Move lines 58, 62 and 64 into <details><summary>Technical details: telling the entries apart, and a benchmark build</summary>. Turn line 43 into a short "Headers for the CDN" list: CORS, the .wasm type, a version prefix, and immutable caching.

Verdict: partly

## Evidence

- stats.json lists three long paragraphs at body lines 24, 36 and 180. The front matter has 7 lines, so these are file lines 31, 43 and 187, as the anchor says. They are 72, 82 and 67 words long. Each one is long only by sentence count (5, 5 and 6 short sentences). None is over 90 words.
- The entries section (cdn.md:45-64) holds a table, then six paragraphs. The table (line 49-52) and line 56 hold what a trial reader needs: the development entry runs checks, and the production entry is the one to time. Line 113 tells the trial reader to switch to `lib-dev/` while they work. Line 60 (use one entry for the whole page) is a rule every reader needs.
- Line 58 repeats the table ("never run", "ignored") and adds that the files still hold the checks' code. Line 62 tells how to see which entry runs, through `?threads=off` and `engine.mode.build`. Line 64 describes `bun run build:cdn --url-switches` for benchmark pages. The flag exists (tools/build-cdn.ts:5-6, :24; tools/lib/cdn.ts:130, :171). These three are correct, dense, and for implementers. With them closed, the section still reads well: table, line 54, line 56, line 60. So the block for 58, 62 and 64 holds.
- Line 43 holds five points: the `.wasm` content type, browser caching so Chrome keeps the compiled core, no content hash in file names, a version prefix, and an immutable Cache-Control value. A list suits it, and line 127 points back to "the headers of Make the CDN build", which a list makes easier to find.

## What does not hold

- CORS is not in line 43. It already has its own sentence and code block at lines 37-41. A list with CORS in it must replace lines 37-43 together, or else it repeats the CORS header.
- A version prefix is a folder path, not a header. A list titled "Headers for the CDN" with it as an item mislabels it. The reason for the prefix (the file names hold no content hash) must stay with it, or the immutable caching advice reads as unsafe.
- The finding names lines 31 and 187 but proposes nothing for them. Line 31 mixes the step (run the build, upload under one prefix, keep the layout) with size detail (most of the folder is shader builds; the development entry adds a few MB). Line 187 mixes the import rule with how an add-on's entries map to the engine's entries.
- Severity medium is high. All three paragraphs are under 90 words and long only by sentence count, with short sentences. The page stays easy to follow. Low fits better.

## Corrected claim

Three paragraphs are long by sentence count only (lines 31, 43 and 187, at 67-82 words). The entries section also carries detail that a trial reader can skip: line 58 (repeats the table, and notes the check code stays in the files), line 62 (telling the entries apart with `?threads=off`) and line 64 (the `--url-switches` benchmark build). Severity low.

## Corrected edit

1. Move lines 58, 62 and 64 into `<details><summary>Technical details: telling the entries apart, and a benchmark build</summary>`, after line 60. Keep line 56 and line 60 in the main text.
2. Replace lines 37-43 with one short list of what the CDN serves, with the reason beside each item:
   - `Access-Control-Allow-Origin: *` on every file, because the engine loads its modules and `.wasm` files in CORS mode.
   - `Content-Type: application/wasm` on each `.wasm` file, with nothing after it, so Chrome keeps the compiled core ([Let Chrome keep the compiled core](hosting.md#let-chrome-keep-the-compiled-core)).
   - One folder per engine version, such as `https://cdn.example.com/null3d/0.1.0/`, because the file names hold no hash of their content.
   - `Cache-Control: public, max-age=31536000, immutable` on every file in a versioned folder, so a repeat visit takes them from the browser's cache.
   Introduce it as "Serve the folder this way:", not as a list of headers.
3. Line 31: end the paragraph after the upload sentence, and put the size detail (shader builds; the development entry adds a few MB) in its own short paragraph, or in the details block above.
4. Line 187: split after "so a sketch in a worker reaches it too." Put the two entry addresses (`addons/<name>/lib/index.js` and `addons/<name>/lib-dev/index.js`) in a two-item list.
