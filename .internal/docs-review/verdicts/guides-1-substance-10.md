# guides-1-substance-10

## Finding as given

- page: guides/custom-shaders, guides/custom-passes
- anchor: custom-shaders 'Custom materials' (line 43) and example `material.width` (line 244); custom-passes 'Uniforms' (line 87)
- category: term-before-definition
- severity: medium
- claim: A material reads its uniforms as material.<name>; an effect reads them as uniforms.<name>. custom-shaders never states the material form, and its example uses material.width unexplained. custom-passes says 'read them as uniforms.name. The rules are those of custom materials', implying materials use uniforms. too.
- evidence: docs/guides/custom-shaders.md:43, 244; docs/shaders/surface-functions.md:226-227; docs/guides/custom-passes.md:87.
- proposedEdit: custom-shaders line 43: "The WGSL can declare uniforms as struct Uniforms, and reads each as material.<name>." custom-passes line 87: "... read them as uniforms.name. (A material reads its own as material.name.) The other rules are those of custom materials."

Verdict: partly

## Evidence

- The two access forms are real. docs/shaders/surface-functions.md:213 says a material reads its uniforms "from `material`", and its examples use `material.count` (226-227). The effect TSDoc in packages/engine/src/scene/effects.ts:51 says an effect reads the fields "from `uniforms`", and docs/guides/custom-passes.md:87 says `uniforms.name`.
- custom-shaders.md:43 names `struct Uniforms` and `set()`, but not how the WGSL reads a field. The first example (lines 27-41) has no uniforms. The typed uniforms example (lines 241-246) uses `material.width`, `material.offset` and `material.tint` with no word on `material`. A grep of the page finds no other mention. That part holds.
- Weakening points:
  - custom-shaders.md:43 links to Surface functions for "uniforms", and that page states the `material` form at line 213. Line 43 also links to Built-in shader inputs, and surface-functions.md:590 lists `material` as a built-in value. So the fact is one link away, not missing from the docs.
  - custom-passes.md:87 states the effect form plainly in the same sentence. "The rules are those of custom materials" introduces a list of type, color, start value, typing and allocation rules (88-92), none of which is about the access name. A reader is unlikely to infer that materials also use `uniforms.`. The risk is the reverse: a reader who knows materials could not tell that the name differs. The added note fixes that.
- Severity: low, not medium. The page does not mislead: the example code is correct and the linked page explains it.
- The proposed edit for line 43 drops the existing clause "which `set()` changes at any time", and it has a grammar fault ("The WGSL can declare ... and reads").

## Corrected claim

custom-shaders never says that a material's WGSL reads its uniforms from `material`, and its typed uniforms example uses `material.width` with no explanation. Surface functions, which line 43 links to, does say it. custom-passes says effects read `uniforms.name` but does not say that this differs from materials. Severity low.

## Corrected edit

- custom-shaders.md:43: "The WGSL can declare uniforms as `struct Uniforms` and read each field as `material.name`, and `set()` changes them at any time."
- custom-passes.md:87: "Declare uniforms as `struct Uniforms`, and read them as `uniforms.name`. A custom material reads its own as `material.name`, but the other rules are the same:"
