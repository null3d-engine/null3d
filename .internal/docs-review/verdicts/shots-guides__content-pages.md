# Shot and demo-link verdicts: guides/content-pages

## Shots

### poster-then-canvas: reject
- Source is wrong. The shot is "scripted" on "a test page built from the page's fallback snippet". No such page exists. No test page under tests/pages and no demo uses a poster, a `no-scene` class or a fallback swap. The steps ("load with the sketch blocked") are not a switch that any page has. Someone would have to build a new page first.
- Value is low. The poster is, by design, a still picture of the scene. Side by side, the two halves look almost the same. The point of the section is the order of work and the HTML structure, and the code already shows that.

### network-slow-connection: reject
- "Manual" fits the rule, because it is the browser's own developer tools.
- Value is low. It is a generic picture of Chrome's network panel with throttling on. It shows nothing that is special to null3D, Chrome's own docs cover it, and it goes out of date when Chrome changes its look. "Any demo page" also names no view, so two people would take different pictures.

## Demo links

None proposed. None to check.

## Concepts said to have no demo (all confirmed)

I searched every demo under examples/ (sketches, page code and the shared runner) for each concept.
- fallback page: no demo has a poster or a no-scene fallback.
- load deadline: the demo runner shows a loading bar, but no deadline and no late state.
- reduced motion at rest: the runner only skips the loading overlay's fade under reduced motion. No sketch reads the motion preference or pauses for it.
- pausing off screen: no demo uses IntersectionObserver or setPaused.
- scroll-driven camera: demos use the wheel to fly or zoom the camera (cinematic camera, island). None maps the page's scroll position to the camera.
- assets.cache: no demo calls it.
- crash marker: no demo writes a start marker or reads crashedStarts.
