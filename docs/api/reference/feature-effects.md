---
id: api/reference/feature-effects
title: "Add-on feature effects: API reference"
status: generated
since: "0.3"
summary: "Every export of the Add-on feature effects API, from the engine's doc comments."
---

# Add-on feature effects: API reference

> [Add-on feature effects](../feature-effects.md) explains these exports. The engine's doc comments make this page.

## `FeatureEffect`

Interface `FeatureEffect`.

A full-screen feature that `post.addFeatureEffect` placed: the effect while the feature draws, and its name, uniforms and removal.

| Member | Description |
| --- | --- |
| `readonly name: string` | The feature's name, from its description. |
| `readonly effect: Effect<Values> \| undefined` | The effect that runs, or undefined while the feature is not ready. A not-ready feature costs nothing: its pass, its target and its shaders wait until it is ready. |
| `readonly draws: boolean` | True while the feature's pass runs. |
| `setUniform<Name extends keyof Values & string>(name: Name, value: NonNullable<Values[Name]>): void` | Changes one uniform of the pass, as `post.setEffectUniform` does. A value that a not-ready feature takes applies when the feature next draws. It allocates nothing. |
| `refresh(): boolean` | Asks the feature's `ready` again, adds or removes its effect, and returns whether it draws now. The adapter calls it when the engine's quality changes; call it after a change that the sketch makes, such as a switch of its own. |
| `destroy(): void` | Removes the pass and stops watching the quality. It calls the description's `destroy` once. |

## `FeatureEffectOptions`

Interface `FeatureEffectOptions`, which extends `Omit`.

Options of `post.addFeatureEffect` besides the feature description: the pass's WGSL, its first uniform values and its textures, as `post.addEffect` takes them. The description gives the place where the pass runs, so the options take no order.
