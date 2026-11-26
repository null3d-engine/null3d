# Shot and demo-link verdicts: api/reference/three-compat

Proposal: no shots, no demo links, three concepts with no demo.

## Shots

None proposed. Nothing to disprove.

Note: test reference images exist for all three concepts, under
tests/image/references/chrome-real-gpu/webgpu/:
- outline-compat-glow.png and outline-compat-pulse.png (outline test sketch with `?compat=glow` / `?compat=pulse`, manifest.ts outline tests). These show the compat outline pass.
- tone-cineon.png, tone-reinhard.png and their -half-exposure variants (made by tests/image/tone-mapping.spec.ts).
They are test scenes, not demos. This is a generated API reference page, so a picture is optional; if one is wanted, these are the valid reference sources.

## Demo links

None proposed. Nothing to disprove.

## Concepts without a demo

All three confirmed. I searched every file under examples/ (demos and comparisons) for the names and for imports of the three-compat package.

- createOutlinePass: confirmed, no demo. gizmos, picking and post-effects call setOutlined(true), but they use the core crisp outline (post.set({ outline })), not the three.js-style soft outline pass. No demo imports the three-compat package.
- cineon: confirmed, no demo. The tone-mapped demo uses 'agx-punchy'; the comparisons use 'agx'.
- reinhard: confirmed, no demo. Same search as cineon.
