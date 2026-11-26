# Verdict for api-1-substance-28

## Finding as given

- page: api/debug
- anchor: ## Stats overlay and frame figures, lines 188-195
- category: unclear
- severity: low
- claim: 'Four calls show the overlay', but one of the four is the ?stats address switch. 'Each call also takes options in place of true' does not apply to the switch.
- evidence: docs/api/debug.md:188-195.
- proposedEdit: 'Four ways show the overlay:' and 'Each call takes options in place of true; the switch takes collapsed and open instead.'
- generatedSource: (none; the page is hand-written)

Verdict: survives

## Evidence

- docs/api/debug.md:188 ends with "Four calls show the overlay:". The list at lines 190-193 has three function calls and one address switch (`?stats`).
- docs/api/debug.md:195 says "Each call also takes options in place of `true`:". Read literally, "each call" includes the switch, which takes no options object.
- The three calls do take an options object: `stats(show?: boolean | StatsOverlayOptions)` in packages/engine/src/page/engine.ts:814 and packages/engine/src/debug/debug.ts:88; `createEngine({ stats: { collapsed: true } })` is the page's own example.
- The switch takes only text values. packages/engine/src/page/switches.ts:415-418 maps `collapsed` and `open` to `{ collapsed: true|false }`, `off` to hide, and a bare switch or `on` to show. So the switch reaches the same option, but not "in place of true".
- Nothing else on the page fixes the wording. The cost to a reader is small, so low severity is right.

## Corrected edit

The claim holds. The second half of the proposed edit repeats what the switch bullet (line 192) already says about `?stats=collapsed` and `?stats=open`. A shorter edit is enough:

- Line 188: "Four ways show the overlay:"
- Line 195: "The three calls also take options in place of `true`:"
