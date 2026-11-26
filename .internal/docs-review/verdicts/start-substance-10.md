# start-substance-10

## The finding as given

- Page: getting-started/hosting
- Anchor: lines 210, 243, 267, 297, 350, 366, 384, 388 (stats.json 203, 236, 260, 290, 343, 359, 377, 381)
- Category: technical-details-block. Severity: medium.
- Claim: Eight long paragraphs hold correct implementer detail: Chrome's code-cache timing (201 words, 13 sentences), HTTP/1.1 connection counts, shader file variants, the dev server's compression, and Safari over HTTP/2. They bury the page's main task.
- Evidence: stats.json getting-started/hosting longParagraphs; hosting.md:267 cites Chrome 156, 157 and 158 and ms timings.
- Proposed edit: Line 267: keep its first two sentences and add "So a repeat visit gains only after an earlier visit ran the engine for a few seconds." Move the rest into `<details><summary>Technical details: when Chrome writes the compiled core</summary>`. Do the same for line 243 ("Technical details: listed downloads over HTTP/1.1 and HTTP/2"), line 297 ("Technical details: shader files for each device"), line 366 ("Technical details: what the dev server and the preview compress"), and lines 384 and 388 ("Technical details: HTTP/2 on Safari and untrusted certificates"). Split lines 210 and 350 in two.

Verdict: partly

## Evidence

- The line numbers are right. The page lines are the stats.json lines plus 7 (the front matter). The eight paragraphs and their counts match stats.json.
- Line 267 (201 words, 13 sentences) is the clear case. Most of it is measurement detail (Chrome's two-second wait, the 1 MB rule, 110 ms to 30 ms, 160 ms against 176 to 180 ms, 3 against 273 functions). A block fits it. One part should stay open: "Chrome 156 and earlier rarely keep the code; Chrome 157 fixed it." That changes what a reader can expect, and the open text of guides/start-time.md:134 states it too. The page's own sentence 5 already says "a repeat visit gains only after an earlier visit ran the engine for a while", so the edit can keep that sentence. It does not need a new one.
- Line 243 (108 words): a block fits the six-connection and HTTP/2 priority detail. The open text keeps the first sentence and the result: the engine's own files still get a free connection.
- Line 297 (117 words): the variant detail (HDR bloom, files shared by two features) fits a block. The last three sentences are not just background. They give the sizes (several MB uncompressed, about a fifth with compression) and say where to read each file's size. A reader needs those numbers to choose which features to cache, so they stay in the open text. The finding does not say what stays open here.
- Line 366 (93 words): a block fits. The open text keeps one sentence: both servers compress for other devices on the network.
- Lines 384 and 388: the joint block is wrong. Line 386 sits between them, and it holds main-task steps (trust mkcert's root, the iPhone trust setting). One block cannot cover 384 and 388 without hiding line 386. Each paragraph also holds something the reader must act on:
  - Line 384 names the user-facing `http2: true` option.
  - Line 388 warns that a reader who clicks through the certificate warning gets no caching and wrong start timings, and tells them to install the root certificate on every device.
  With the blocks closed, a reader would miss that warning and could time starts wrongly. Only the reason (Safari on an iPad stalls over HTTP/2, the hundreds of module files, six at a time) and the 30 s against 15 s figure are block material. guides/start-time.md:140 already gives the HTTP/2 detail with its own numbers.
- Lines 210 and 350: splitting each in two is reasonable. Line 210 gives host-specific steps (Netlify, Cloudflare Pages, Vercel, GitHub Pages, then the nginx steps), and those should stay open. Line 350 is under its own heading and is all actionable. A split is light polish there.
- "They bury the page's main task" overstates the problem. Each of these paragraphs sits in its own later section with its own heading (Brotli, caching, offline play, development). None of them sits in "The two headers" section. The real cost is that each section is harder to read. Medium severity is still fair, because the page has 4792 words.

## Corrected claim

Five of the eight paragraphs (267, 243, 297, 366, and the reason part of 384) hold measurement or mechanism detail that fits a collapsed block. Each must keep its actionable fact in the open text: Chrome 157 and later keep the code; the sizes to cache; the `http2: true` option. Line 388 is a warning that readers must see, so it should be shortened, not collapsed. Lines 210 and 350 need only a split. The paragraphs make their own sections harder to read. They do not bury the page's main task.

## Corrected edit

- Line 267: keep sentences 1, 2 and 5 open ("The engine keeps optimizing for its first seconds, so a repeat visit gains only after an earlier visit ran the engine for a while."). Add one open sentence: "Chrome 157 and later keep it; Chrome 156 and earlier rarely do." Move the rest into `<details><summary>Technical details: when Chrome writes the compiled core</summary>`.
- Line 243: keep the first sentence and "The engine's own files then still find a free connection" open. Move the HTTP/1.1 and HTTP/2 detail into `<details><summary>Technical details: listed downloads over HTTP/1.1 and HTTP/2</summary>`.
- Line 297: keep open: "A feature's list holds every shader file it can need on each GPU path and device." Also keep the last three sentences (sizes, the build output, about a fifth with compression) open. Move the bloom/HDR example and the two-feature files into `<details><summary>Technical details: shader files for each device</summary>`.
- Line 366: keep the first sentence open. Move the rest into `<details><summary>Technical details: what the dev server and the preview compress</summary>`.
- Line 384: keep open: "The plugin serves this HTTPS over HTTP/1.1, because Safari on an iPad sometimes stalls over HTTP/2. For other browsers, the `http2: true` option serves HTTP/2." Put the module-count reason in `<details><summary>Technical details: why HTTP/1.1 is the default</summary>`, or cut it and link to guides/start-time.md. That page already gives the detail.
- Line 388: no block. Keep the warning open in two or three sentences: accepting the warning stops Chrome from caching any file, so each reload is as slow as a first visit and start timings are wrong; install the root certificate on every test device. Cut the 30 s against 15 s figure, or keep it as one short sentence.
- Lines 210 and 350: split each in two, as the finding proposes (210: host list / nginx steps; 350: what the cache keeps / a service worker that builds its own response and how to check).
