# porting-shaders-substance-09

## The finding as given

- page: porting/verification
- anchor: ## Compare the port with image tests, lines 78, 98, 101 ('"page": "/?view=hero-closeup"', 'shot --page /?view=hero-closeup')
- category: wrong-claim
- severity: medium
- claim: On a page address, ?view=<name> is the engine's debug-view switch. A camera view named normals, depth, shadows, wireframe, motion or levels draws a debug view, and the test compares the wrong picture. The page test also needs the page to pass the parameter to the sketch, which the page does not explain.
- evidence: packages/engine/src/page/switches.ts:503 (view: params.get('view')); docs/api/debug.md:134
- proposedEdit: Rename the parameter to ?camera= in the JSON, the sketch code and the shot command. Add: 'In a page test, the page reads camera from its own address and passes it on in the sketch's address.'

Verdict: partly

## Evidence

- The page address switch is real. `packages/engine/src/page/switches.ts:503` reads `view` from the page address. `packages/engine/src/page/engine.ts:3093` and `:3144` pass it on, and `packages/engine/src/sketch/runner.ts:978` calls `requestView` with it.
- `packages/engine/src/debug/draw.ts:207-229`: a name that is an engine view (lit, normals, depth, overdraw, wireframe, shadows, motion, levels) or an add-on view starts that view. Any other name sets the lit view and waits for an add-on to register it. So the page's own names, `overview` and `hero-closeup`, draw the normal picture. The wrong picture comes only when a camera view shares a name with a debug view. That is a real trap, but the page's examples do not fall into it today.
- Lines 98 and 101 put `?view=hero-closeup` on the page address, so the claim holds there.
- Line 78 and the sketch tests in the JSON (lines 84-85) do not hit the switch. `packages/cli/src/sketch-page.js:55-61` builds the test page address as `?sketch=/sketch.ts%3Fview%3Doverview&size=...`. The sketch's own query is encoded inside the `sketch` value, so the page has no top-level `view`. The same pattern is the documented one in docs/guides/testing.md:155 and :190.
- The forwarding gap holds. Step 1 (line 78) says the sketch reads the view from its module address, and docs/guides/testing.md:190 says the same. Line 98 gives a page test only a page address, and nothing on the page says that the page must read the name and put it in the sketch module's address.

## Corrected claim

In a page test and in `shot --page`, `?view=<name>` on the page address is also the engine's debug-view switch. A camera view named like a debug view (for example `shadows`, `depth` or `levels`) draws that debug view, and the test compares the wrong picture. Other names, such as the page's own examples, draw normally. Sketch tests are not affected, because the test page carries the sketch's query inside its `sketch` value. The page also does not say that a page test's page must pass the name on to the sketch's module address.

## Corrected edit

Use one name that the engine does not read, such as `camera`, in all the places, so the sketch reads the same name in both kinds of test: step 1's `searchParams.get('camera')`, both `sketch` values in the JSON, the `page` example and the `shot` command. In the sketch-test JSON the rename is for consistency only, not a fix. After the `page` example, add: "The engine reads `?view` on a page's address as a debug view, so give the camera another name. In a page test, the page reads `camera` from its own address and puts it in the sketch module's address." Severity medium stays, because a page test that follows the page today draws a blank sketch camera pose unless the reader works out the forwarding.
