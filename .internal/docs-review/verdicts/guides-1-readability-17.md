# guides-1-readability-17

## Finding as given

- page: guides/custom-shaders
- anchor: ## WGSL in sketch code (line 98)
- category: scan-order
- severity: medium
- claim: The first examples (lines 30, 51) use the /* wgsl */ tag and #import, but the tag's rules (no ${...}, no backquotes in comments, each literal compiles alone) come only at line 98, after Full shaders. A newcomer who writes ${value} fails before reaching the rule.
- evidence: line 30 'const rings = /* wgsl */ `'; line 132 'The literal cannot hold `${...}`.'
- proposedEdit: Move '## WGSL in sketch code' to right after the intro. Order: WGSL in sketch code, Custom materials, Full shaders, What the plugin compiles, Shader errors, Hot reload, TypeScript.

Verdict: partly

## Evidence

- The order is as claimed. The page uses tagged literals at lines 30 and 51 (line 52 also uses `#import`). The section that explains the tag starts at line 98, and its rules are at lines 131-135.
- The intro already names both forms. The diagram (lines 13-20) shows "A .wgsl file that a module imports" and "A template literal tagged as WGSL", and line 22 says the plugin compiles the WGSL in your code. The intro gives no link to the rules.
- The claim that a newcomer "fails before reaching the rule" overstates the cost for `${...}`. The plugin refuses a substitution at its exact place, with a message that states the rule and the fix: packages/vite-plugin/src/wgsl.ts:34-36 ("a template literal that a `/* wgsl */` comment tags cannot hold `${...}` ... so write the value in the WGSL itself"), and wgsl.ts:576-577 reports it with problemAt. The tests at wgsl.test.ts:108-112 and 161-164 check the place. So the error itself teaches the rule. A backquote in a WGSL comment gives a less clear JavaScript syntax error, so that rule still benefits from an early pointer.
- The proposed move adds new scan-order problems:
  - The section's example (lines 113-126) is a whole shader with `@vertex`/`@fragment` entry points that draws a full-screen triangle. As the first example, it would show a newcomer the least common kind of WGSL before the custom material, which is the main task of the page. The kinds of WGSL are explained only later, at "What the plugin compiles".
  - Line 129 says TypeScript reads the uniforms from the string. Uniforms are first introduced at line 43, in Custom materials. Moved first, the section would refer to a term the reader has not yet seen.
  - Line 133 tells the reader that `#import` reaches only the shader library. This means more after the reader has seen the `#import` lines in the full shader example.
- The current order (task first: custom materials, then full shaders, then the mechanics of the tag) is a reasonable choice. Moving the whole section is a matter of taste. A one-line pointer fixes the real gap at lower cost.

## Corrected claim

The tag's rules come after the first two tagged examples, and the intro does not point to them. The cost is low for `${...}`, because the plugin's error names the rule and the fix at the exact place. The cost is higher for a backquote in a WGSL comment, which gives a plain syntax error. Severity: low, not medium.

## Corrected edit

Keep the section order. At the end of the intro paragraph (line 22), add one sentence:

"The examples on this page tag WGSL with a `/* wgsl */` comment. [WGSL in sketch code](#wgsl-in-sketch-code) gives the two forms and the rules of the tag."
