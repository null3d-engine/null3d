# Verdict for api-2-substance-29

## Finding as given

- id: api-2-substance-29 (slice api-2, role substance)
- page: api/objects
- anchor: ## Visibility, kind and removal, line 99
- category: unclear
- severity: low
- claim: "'A model's copy also keeps find and setOutlined ... So does a call that gets a destroyed object, such as setParent.' 'So does' seems to mean that passing a destroyed object also throws E1101, but it reads as 'also keeps working'."
- evidence: docs/api/objects.md:99.
- proposedEdit: "'In development builds, every call on a destroyed object throws E1101, except describe and off. A model's copy also allows find and setOutlined, which skip its destroyed parts. Passing a destroyed object to a call, such as setParent, throws E1101 too. Once the frame removes the object, its world getters throw E1101 in every build. In a release build, other calls do nothing.' Link E1101."
- generatedSource: none (the page is hand-written)

Verdict: survives

## Evidence

- docs/api/objects.md:99 says the text as quoted. "So does" comes right after "A model's copy also keeps `find` and `setOutlined`". The nearest verb that "so does" can repeat is "keeps", so a reader takes it to mean that a call which gets a destroyed object keeps working. That is the wrong meaning.
- The code does the opposite. packages/engine/src/scene/scene.ts:1357-1361: in development builds, `setParent` calls `checkLive('setParent', parent, true)` on its argument. packages/engine/src/errors/checks.ts:44-50: `checkLive` throws E1101 with "got <object>, which was destroyed" when the argument flag is set. Other calls check their arguments the same way (scene.ts:504, 2403, 4353, 4430, 4504; render.ts:1181; sketch/ui.ts:168). So the intended meaning is "throws E1101 too", as the finding says.
- The page links other error codes to their pages (docs/api/objects.md:137 links E1205), so "Link E1101" follows the page's own style.

## Problem with the proposed edit

The proposed text cuts the end of the last sentence: "and never reach the object that takes its slot ([Handles](../concepts/handles.md#stale-handles))". That clause is correct, useful to implementers, and holds the only link to the stale-handles section. Keep it.

## Corrected edit

In development builds, every call on a destroyed object throws [E1101](../errors/E1101.md), except `describe` and `off`. A model's copy also allows `find` and `setOutlined`, which skip its destroyed parts. A call that gets a destroyed object as an argument, such as `setParent`, also throws E1101. Once the frame has removed the object, its world getters throw E1101 in every build. In a release build, the other calls on a destroyed object change nothing, and never reach the object that takes its slot ([Handles](../concepts/handles.md#stale-handles)).
