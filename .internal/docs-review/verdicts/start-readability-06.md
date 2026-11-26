# start-readability-06

## The finding as given

- page: getting-started/hosting
- anchor: lines 210, 243, 267, 297, 350, 366, 384, 388
- category: long-paragraph, severity: medium
- claim: Eight paragraphs pass 90 words or 4 sentences. Line 267 is 201 words and 13 sentences of Chrome code-cache timing. Line 243 explains HTTP/1.1 connection limits for the downloads option, off the section's topic.
- evidence: stats.json lines 203, 236, 260, 290, 343, 359, 377, 381 (file line = stats line + 7).
- proposedEdit: 210: a list per host (Netlify, Cloudflare Pages, Vercel: Brotli; GitHub Pages: gzip; nginx: three numbered steps). 243: move to the download list section of api/sketch or guides/start-time, or put in a details block. 267: keep two sentences (Chrome writes the code a few seconds after start, so a repeat visit gains only after an earlier visit ran a while); move the rest into <summary>Technical details: when Chrome writes the compiled core</summary>. 297: keep two sentences, block for two-feature shaders and sizes. 350: split rule from check. 366: one paragraph for dev, one for preview, re-compression in a block. 384: keep the Safari reason and the http2 option, block for the hundreds-of-files reason. 388: split, lead the second paragraph with 'Install the root certificate on every device that tests a page.'

Verdict: survives

## Evidence

- The offset holds. stats.json lines 203, 236, 260, 290, 343, 359, 377, 381 match page lines 210, 243, 267, 297, 350, 366, 384, 388 in docs/getting-started/hosting.md. All eight pass the limit (210: 75 words but 6 sentences; 384: 72 words, 5 sentences; 388: 83 words, 5 sentences; the rest pass 90 words).
- Line 267 is 201 words and 13 sentences. It mixes the rule a reader needs (Chrome writes the compiled code a few seconds into a visit, so only a later visit gains) with test numbers (Chrome 158 test page, 110 ms to 30 ms, 160 ms against 176 to 180 ms, 3 against 273 functions) and the Chrome 156 fault. The numbers are correct, dense detail and fit a details block.
- Line 243 is off topic. The section "Let browsers keep the build files" is about cache headers. Line 243 is about how the download list shares HTTP/1.1 connections and HTTP/2 priority. Nothing in it concerns caching.
- Line 243 also repeats text that already exists on two linked pages: docs/api/sketch.md:98 (two at a time, up to four while loads wait, free connections for the engine's files) and docs/guides/start-time.md:200 (same, plus "at a low priority"). This makes the finding stronger, but it changes the right edit for 243 (see below).
- The other splits and blocks keep the main text whole with every block closed, and none needs a heading inside a block.

## Corrected edit (refinement, not a refutation)

- 243: do not move the text to api/sketch or guides/start-time, because both already hold it. Cut the paragraph from this page, or cut it to one sentence with a link: "The files that a sketch names in the `downloads` option leave connections free for the engine's own files ([The download list](../api/sketch.md#the-download-list))." If the HTTP/2 priority point is not on api/sketch.md, add it there as one sentence (its source is the page's own text, not generated).
- 297: keep the size sentence ("The start's files and the skinning shaders are the largest groups, several MB each ... about a fifth of that with compression") in the main text. It helps a reader decide which features to cache offline. Put only the two-feature shader detail in the block.
- The rest of the proposed edit stands.
