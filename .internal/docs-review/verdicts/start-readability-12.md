# start-readability-12

## Finding as given

- page: getting-started/hosting
- anchor: ## Headers on common hosts (line 117); ## What isolation changes (line 392)
- category: scan-order
- severity: medium
- claim: The host examples come after the CSP, the CDN case and two builds. The one risk of isolation, a broken sign-in popup, is the last section, so a reader turns isolation on before reading it.
- evidence: Heading order: The two headers, Files from other sites, Content-Security-Policy, The engine's files on a CDN, Two builds, Headers on common hosts ... During development, What isolation changes.
- proposedEdit: Reorder: The two headers, Headers on common hosts, What isolation changes, Two builds, Files from other sites, Content-Security-Policy, The engine's files on a CDN, then Brotli, notices, During development.

Verdict: partly

## Evidence

- The heading order in docs/getting-started/hosting.md is as the finding says. "The two headers" is at line 22 and "Headers on common hosts" at line 117. Between them come "Files from other sites" (35), "Content-Security-Policy" (44), the CDN case (60) and "Two builds" (104). "What isolation changes" is at line 392, the last section before "Related pages".
- The popup warning is only in that last section (line 394), and it says "Check such flows before you turn isolation on". No other docs page mentions it: a search of docs/ for "popup" and "window.opener" finds nothing outside hosting.md. The deploy guide (docs/guides/deploying.md lines 45-55) lists the host files and links to "Headers on common hosts" but gives no warning. So a reader who follows the host examples meets the warning about 275 lines later, after Electron, Brotli, caches, offline play and development. This part of the finding holds.
- The claim "the one risk of isolation" is wrong. The page names two things that break when isolation is on. The opener header breaks cross-origin popups (line 394). The embedder header with `require-corp` blocks files from other origins that do not opt in (lines 37-42, "Files from other sites"). The second one is the more common failure for a game that loads models or textures from a CDN.
- The proposed order moves "Files from other sites" after "Two builds", away from the headers that cause it. That hides the second risk, which is the opposite of what the finding wants.
- The proposed order is also incomplete. It leaves out "Desktop apps with Electron" (152), "Caches between visits" (221), "Let browsers keep the build files" (237) and "Offline play" (269), so an editor cannot apply it as written.
- Inbound links use these anchors: headers-on-common-hosts, files-from-other-sites, content-security-policy, the-engines-files-on-a-cdn, during-development and others. A reorder keeps every heading text, so no link breaks.

## Corrected claim

The host examples come after the CSP, the CDN case and the two builds. The two effects of turning isolation on are far apart: files from other origins that do not opt in are blocked (near the top), and cross-origin popups lose `window.opener` (the last section). A reader who copies the host headers meets the popup warning only at the end of the page.

## Corrected edit

Reorder the top of the page to: The two headers, Headers on common hosts, What isolation changes, Files from other sites, Two builds, Content-Security-Policy, The engine's files on a CDN. Then keep the rest in its current order: Desktop apps with Electron, Send the files with Brotli, Publish the third-party notices, Caches between visits, Let browsers keep the build files, Offline play, During development, Related pages.

In "What isolation changes", add one sentence that points to the next section: under `require-corp`, files from other origins also need to opt in, as "Files from other sites" explains. Keep every heading text the same so the links from other pages still work.
