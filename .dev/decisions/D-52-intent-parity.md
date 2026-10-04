# D-52: Intent parity and the three-compat add-on

Status: decided by the owner on 2026-10-04. Date: 2026-10-04. Task: M2-N1.

## Question

What does "parity with three.js" mean for null3D? Must a port look the same as its three.js original, pixel for pixel? Or must it only show what the files and the author meant, with each look drawn by the best technique?

## Rule

The owner decides. A choice must keep the porting promise: a three.js scene ports with little work and shows what its author meant. It must not cost quality, download size or complexity for every user of the engine.

## Data

The technique reviews of 4 October 2026 looked at each area of the engine. They found that earlier choices treated parity with three.js as a goal in itself. Two examples:

| Example | Choice with parity as a goal | What it cost |
| --- | --- | --- |
| Bloom ([D-21](D-21-effect-chain.md)) | Run `UnrealBloomPass`'s steps, kernels and weights, so a port's numbers keep their look | The chain of half-size steps down and back up reads about 8.3 texels per pixel, against 10.8. It also flickers less on small bright points |
| Levels of detail | A three.js mode that switches levels at camera distances, beside the engine's own rule | A second code path and its tests. The porting skill can map three.js's switch distances onto the engine's pixel-error rule instead |

The same reviews found areas where parity is the point. A glTF file, a material's parameters, a color space, a unit and an animation curve each have one meaning. The glTF specification defines most of them, and three.js is a good reference for the rest. A difference there is a bug.

A built-in asset shipped as a file has a cost too. The built-in room environment was a file in the engine's package: 2.0 MB, 331 KB after Brotli ([D-19](D-19-environment-maps.md)). A bundler copies such a file into each game's build, also when the game never uses it.

## Decision

The owner's decision of 4 October 2026, in five parts.

1. Intent parity stays strict. null3D shows what files and authors mean. That covers glTF, materials, color spaces, units, and animation curves and sampling. Tests check them against the glTF specification, with three.js as the reference.
2. Look parity becomes "equivalent or better". Each feature uses the best technique as its default. The porting skill and the port tools rewrite three.js code onto null3D's techniques. They map its settings, for example LOD switch distances to the pixel-error rule. They also list the visible differences for the user.
3. The core engine has no three.js-look modes. A port may truly need one, where no setting can come close. That mode goes in the opt-in `three-compat` add-on module.
4. Benchmarks compare equal work: the same scene content and comparable quality settings. Reports give quality notes beside the timings. The two engines' images need not be identical.
5. Pixel comparisons with three.js cover only the shared building blocks: lighting terms, tone curves once chosen, skinning poses, animation sampling and glTF interpretation. A feature with an improved technique gets null3D's own references, and a looser sanity comparison with three.js.

### Intent and look

| Kind | Examples | Default | Tests against three.js |
| --- | --- | --- | --- |
| Intent: what a file or an author means | glTF interpretation, material parameters and lighting terms, color spaces, units, animation curves and sampling, skinning poses | The meaning that the glTF specification gives, with three.js as the reference | Strict: three.js's image rule, or the numeric limits of the record that settled the feature |
| Look: how a technique draws an effect | Bloom, levels of detail, the vignette, other post effects | The best technique that the engine knows | null3D's own references. A looser sanity comparison with three.js shows that the effect is in the same place and of the same size |

A tone curve is a choice of look. When the engine offers a curve that three.js also has, the curve is a shared building block. Its pixels then compare with three.js's rule.

### The three-compat add-on

- It holds only the three.js looks that a port truly needs, where no setting of the core comes close. Each candidate needs a decision of its own. The candidates so far: `UnrealBloomPass`'s halo, the ACES and Reinhard tone curves, and three.js's vignette. [D-36](D-36-outlines.md) adds `OutlinePass`'s glow, pulse and blurred edge.
- It is built only on the engine's public extension points: custom effects, custom passes and material hooks. So it also tests those points, as a user's own code would use them.
- It loads on first use, and it follows the rules for add-on modules below.
- The porting skill adds it only when a port needs one of its looks, and says why.

### Built-in assets

The owner's rule of 4 October 2026: built-in assets are made at run time, never shipped as files in the engine's package. The first example is the built-in room environment. A built-in asset's code and shaders load on first use.

### Add-on modules

The owner's rule of 4 October 2026: heavy or niche features ship as add-on modules. Gaussian splats, physics, particles and MSDF text are examples. An add-on module:

- takes one install and one import, with no manual file copying;
- works with the Vite plugin, with plain bundlers and from CDNs, under a strict Content Security Policy;
- keeps its version in step with the engine's;
- loads its code, its WebAssembly and its shaders on first use, within the budgets for such files ([D-14](D-14-js-budget.md)).

## Options rejected

- Strict parity of look everywhere. Each feature would copy three.js's technique, also where a better one is cheaper or draws a cleaner image. Users who never port would pay for it.
- Three.js-look modes in the core, beside each better default. Each mode adds code to every page that loads the feature, a second path to test, and a second way to do one task.
- No parity checks against three.js at all. Ports would lose the check that catches a misread file or a wrong unit.

## Consequences

- AGENTS.md states the five parts and the two rules, under "Parity with three.js and add-on modules".
- Four records get a dated note that points here. [D-06](D-06-success-targets.md): the targets compare equal work. [D-19](D-19-environment-maps.md): the lookup's table and the built-in room. [D-21](D-21-effect-chain.md): bloom's method is open again. [D-33](D-33-color-grading.md): the vignette. The guides [image tests](../image-tests.md#parity-with-threejs), [benchmarks](../benchmarks.md) and [releases](../releases.md#the-items-and-how-they-are-measured) note which comparisons are strict.
- The parity list in `bench/lib/parity.ts` marks each scene as a shared building block or an improved technique. A scene moves to its own references and a looser sanity limit when its feature changes technique.
- Benchmark reports add a quality note beside each comparison whose two images differ by design.
- Public docs describe what exists now, so they change with each feature. A page that says a feature matches three.js changes when the feature moves to a better technique.
- Follow-up work, after the combined technique analysis:
  - The porting skill, the port tools and the three.js mapping rewrite three.js code onto null3D's techniques, map its settings, and list the visible differences. Their content stays as it is until then.
  - Bloom's method, the vignette, the tone curves and the levels of detail get their defaults by the rule of part 2.
  - The `three-compat` add-on module, once a port needs one of its looks and the public extension points that it uses exist.
