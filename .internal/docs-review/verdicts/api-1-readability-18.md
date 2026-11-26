# api-1-readability-18

## Finding as given

- page: api/features
- anchor: ## The fields (lines 81-89); ## Callbacks (lines 267-271 and 275-280)
- category: duplication
- severity: medium
- claim: The callbacks are described three times, and the versions disagree. The fields table says destroy is 'Called once when the feature is removed or the engine stops'. The Callbacks list says 'The registry does not call it'.
- evidence: features.md:89 against :271 and :280.
- proposedEdit: Keep one table in 'Callbacks': Callback | What it gets | Who calls it, and when. In the fields table, make each callback row read 'A callback: see [Callbacks](#callbacks)'. Make the destroy text match line 280.
- generatedSource: (empty)

## Verdict: partly

The finding holds, but it is incomplete. The contradiction is wider than destroy, and the wrong text also has a source in code.

## Evidence

- docs/api/features.md:81-89 (fields table), :267-271 (bullet list) and :275-280 (who-calls table) describe the same five callbacks three times. Confirmed.
- destroy: :89 says "Called once when the feature is removed or the engine stops". :271 says "The registry does not call it". :280 says the full-screen handle calls it, otherwise the owner. Confirmed contradiction.
- The code agrees with :271 and :280. packages/engine/src/scene/features.ts:1109-1112: the registry's remove "does not call the feature's `destroy`". packages/engine/src/scene/feature-host.ts:115: "It does not call the feature's `destroy`". packages/engine/src/scene/feature-effects.ts:200-205: the full-screen handle calls `description.destroy?.()`.
- resize and reset contradict too, which the finding misses. :87 says resize is "Called with the render size in device pixels when it changes". :88 says reset is "Called with ... when the feature must drop its history". :279 says "Nothing in the engine" calls them. A search of packages/*/src for `.resize?.(` and `.reset?.(` finds no caller, so :279 is right and :87-88 mislead.
- ready: :81 says "Called when the engine needs to know whether the feature draws". :278 shows only the full-screen and instance adapters ask it; the draw, compute and sky-layer adapters do not. :81 is vague rather than wrong, but it hides that limit.
- The wrong text is not only hand-written. The TSDoc in packages/engine/src/scene/features.ts:389-393 says the same thing for resize, reset and destroy, and it generates docs/api/reference/features.md:135-137. The page api/features itself is hand-written, so the empty generatedSource is right for it, but the TSDoc must change too or the reference page keeps the error.

## Corrected claim

The callbacks are described three times on api/features (:81-89, :267-271, :275-280), and the fields table disagrees with the code for three of them. It says destroy runs when the feature is removed or the engine stops, and that resize and reset are called on a size change or history drop. In fact the registry and the feature host never call destroy (only the full-screen handle does), and nothing in the engine calls resize or reset. The same wrong text is in the TSDoc at packages/engine/src/scene/features.ts:389-393, which feeds docs/api/reference/features.md:135-137. Severity should be high: a reader who trusts the fields table will leak objects and never see a resize.

## Corrected edit

1. docs/api/features.md: merge the bullet list (:267-271) and the who-calls table (:273-280) into one table under Callbacks: Callback | What it gets | Who calls it, and when. Take the "who calls" text from :278-280, which matches the code.
2. In the fields table (:81, :86-89), give each callback row a short neutral line plus a link, for example "A callback that frees the feature's own objects. See [Callbacks](#callbacks)." Do not say when the engine calls it.
3. packages/engine/src/scene/features.ts:389-393: rewrite the TSDoc for resize, reset and destroy so it says what each callback is for and that the engine does not call it on its own (destroy: the full-screen handle calls it; otherwise the owner calls it). Then docs/api/reference/features.md:135-137 regenerates correctly.
