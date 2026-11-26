# guides-2-substance-06

Finding as given:

- page: guides/start-time, guides/loading-screens
- anchor: start-time lines 46-57, 66-104, 254-262 ('A small demo', 'the creek demo', 'skyway', 'the splat demo', 'the character demo'); loading-screens line 172 ('the instances demo')
- category: unclear; severity: medium
- claim: 'Small demo' is never defined, and no demo name has a link. The same figure (1.18 s against 0.49 s on a MacBook Pro) is 'A small demo' in start-time:57 and 'the instances demo' in loading-screens:172. The instances demo draws 100,000 columns, which is not small.
- evidence: examples/demos.ts:163-207 (creek, island, skyway under showcase/); demos.ts:903 (splats); demos.ts:925-929 (instances, '100,000 columns'); demos.ts:735 (character).
- proposedEdit: Name the small demo at its first use and use one name on both pages. Link each demo once: .../examples/showcase/creek/, .../showcase/island/, .../showcase/skyway/, .../splats/, .../character/, .../instances/.

Verdict: partly

Evidence:

- start-time.md uses "small demo" at lines 46, 49, 57, 66, 77, 88, 99, 106, 140, 254 and 264. No line says which demo it is. Line 40 says only "Three demos whose first view needs no large file".
- start-time.md:57 gives "A small demo's loading screen on a first visit, at full speed on a MacBook Pro", 1.18 s before and 0.49 s after (check during play). loading-screens.md:172 gives the same pair for "the instances demo" on a MacBook Pro (0.49 s during play, 1.18 s before play). Same measurement, two names. This part holds.
- stats.json lists no GitHub example links for either page. No demo name on either page has a link. This part holds.
- Link codes check out in examples/demos.ts: creek 'showcase/creek/', island 'showcase/island/', skyway 'showcase/skyway/', instances 'instances/'. splats and character have no code value, so 'splats/' and 'character/' (name + '/') are correct under the website contract.
- The sub-claim "100,000 columns is not small" is weak. The page's sense of "small" is the download: line 40 groups it with demos "whose first view needs no large file". The instances scene is made in code (demos.ts instances summary: the sketch writes every column's height). So the label is not wrong. It is undefined, and "small" next to a 100,000-object scene can confuse a reader.
- Only line 57 ties "small demo" to the instances demo. The page does not prove that the other ten uses (the HTTP/1.1, HTTP/2, phone and pipeline tables) are the same demo, though the pipeline counts (16 to 17 on phones, 31 on the Mac) fit one simple scene.

Corrected claim: "Small demo" is never defined on start-time, and no demo name on either page links to its code. Line 57 of start-time and line 172 of loading-screens report the same MacBook Pro figure (1.18 s against 0.49 s) under two names, "a small demo" and "the instances demo". The instances demo is small in download size (its scene is made in code) but it draws 100,000 columns, so "small" with no explanation can mislead.

Corrected edit: At the first use of the term (start-time line 40 or 46), name the demo and say what "small" means, for example: "the instances demo, whose scene is made in code and needs no large download (the small demo below)". Before renaming the later table rows, confirm with the measurement source that every "small demo" row is the instances demo; if so, use "Instances" in the table headers and "the instances demo" in prose on both pages. Link each demo once per page at its first mention, with the codes above under https://github.com/null3d-engine/null3d/tree/main/examples/. Keep links out of the table headers; put them in the sentence that introduces the tables.
