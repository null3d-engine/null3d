# porting-shaders-readability-19

## Finding as given

- Page: shaders/wgsl-rules
- Anchor: Lines 53, 55, 65 (stats lines 46, 48, 58)
- Category: technical-details-block. Severity: medium.
- Claim: Line 55 (115 words, 7 sentences) explains how the build splits GLSL structs for phone GPUs, while the reader needs only the half-precision range rule. Line 53 (68 words) explains array copies before the rule. Line 65 (73 words) holds a WebKit commit ID, "321006@main", and a release status.
- Proposed edit: Line 53: lead with "Read a uniform array one element at a time." and give the reason in one sentence. Line 55: keep the range rule (6.1e-5 to 65504) and that the build names the function when it cannot split a struct; move the splitting of parameters, pointers, modf and frexp into a technical details block, "Technical details: how the build splits structs for WebGL2". Line 65: keep the warning and the Safari 27.0 failure; move the WebKit fix ID into a technical details block or delete it.

Verdict: partly

## Evidence

- The page text matches the finding. docs/shaders/wgsl-rules.md:53 (array copy rule), :55 (struct split), :65 (atomic compare-exchange with "321006@main" and "no Safari release that has the fix is out yet"). stats.json gives 68 words/5 sentences, 115/7 and 73/6.
- The behavior the page states is true. crates/null3d-shaders/src/flatten.rs:20, :117, :661 split modf and frexp results member by member; flatten.rs:468 refuses a shape it cannot split and names the function. So moving the detail is safe, and the detail is correct.
- Line 55: the claim that the reader "needs only the range rule" goes too far. The sentence "An array of structs stays whole" makes sense only after the reader knows that the build splits other struct values. The main text must keep the first two sentences (phone GPUs keep struct values at half precision; the build splits struct values into members for WebGL2). Only the list of covered cases (parameters, results, variables, private initial values, pointers to whole struct variables, modf and frexp) belongs in the block.
- Line 53: the proposal to keep only the instruction plus one reason sentence risks dropping the definition of a copy ("an array, or a struct that holds one, read whole into a `let` or passed to a function"). That definition tells the reader what the build rejects. It must stay in the main text. The paragraph is 68 words; the cost is low. A reorder is optional polish, not a block.
- Line 65: deleting the WebKit ID is wrong. The build's own warning prints it: crates/null3d-shaders/src/features.rs:438 ("WebKit fixed this in 321006@main, which no Safari release holds yet ... See {RULES_PAGE}"), checked by crates/null3d-shaders/tests/build.rs:640 and packages/vite-plugin/src/wgsl.test.ts:574. A reader who follows the warning's link to this page should find the same ID. Moving it into a block is fine; deleting it is not.

## Corrected claim

Lines 55 and 65 hold correct detail that a technical details block can carry. Line 55's main text must still say that the build splits struct values into members, or the array-of-structs range rule loses its reason. Line 53 is a short rule with a needed definition; it needs no block. The WebKit ID on line 65 matches the build's warning and must not be deleted.

## Corrected edit

- Line 55, main text: "Some phone GPUs store each value in a GLSL struct at half precision on WebGL2. So for WebGL2, the build splits each struct value into its members. An array of structs stays whole, so keep the values in such an array within half precision's range, from about 6.1e-5 to 65504. When the build cannot split a struct, it fails and names the function."
  Then:
  <details>
  <summary>Technical details: how the build splits structs for WebGL2</summary>

  The split covers struct parameters, results and variables, and `private` struct variables with their initial values. A function can take a pointer to a whole struct variable in the `function` or `private` address space: the build then passes a pointer to each member. The build splits the results of `modf` and `frexp` too.

  </details>
- Line 65, main text: keep the warning, the Safari 27.0 failure, "Other browsers run it", and the last two sentences. Move "WebKit has fixed the fault (321006@main), but no Safari release that has the fix is out yet." into a block, "Technical details: the WebKit fix", and keep the ID. Do not delete it.
- Line 53: leave as is, or reorder so the instruction comes second after the rejection; keep the sentence that defines a copy.
