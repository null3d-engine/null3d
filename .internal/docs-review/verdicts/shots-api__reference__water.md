# Verdicts: shots and demo links for api/reference/water

Page is generated. Any link added here must go in the TSDoc comment of the export (packages/water/src, tag @category api/water), or in the reference page code in tools/gen-docs.ts and tools/lib/docs.ts. The page has no demo links today.

## Shots

None proposed. Nothing to check.

## Demo links

1. createWater and foamMap -> `water/` (at `## createWater`). KEEP.
   The code exists in examples/demos.ts (demo "water"). Its sketch (examples/water/sketch.ts) imports createWater, foamMap and createUnderwater, calls createWater with a foam map made by foamMap around the stones, and builds a river that runs into a lake. It shows both exports directly.

2. createOcean -> `ocean/` (at `## createOcean`). KEEP.
   The code exists in examples/demos.ts (demo "ocean"). Its sketch (examples/ocean/sketch.ts) calls createOcean with the camera and nothing else of note. It is the smallest real use of the export.

3. createWaterfall and createUnderwater -> `showcase/creek/` (at `## createWaterfall`). KEEP, with one note.
   The code exists in examples/demos.ts (demo "creek"). Its sketch calls createWaterfall once for each lip of the creek and createUnderwater for its water, and its camera route sinks under the creek surface. It is the only demo that uses createWaterfall.
   Note: the creek sketch is large (a full showcase scene), and it skips the water and the falls when the page address asks it to leave the water out. For createUnderwater alone, `water/` is the plainer example: its sketch calls createUnderwater next to createWater, and its camera tour dips under the lake. If a link goes at `## createUnderwater`, point it at `water/`.

## Concepts said to have no demo

- waveHeight used by a sketch. CONFIRMED.
  No sketch in examples/ calls waveHeight. Only a test file uses it (examples/showcase/creek/route.test.ts, which checks that the camera route stays clear of the creek surface). A test file is not a demo, so no demo link fits. The island showcase reads the sea height through the ocean object's own height method, not through waveHeight.
