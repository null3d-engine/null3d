# Verdicts: errors/E1431 (shots and demo links)

## Shot: area-lights-default (reference) — KEEP

- The file exists: tests/image/references/chrome-real-gpu/webgpu/demo-area-lights.png (compat and webgl2 copies exist too). It shows the demo's default view: the wet street, the warm and cold shop windows, the far strip light, the neon sign and the green loose tube.
- It helps only as the "before" half of the pair. On its own, a picture of working lights says little on an error page.
- Fix the "shows" text. The neon sign is not made of tube lights. Its glowing tubes are emissive capsule meshes, and its light is one rectangle light that carries a picture of the tubes. The only tube light is the loose green tube that floats down the street. The alt text ("lit by rectangle and tube lights") is correct.

## Shot: area-lights-no-tables (scripted) — KEEP, with corrected steps and alt text

- The steps cannot work as written. In hold mode, the held frame first waits for the tables download to settle (sketch runner, areaTablesSettled). Then the frame loop takes the failure and reports it. The runner's report throws in hold mode ("hold mode stops at the first one"). So the hold stops with E1431 and gives no held frame to capture.
- A live run works. Out of hold mode, the runner only logs the error to the console and carries on, and the demo page shows no error overlay for a sketch error. The area lights then give no light.
- Corrected steps: install a context-level route (context.route, so that a fetch from the engine's worker is caught too) that aborts every request whose URL contains "area-light-tables". Open the area-lights demo on the webgpu tier without ?hold. Wait for the first frame, then about 2 s, so the time matches the reference's 2 s hold. Do not move the pointer, so the camera keeps its default pose. Check that the console shows E1431, then capture the canvas. The loose tube moves with time, so its place can differ a little from the reference.
- Fix the alt text and "shows". The window panes, the strip panel, the neon capsules and the loose tube's capsule are emissive meshes. They still glow, and screen-space reflections still mirror them in the wet road. What goes away is the light that they cast on the walls and the road. Suggested alt: "The same street: the windows and the neon still glow, but they cast no light on the walls or the wet road, because the tables file did not download."
- This pair helps the reader. It shows the symptom of this error (glowing shapes that light nothing), which is what a developer sees before they open the console.

## Demo link: area-lights/ — KEEP

- The code exists in examples/demos.ts (name area-lights, code 'area-lights/'). The sketch makes four rectangle lights (two windows, the far strip, the sign) and one tube light, so it shows "rectangle and tube area lights". It also shows that the engine downloads the tables with the first area light, which is the download that this error is about.

## Concept without demo: serving the tables file from another origin — CONFIRMED

- No demo or comparison serves engine files from another origin or sets CORS or Content-Security-Policy headers. A search of examples/ for Access-Control, cross-origin, connect-src and Content-Security-Policy finds nothing. tests/image/content-security-policy.spec.ts is a test, not a demo, and it does not touch area lights.
