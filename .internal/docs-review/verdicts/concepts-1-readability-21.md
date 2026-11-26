# concepts-1-readability-21

## Finding as given

- page: concepts/instances
- anchor: ## Automatic batching, lines 184 and 194
- category: wall-of-text
- severity: medium
- claim: Line 194 (133 words) lists about 15 calls that rebuild the draw tables and 8 that do not, all inside sentences. Line 184 lists the group-split cases in prose. A reader cannot check one call quickly.
- evidence: instances.md:184, 194
- proposedEdit: 194: a two-column table. 'Rebuilds the draw tables': create or destroy a batch or object (lights too), setMaterial, setMesh, setParent, setDynamic, setBounds, setFrustumCulled, setCastShadows, setReceiveShadows, texture.destroy(), texture.update() at a new size, shadows on or off, a new debug view. 'Never rebuilds': transform setters, row writes, setVisible, setLayers, setActiveCount, setRenderOrder, other light and camera setters, material.set. Keep the advice sentence after it. 184: keep 3 sentences and make the split cases a bullet list.

Verdict: partly

## Evidence

- The page text matches the claim. In the generated copy, docs/concepts/instances.md line 184 starts "The engine groups what it draws by mesh and material" and gives four split cases in prose (own bounds on WebGPU, never-culled objects, shadow-receiving pipelines, WebGL2 dynamic and static rows), then the blended case. Line 194 starts "Some calls change the scene's structure" and holds the two call lists in running sentences.
- stats.json gives these paragraphs as 151 words / 10 sentences and 133 words / 8 sentences. Its line numbers (177, 187) are 7 lower than the generated copy's (184, 194); the finding's line numbers match the generated copy.
- The problem is real: a reader who asks "does setLayers rebuild?" must read the whole paragraph. A list is the right fix, and the bullet list for line 184 is sound.
- The table form is wrong. The two columns are two unrelated lists of different lengths (about 13 against 8 items). Table rows would pair unrelated items, such as setMaterial beside a transform setter. That misuses a table. Two short bullet lists, each with a lead sentence, give the same quick lookup.
- The proposed edit drops facts from line 194:
  - "These calls rebuild even when the value does not change, apart from a batch's setCastShadows and setReceiveShadows." This nuance is what stops a reader from calling setMaterial with the same material every frame.
  - "The next frame then rebuilds the engine's draw tables, which costs more than a normal frame." This is why the list matters.
  - "in development builds" before the debug view item, and "on an object or a batch" after the setter list.
- No collapsible block is needed here. The lists are the main point of the section, not implementer detail.

## Corrected claim

The two paragraphs are hard to scan, and lists fix that. A two-column table is the wrong form, and the proposed edit loses the rebuild cost, the "even when the value does not change" rule with its batch exception, and the development-builds limit on the debug view.

## Corrected edit

Line 194: one lead sentence, then two bullet lists.

"Some calls change the scene's structure. The next frame then rebuilds the engine's draw tables, which costs more than a normal frame. These calls rebuild:

- creating or destroying a batch or an object of any kind, lights included
- `setMaterial`, `setMesh`, `setParent`, `setDynamic`, `setBounds`, `setFrustumCulled`, `setCastShadows` and `setReceiveShadows`, on an object or a batch
- `texture.destroy()`, and `texture.update()` with an image of another size
- turning shadows on or off
- in development builds, a new [debug view](../api/debug.md)

They rebuild even when the value does not change, apart from a batch's `setCastShadows` and `setReceiveShadows`. These never rebuild the tables:

- transform setters and row writes
- `setVisible`, `setLayers`, `setActiveCount` and `setRenderOrder`
- the other setters of lights and cameras, and `material.set`

So create batches in the setup, and pool rows during play instead of creating batches."

Line 184: keep the first three sentences and the 500-crates example, then "Some groups split:" and a bullet list of the four split cases with their backend (WebGPU own bounds; never-culled objects; shadow receivers against non-receivers; WebGL2 dynamic and static-at-rest rows against objects). Keep the blended sentence after the list.
