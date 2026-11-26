# start-substance-25

## Finding as given

- page: getting-started/hosting, getting-started/cdn, getting-started/install, getting-started/third-party-notices
- anchor: hosting ## Publish the third-party notices (215-219); cdn line 228; install line 55; third-party-notices line 94
- category: duplication
- severity: low
- claim: Four pages repeat "Keep that file with the build, or show its text in your credits".
- evidence: The lines cited in the anchor.
- proposedEdit: Keep the rule on Third-party notices. In hosting, replace the section with one sentence and a link. Keep install's bullet as a link only.

Verdict: partly

## Evidence

- hosting.md:217 and third-party-notices.md:94 say the same thing in almost the same words: "A production build with the null3D Vite plugin ... `null3d-third-party-notices.txt` beside the page. Keep that file with the build when you publish it, or show its text in your game's credits." hosting.md:219 also repeats the `node_modules/@null3d/engine/THIRD-PARTY-NOTICES.txt` path (third-party-notices.md:92) and the note that the tool's notices stay out of the file (third-party-notices.md:94). This duplication is real.
- install.md:55 does not repeat the rule. It says the plugin writes the notices, and then links: "[Hosting](hosting.md#publish-the-third-party-notices) says what to do with them." It is already link-only, so that part of the edit asks for no change.
- cdn.md:228 is about a different build. The CDN page's build is `bun run build:cdn`, which writes the `target/cdn` folder (cdn.md:22-44), and it is for pages with no Vite build. Hosting's section speaks only of "a production build with the null3D Vite plugin". So a CDN reader needs the line on the CDN page. It has no link to the notices page, though; the only nearby link is the Related pages entry for Hosting (cdn.md:232).
- The finding misses a fifth place: guides/deploying.md:34 has a table row that says "Publish it with the build, or show its text in your credits", with a link to Third-party notices.
- Cutting the hosting section to "one sentence and a link" breaks something. install.md:55 links to `hosting.md#publish-the-third-party-notices`, and cdn.md:232 and hosting's front-matter summary promise that Hosting covers the notices. A reader who follows install's link would land on one sentence that sends them on again.
- Cost to a reader: low. One short action line on the pages where a developer publishes (hosting, deploying, cdn) helps them. The real waste is hosting's second paragraph, which copies the reference page.

## Corrected claim

Hosting (215-219) and Third-party notices (92-94) repeat the same two paragraphs: the rule, the `node_modules` path and the note about the tool's notices. cdn.md:228 states the rule for the CDN build folder, which Hosting does not cover, so it is not a pure duplicate. install.md:55 is already a link. guides/deploying.md:34 also states the rule.

## Corrected edit

- hosting.md: keep the section and its heading, because install.md links to it. Keep the paragraph at line 217 (the rule). Replace the paragraph at line 219 with: "[Third-party notices](third-party-notices.md) lists every part and its license."
- third-party-notices.md: keep lines 92-94 as the full reference.
- cdn.md:228: keep the rule, because it applies to the CDN folder. Add a link at the end: "([Third-party notices](third-party-notices.md))".
- install.md:55 and guides/deploying.md:34: no change.
