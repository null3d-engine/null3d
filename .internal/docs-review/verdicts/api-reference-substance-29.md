# api-reference-substance-29

Finding as given:

- page: api/reference/feature-effects
- anchor: feature-effects.md:25 `refresh`
- category: term-before-definition
- severity: low
- claim: "'The adapter calls it when the engine's quality changes.' The reader does not know the adapter is the engine, yet the sentence decides when the add-on must call refresh itself."
- evidence: feature-effects.md:25; api/features.md:278 defines the full-screen adapter.
- proposedEdit: "'The engine calls it when its quality changes. Call it yourself after a change that the sketch makes, such as a switch of its own.'"
- generatedSource: packages/engine/src/scene/feature-effects.ts

Verdict: partly

Evidence:

- The reference page, line 25, does say "The adapter calls it when the engine's quality changes". Nothing on the reference page itself defines "adapter". That part holds.
- The page's first line (line 11) links the explainer, docs/api/feature-effects.md. Its line 24 says "This is the adapter for a feature description", and its line 106 says "The adapter asks `ready` when the feature is added, and again whenever the engine's quality changes". docs/api/features.md:278-280 also defines adapters. So the term is defined one click away, on the page that the reference page tells readers to read first.
- The claim that the undefined term "decides when the add-on must call refresh itself" is overstated. The second half of the same sentence says when to call it: "call it after a change that the sketch makes". A reader can act on that without knowing what the adapter is.
- The behavior claim in the edit is correct. packages/engine/src/scene/feature-effects.ts:164 registers `host.watch(() => this.refresh())` inside the engine's own handle class, so the engine does call `refresh` on each quality change. "The engine calls it" is accurate and needs no term.
- The source to edit is the TSDoc at packages/engine/src/scene/feature-effects.ts:56-59. The proposed edit must keep the first sentence ("Asks the feature's `ready` again, ...").

Corrected claim: The reference entry uses "the adapter" without a definition on the page. The linked explainer defines it, and the sentence still says when to call `refresh` yourself, so the cost is small polish. Replacing the term with "the engine" is accurate and removes the need to look it up.

Corrected edit (TSDoc at packages/engine/src/scene/feature-effects.ts:56-59):

"Asks the feature's `ready` again, adds or removes its effect, and returns whether it draws now. The engine calls it when its quality changes. Call it yourself after the sketch changes its own state, such as a switch of its own."
