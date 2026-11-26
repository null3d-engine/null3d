# Verdict: porting-shaders-substance-20

## Finding as given

- page: shaders/wgsl-rules
- anchor: stats lines 46, 48, 58 (array copies, struct half precision, atomic compare-exchange)
- category: long-paragraph
- severity: medium
- claim: The rule (what the build rejects and what to write) is buried under why phone GPUs fail and how the build splits structs.
- evidence: stats.json; docs/shaders/wgsl-rules.md:53,55,65
- proposedEdit: Keep one sentence per rule, such as 'The build rejects a copy of a whole array out of a uniform buffer. Read one element at a time.' and 'Keep values in an array of structs within half precision's range, about 6.1e-5 to 65504.' Move the reasons and the struct splitting into <details><summary>Technical details: why phone GPUs need these rules</summary>.

Verdict: partly

## Evidence

The stats lines 46, 48 and 58 are page lines 53, 55 and 65, because stats skip the front matter. The counts hold: 68 words and 5 sentences, 115 words and 7 sentences, 73 words and 6 sentences.

- Line 53 (array copies). The rule is not buried. The first sentence is the rule: "The build also rejects a copy of an array out of a uniform buffer." The second sentence says what counts as a copy: a whole array, or a struct that holds one, read into a `let` or passed to a function. That is part of the rule, not a reason. If it moved into a block, readers would not know which code fails. Only one sentence is a reason ("Some phone GPUs leave such a copy's arrays empty on WebGL2"). The paragraph is 68 words and is short enough to keep.
- Line 55 (struct half precision). The finding holds here. The paragraph opens with the GPU cause. Four sentences then say what the build does on its own: it splits struct parameters, results, variables, pointers, and `modf` and `frexp` results. The reader does not have to act on any of that. The one thing a reader must do (keep values in an array of structs within about 6.1e-5 to 65504) comes in sentence 6 of 7. This is a good case for a block.
- Line 65 (atomic compare-exchange). The rule is not buried. The first sentence says the build warns. The second says the user-facing risk: on Safari 27.0 the shader fails on every Apple device. That must stay in the main text. The problem is not about phone GPUs, so the proposed block title is wrong for this paragraph. Only the WebKit change ID "321006@main" is detail an implementer might want. It could go in a small block, but that is low-value polish.
- The proposed one-sentence rule for line 53 drops the "struct that holds an array" case. That case is the less obvious one, so the edit would make the main text say less than the build checks.

## Corrected claim

Only the struct paragraph (line 55) buries its rule. It opens with the GPU cause and four sentences on automatic struct splitting. The one action a reader must take is in sentence 6 of 7. The array-copy paragraph (line 53) and the compare-exchange paragraph (line 65) already lead with the rule. The array-copy paragraph's second sentence defines the rule and must stay in the main text. Severity: low to medium.

## Corrected edit

Line 55: put the action and the failure first, and move the splitting detail into a block:

> On WebGL2, some phone GPUs store values in a GLSL struct at half precision. The build works around this for most structs. An array of structs stays whole, so keep the values in such an array within half precision's range, from about 6.1e-5 to 65504. When the build cannot work around a struct, it fails and names the function.
>
> <details>
> <summary>Technical details: how the build splits structs for WebGL2</summary>
>
> For WebGL2, the build splits each struct value into its members. This covers struct parameters, results and variables, and `private` struct variables with their initial values. A function can take a pointer to a whole struct variable in the `function` or `private` address space: the build then passes a pointer to each member. The build splits the results of `modf` and `frexp` too.
>
> </details>

Line 53: no change needed. If the page needs to be shorter, cut only the reason sentence. Keep the definition of a copy and "struct that holds one".

Line 65: keep it as it is. Optionally, move "WebKit has fixed the fault (321006@main)" into a block titled "Technical details: the WebKit fix". Do not use a "phone GPUs" title for this paragraph.
