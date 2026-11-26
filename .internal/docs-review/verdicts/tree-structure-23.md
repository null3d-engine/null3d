# tree-structure-23

## Finding as given

- page: guides/car-paint, guides/lens-kit, guides/screens
- anchor: "The paint is an example add-on in the repository"
- category: missing-content, severity: low
- claim: Four of the seven example add-ons have no page, and nothing in navigation says the three guide pages are example add-ons that you copy, not packages.
- evidence: examples/addons/README.md lists traffic-lanes, lens-kit, aurora, car-paint, facades, screens and weather. Only car-paint, lens-kit and screens have guide pages.
- proposedEdit: NEW guides/example-add-ons listing all seven with what each draws and links to its README and demo. Group it with car-paint, lens-kit and screens under 'Example add-ons'.
- generatedSource: tools/lib/docs.ts (PAGES)

Verdict: partly

## Evidence

- examples/addons/ holds seven folders: aurora, car-paint, facades, lens-kit, screens, traffic-lanes, weather. Each has a README that says what it draws (for example weather: rain, wet ground, drops on glass; facades: lit rooms behind windows and a power-on wave; traffic-lanes: tens of thousands of cars moved in the vertex shader).
- docs/guides/ has car-paint.md, lens-kit.md and screens.md only. The other four have no page.
- The four appear in the docs only in passing: docs/getting-started/third-party-notices.md:88 names all seven (licence context only), and docs/api/scene.md:298 names the aurora add-on in one sentence. A reader cannot find weather, facades or traffic-lanes from the docs. The first half of the claim holds.
- The second half is overstated. Each of the three pages says it near the top: car-paint.md:28, lens-kit.md:27 and screens.md:26 all say the add-on is in examples/addons/<name>, is not an npm package, and that you copy the folder. Only the page list (docs/pages.md rows 102-104, from the PAGES summaries in tools/lib/docs.ts:154-156) and the titles do not say so.
- The proposed grouping does not fit the page-list generator. AREAS in tools/lib/docs.ts:59-69 is a flat list of top-level folders, and pageList (docs.ts:519-540) groups pages only by the first path segment. A sub-group "Example add-ons" inside Guides needs a generator change (or is left to the website's navigation).
- The add-on READMEs carry internal words (for example aurora's README cites "H8, D-173 ruling 2", and examples/addons/README.md links .dev/decisions). Linking them is allowed, but the new page should describe each add-on in its own words, not rely on the READMEs for the summary.

## Corrected claim

Four of the seven example add-ons (traffic-lanes, aurora, facades, weather) have no docs page; aurora gets one sentence in api/scene, and the rest appear only in the third-party notices. The three guide pages do say, near the top, that they are example add-ons to copy, but the page list and their summaries do not.

## Corrected edit

Add a hand-written page guides/example-add-ons.md and its PAGES entry in tools/lib/docs.ts, placed right before guides/car-paint so the four add-on pages sit together in the Guides list. The page has one short intro (example add-ons are folders you copy, not npm packages, built only on the public API) and a table of all seven: name, what it draws, a link to https://github.com/null3d-engine/null3d/tree/main/examples/addons/<name>, a link to the guide page where one exists (car-paint, lens-kit, screens), and a demo link using the demo's code value from examples/demos.ts (for example aurora for aurora, canvas-screen for screens, instances for traffic-lanes). Start the three guide summaries in PAGES (docs.ts:154-156) with "An example add-on you copy:". Do not add a new area or sub-group unless the page-list generator is changed for it.
