---
id: concepts/lod
title: Levels of detail
status: experimental
since: "0.2"
summary: "LOD groups; levels that meshes made in code plan on the job workers; generated LODs; cluster patches; staged downloads; per-instance selection; small-object hiding."
---

# Levels of detail

> Roadmap step 0.2, first released in null3D 0.1.0. The API is experimental, so it can still change between versions. Morphed objects, and materials that blend or let light through, draw their base mesh at every distance. A skinned object draws a level while the level names the base mesh's own vertices, as the asset tool's levels do. Custom materials, and masks with the `'hash'` alpha mode, switch levels at once, with no fading band. A distance band cuts at once for them too.

```mermaid
flowchart LR
    base["Base mesh<br/>2,000 triangles"] --> l1["Level 1<br/>error e1"]
    l1 --> l2["Level 2<br/>error e2"]
    l2 --> l3["Level 3<br/>error e3"]
    pick["Each frame, each object<br/>and each instance row"] --> rule{"its switch distance<br/>under the distance<br/>from the camera?"}
    rule -->|"coarsest level<br/>that passes"| draw["Draws that level"]
    rule -->|"the bound covers<br/>under a pixel,<br/>or lies outside its band"| hide["Draws nothing"]
```

An object far from the camera covers few pixels. Its full mesh then costs vertex work that no one sees. A level of detail is a simpler copy of the mesh with fewer triangles. The copy differs from the full mesh by a small distance, its error. Where that distance covers less than about a pixel on the screen, the copy looks the same as the full mesh.

A mesh with levels draws one of them per frame in every object and every instance row that uses it. The engine picks the level on the GPU on WebGPU, and on its job workers on WebGL2. Both use the same rule, so a level switches in at the same distance on every GPU path.

## Levels of meshes made in code

A mesh made in code plans its levels the first time the scene draws it, when it holds 4,096 triangles or more, or when its copies hold 65,536 triangles together, whether `geometry.fromArrays` or a generator made it. A page's meshes and an add-on's plan alike. A mesh that no object draws plans nothing, and the plan sees the material that draws the mesh first. The plan runs on the job workers, never in a frame, and the mesh draws its full shape until the levels arrive. It runs the planner that the asset tool's `--lod` runs, with the same build of meshoptimizer's simplifier, so the same mesh gets the same levels in code as in a file. The copies that already draw the mesh then pick their levels, as the streamed levels of a file refine in place.

```ts
const rock = geometry.fromArrays(rockArrays(20_000));
scene.createInstances(rock, 5_000, { material: stone }); // the first draw plans the levels
await rock.buildLevels(); // resolves with the levels once they are in
```

Each level about halves the triangles of the level above, down to a few dozen, and keeps its measured error, so it switches in at once where the error covers less than the `lodThreshold` setting's pixels. The levels name the mesh's own vertices, so they cost indices alone, and the mesh keeps its vertex and triangle order: raycasts and `updateVertices` see the mesh as it was made. The [geometry page](../api/geometry.md#levels-of-detail) gives the `levels` option, which turns the plan off or on, and the meshes that plan none: meshes that pose or move, meshes that a shader shapes, meshes whose vertices change, and meshes whose levels you set by hand.

A mesh of separate quads plans as any other mesh unless it asks for cards with `levels: { cards: true }`. The walls of a building kit are separate quads too, and thinning them as cards would cut holes in them. Without cards, a level drops only whole small pieces, such as a shutter's slats, where they cover under a pixel.

## Give a mesh its levels by hand

`mesh.setLevels` takes up to 15 lower levels, from the most detailed down. Each level is another mesh with the base mesh's vertex attributes. Each gives the distance at which it switches in, in one of three ways:

- `error`: the largest distance between its surface and the base mesh's, in the units of the base mesh's positions. An object's scale multiplies it, so a switch moves with the object's size.
- `distance`: a distance in meters for an object of scale 1. It holds on every screen height and at every render scale.
- `coverage`: the share of the render's height that the object's bounds cover, from 0 to 1. It holds on every screen height too.

```ts
const tree = geometry.fromArrays(treeArrays(64));
tree.setLevels([
	{ mesh: geometry.fromArrays(treeArrays(24)), distance: 60 },
	{ mesh: geometry.fromArrays(treeArrays(8)), distance: 140 },
]);
// Every object and instance batch that draws the tree picks its level.
scene.createInstances(tree, 20_000, { material: bark });
```

The switch distances grow from level to level, whatever their measures. Levels set by hand win over planned ones: `setLevels` ends a plan that runs, and the planned levels go. The asset tool works out each level's error for you, as the next section shows.

## A material per level

A level may name a material of its own, so a far level shades more cheaply. It can leave out the normal map, or use an opaque mask in place of an alpha-tested one:

```ts
const bark = materials.standard({ map: barkMap, normalMap: barkNormal });
scene.createMesh({ mesh: tree, material: bark });
const barkFar = materials.standard({ map: barkMap, roughness: 0.85 }); // no normal map
tree.setLevels([
	{ mesh: coarse, error: 0.02, material: barkFar },
	{ mesh: coarsest, error: 0.1, material: barkFar },
]);
```

A level without a material draws with the material of the level before it. The base level draws with the object's or the instance batch's material. A glTF file gives a level its own material when the level node's primitive names another material than the node's primitive. Each material draws in its own buckets, so the far levels' pipelines leave out what their materials do not use.

## Levels from the asset tool

`bunx @null3d/cli assets optimize --lod` adds levels to each mesh of 64 triangles or more, as [the asset pipeline](../guides/assets-pipeline.md#levels-of-detail) explains:

```sh
bunx @null3d/cli assets optimize models/ public/models/ --lod
```

The tool can also write each level as a separate download, so a model's coarse shape shows at once and finer detail arrives while the page draws it:

```sh
bunx @null3d/cli assets optimize models/ public/models/ --lod --stages
```

The model file then holds the full vertices and the coarsest level, and each finer level downloads from a file of its own. The engine draws each level as it arrives, and the copies that already draw the model refine in place.

The loader also holds back a level that the camera never shows. It fetches the stage after the file's own level at once. Then it keeps each finer stage until a view has drawn the level that the mesh has now. It waits about two seconds of drawn frames for that pick. A level that never draws cannot lead to a finer one. So the loader sets that stage and the finer ones aside, and their files do not download. The engine decides from the levels that it picked, never from the device's name. The switch follows the camera, the render scale and the `lodThreshold` setting. What the loader set aside is not lost. It looks again about every second and a half. A camera that comes close enough to draw that level then brings the stage and the finer ones. So a level that the camera never draws costs no download, and a level that the camera starts to draw arrives.

`assets.loadGltf` takes `maxLevels` to stop after that many levels, counting the file's own: a page whose objects never come close enough to show the finest level sets 1, and downloads less. [The asset pipeline](../guides/assets-pipeline.md#levels-as-separate-downloads) has the detail.

Each level has about half the triangles of the level above, down to a few dozen triangles. A mesh of a million triangles takes 15 levels to get there. Each level shares the mesh's vertices. The loader stores each level over the base mesh's own vertices, so the level costs the GPU its indices alone. The tool orders the vertices coarsest level first, so a coarse level reads a stretch at the start of the vertex buffer. Some levels keep a copy of their vertices instead. A level of cards brings positions of its own, and a level whose base mesh the engine had to split into parts cannot share them. Each level stores its error in the units of the mesh's own positions. The tool stores the levels with the `MSFT_lod` glTF extension. Each node with levels keeps its errors in its extras, as `NULL3D_lod_error`. It also writes the screen coverage that each error implies, in `MSFT_screencoverage`, for a screen 1,080 pixels high. The loader reads the coverage that comes beside an error to tell a measured error from a hand-set one, and reads the coverage alone as the measure for a file that holds no errors. `assets.loadGltf` gives each mesh its levels. So a model's copies and its instance batches pick their levels with no code. Other glTF loaders draw the full mesh.

A measured error changes the picture by less than a pixel at its switch. Such a level switches at once. The loader reads an error as measured only where the file also gives the coverage that the tool writes beside it. A file that gives errors alone holds switch distances that its author set by hand. Those levels fade, as levels given by a distance or a coverage do. A file may bring its own levels, such as levels made in Blender, with errors in the units of the mesh's positions. `assets optimize` keeps them. It stores each level's positions in its base mesh's integer steps, and converts their errors to those steps.

## Cluster levels

A level covers the whole mesh at one detail. A mesh that is close at one end and far at the other picks one detail for all of it. A cluster tree splits the mesh into patches of about 128 triangles instead. Each patch has its own error and its own bounds. One mesh can then draw fine triangles near the camera and coarse ones far from it. Its near and far parts switch detail separately.

The asset tool builds the tree with `--clusters`, as [the asset pipeline](../guides/assets-pipeline.md#cluster-levels) explains. It splits a large static mesh into patches, then simplifies groups of patches into the patches above them. Every patch's indices name the mesh's own vertices, so the tree adds no vertex. It costs about twice the mesh's indices.

A view draws a patch while the patch's own error passes its threshold and the error of the patch above it does not. Each error is tested at the distance to its own patch's bounds. A patch that fails the threshold is too coarse for that distance, so the walk descends into its children. The chosen patches are the frontier of that one rule. A patch's bounds hold its children's bounds, and its error is at least theirs. So a patch never passes where one of its children fails, and the patches cover the mesh once. Neighbours of different detail meet at their edges with no gap. The engine draws a tree from an older asset tool as whole levels, and in development it asks you to optimize the file again.

The engine draws a tree's patches on both GPU paths, in the camera's view and in each shadow map. On WebGPU, a compute pass picks the patches that a view draws, copies their indices into a list of the view's own, and the view draws them in one draw. A view that sees none of a mesh's patches draws none of it. The pass runs three dispatches: one to test each patch, one to add the counts up, and one to copy the indices that draw. The list takes four bytes an index. The engine counts the indices that each view picks in each frame, and sizes the view's list to them with room to spare.

On WebGL2, the job workers walk the tree for each view with the same rule, where the device has `WEBGL_multi_draw` (Chrome and Safari). Each chosen patch is a range of the mesh's tree in one multi-draw call, so a frame uploads ranges and no triangles. Ranges that are neighbours in the tree's index list merge, so a frame makes fewer calls. A WebGL2 browser without `WEBGL_multi_draw`, such as Firefox, draws the mesh's whole levels instead. The tool writes them beside the tree. They are the levels that `--lod` makes, and other glTF viewers draw them too.

The engine splits a mesh of more than 65,535 vertices into parts, because a draw's 16-bit indices reach no further. On WebGPU such a mesh still draws its patches. The engine puts all of its parts in one vertex buffer, one after another. The tree's 32-bit indices reach every vertex there. That buffer holds at most 128 MiB, the default size of a storage binding: about 4 million vertices of 32 bytes. A larger mesh draws whole levels instead. The trees that a scene draws also share 128 MiB of indices, about 33 million. They share at most 65,535 patches too, which a mesh of about 4 million triangles fills. A tree that does not fit draws whole levels.

On WebGL2, a vertex buffer holds at most 65,535 vertices, so a mesh of more vertices lies in several buffers. Its tree then draws from a copy of the mesh's vertices that the tree keeps for itself, with 32-bit indices. The copy costs the mesh's vertex bytes a second time: 12 MB for a ground of a million vertices of 12 bytes. This needs the `WEBGL_provoking_vertex` extension, which Chrome offers, and WebKit, Safari's engine. Without the extension's first-vertex rule, Chrome on the Mac would copy the tree's whole index list before each range it draws. So a browser without the extension draws such a mesh's whole levels instead. A tree of a mesh in one buffer draws its patches either way.

A tree can stream as a model loads, with `--clusters --stages`. The model file then holds the tree's first band, and that band draws the first picture. Each later band downloads from a file of its own. A band appends its patches below the patches that already arrived, so the tree refines as the bands come and no new object appears. The patches that a page holds always form a whole tree from the root. A patch whose children have not arrived draws where the camera is close, so the first picture is coarse and still covers the whole surface. The loader holds a band until a view draws a patch of the band above it. `maxLevels` counts a band as it counts a level. [The asset pipeline](../guides/assets-pipeline.md#levels-as-separate-downloads) has the detail.

The patch path draws a mesh that one copy draws, and the file may still hold a tree for a mesh with more copies. A mesh that draws several copies at once draws its whole levels, because the walk picks the patches of one copy. An instance batch draws whole levels too, even with one row. The tool counts only the copies that the file places. A mesh that page code draws in an instance batch therefore still gets a tree, and its copies draw the whole levels. The levels go down to a few dozen triangles, so far copies stay cheap. The WebGPU path that draws objects directly also draws the whole levels, because it has no cluster pass. Meshes that a skin or a morph target bends, and meshes whose material blends or masks, keep whole levels too. A shadow map draws a caster's patches where the camera's view draws the same object's tree, and the caster's whole levels elsewhere.

## Pieces of a large level

A copy that the view cuts through, or that turns half its surface away from the camera, still draws every triangle of its level. So `--lod` also sorts each level of 32,768 triangles or more into 8 to 16 pieces. Each piece faces about one way and has its own bounds. The file stores them in `NULL3D_pieces`, and other viewers draw the same triangles in the new order.

Each copy picks its level as before. It then skips each piece of that level that lies outside the view. In the camera's own view it also skips each piece whose triangles all face away from the camera. With GPU occlusion culling on, it skips each piece that the occluders hide as well. The picture is the same as without pieces. A material that draws both faces keeps every piece that faces away, and so does a copy that is mirrored or stretched. Each piece adds a draw to its level, so a smaller level keeps whole unless many copies draw it.

A smaller list gets pieces only where the way it faces makes them pay, since the view seldom cuts a small copy. Many copies must draw it: a list of 1,024 to 32,767 triangles whose copies hold 65,536 triangles or more together. Its triangles must also fall into a few tight facing groups, as a building's sides, tops and undersides do. Such a list gets one piece for each of up to six ways that it faces. One more piece holds the triangles that face between them, such as a pot's or a sloped cap's. Each copy then skips the sides that face away from the camera. The group must let each copy skip a quarter of the list's triangles or more, over views from all around. A list that faces every way, such as a rough rock, gets no facing pieces, and neither does one whose material blends. The engine plans none for a material that draws both faces either, since the cone test would drop none of them. A file's stored pieces still cull by the view. A list that faces mostly one way, such as a ground, stays whole too, since a view sees its front. The asset tool stores such pieces whatever copies the file places, since a page may copy a file's mesh many times. The engine counts the copies that the scene draws of each mesh. Until they pay, the list draws whole, with no draw more. A file's mesh whose smaller list holds no pieces, as from an older file, plans them on the job workers once its copies pay.

A mesh made in code gets pieces with its planned levels. The plan on the job workers sorts the mesh and each of its levels of 32,768 triangles or more into pieces, as `--lod` does. The mesh keeps its own triangles in their order, so raycasts and `updateVertices` see it as it was made. A mesh that one object draws, such as a ground around the camera, gets pieces of its own too. They draw a sorted copy of its indices, which shares its vertices. Copies of a large mesh draw their full mesh only near the camera, so they keep the pieces of their levels and spare that copy. The copy of a smaller list's indices costs little, so a smaller mesh that many copies draw gets pieces of its own as well. A list whose triangles mostly face one way, such as a ground, a road or a wall, splits by space alone, so the view cuts the pieces that it leaves out. A mesh of more than 65,535 vertices, which the engine splits into parts, sorts each part's triangles into pieces of their own, and a mesh of more than 32 parts gets none. A mesh with `levels: false` gets no pieces. A mesh whose levels are set by hand plans no levels. It still plans facing pieces of its own list at its first draw when it holds under 32,768 triangles and many copies draw it. A town's house walls are such meshes. `levels: 'pieces'` asks for pieces alone: a mesh of 32,768 triangles or more sorts into pieces by space at its first draw, as the impostors' merged far cells do. A surface that blends or lets light through, such as water, draws whole in the transparent pass, so it takes no pieces.

## How the engine picks a level

A level given by its error switches in where that error covers fewer pixels than the `lodThreshold` quality setting:

```text
pixels = error × scale × render height / (2 × distance × tan(field of view / 2))
```

The setting is 1 pixel from Medium up, and 2 on Low. The render height includes the render scale. So on a taller screen, or at a higher render scale, such a level switches in farther away. When the frame-budget governor lowers the render scale, coarser levels draw. When frames still take too long, the governor doubles the threshold, twice at most.

A level given by its distance switches where the camera is that far from the object's nearest point. The camera's field of view, the screen height and the render scale do not move it. A level given by its coverage switches where the object's bounds cover that share of the render's height. A taller screen does not move that switch either.

An orthographic camera's pixels do not shrink with distance. So its levels follow the object's scale and the camera's zoom alone.

For a level given by its error, the distance runs from the camera to the center of the object's bounding sphere, less half the sphere's radius. A level's error is its largest anywhere on the mesh, so a large object switches by a point between its near side and its middle: it does not turn coarse too early, and its far side does not keep detail that only its near side shows. A level given by its distance or its coverage measures to the nearest point of the bounding sphere, as its author set it. Turning the camera never changes a level. A camera inside the bounds, or near its middle, measures almost no distance, so the object keeps its full detail. A view with a camera of its own, such as a render pass, picks with that camera. Mirrors and the outline effect pick as the main camera does.
The same threshold hides an object of a mesh with levels that has nothing left to show. A bound that covers fewer pixels than the threshold draws nothing, and the mesh's last level holds no geometry. [Small objects](#small-objects) gives the distance and the fade.

Levels add no second copy of each object's data. Each view keeps about the room of one copy for each object and instance row that draws, whatever the number of levels and fading bands. A forest of 40,000 copies with four levels takes about 2.6 MB in a view.

## The bias of one object

`setLevelBias` raises or lowers the threshold for one object, as Godot's `lod_bias` does. The bias divides the factor that picks the levels. A bias above 1 draws each switch at a nearer distance, and a bias below 1 keeps the object's detail:

```ts
hero.setLevelBias(0.5); // the hero keeps its detail twice as far out
scenery.setLevelBias(2); // the scenery turns coarse twice as soon
```

The same factor moves the distance at which the object hides. A detailed hero object therefore stays visible farther out. The default is 1. The bias belongs to the object, so two objects that draw one mesh keep different detail. A change rebuilds the engine's tables of what it draws. In a scene without levels the bias does nothing.

## Fading between levels

A level that switches in at once can pop. The engine fades only where a switch would show:

- A level with a measured error, which the asset tool writes and a mesh made in code plans, changes the picture by under a pixel at its switch. It switches at once, so it pays for no second draw. A file's error counts as measured only where the file also gives the coverage that the tool writes beside it.
- A level given by a distance, by a coverage or by a hand-set error changes the picture more. It fades.

A fading level hands over in a short band past its switch distance. The band is 8% of the distance long, and the old level and the new one both draw in it. A 4 × 4 dither pattern gives each pixel to one of them, and the share of the new level grows across the band. Each copy shifts the pattern by a phase from a hash of the copy, so neighboring copies do not line up into one grid. The two levels of a band take the same phase, so no pixel draws twice. Nothing sorts.

```ts
// A hand-set error fades by default. This one switches at once.
mesh.setLevels(levels, { fade: false });
// One level decides for itself.
mesh.setLevels([{ mesh: low, distance: 80, fade: false }]);
```

The fragments that the dither drops cost a tile GPU, such as a phone's or an Apple GPU's, its hidden-surface removal. So only the objects inside a band draw with the dither. The shader builds of the bands download with the first mesh whose levels fade. These builds follow the level, whatever the `lodFade` quality setting, because a hand-set level pops without them.

[Custom materials](../shaders/surface-functions.md) fade too, through their own builds, which download with the material's first use. Three kinds switch at once: a material that tests its mask by the [alpha hash](../api/materials.md#alpha-modes), a skinned material, and one that lets light through.

One add-on morphs a level instead of fading it. The terrain add-on moves each block's vertices toward its parent block's surface over the last part of the approach. The block then matches its parent when the selection hands over. It writes the target in the mesh's four-number vertex record, which its own custom material's `vertexOffset` reads. The morph adds no draw and writes no vertex in a frame. The vegetation add-on fades its card levels with the dither instead. Each level draws on until the next stands at full coverage, then thins out, so no pixel drops out of both. File meshes keep the dither too: the asset tool's simplifier records no mapping between one level's vertices and the next.

## Small objects

An object far away can cover less than a pixel. Its levels then save vertex work, but the object still draws a fragment or two that no one sees. The engine hides it: the mesh's last level holds no geometry. Only a mesh with levels has that last level, so a mesh without levels draws at every distance.

The rule reads the object's bounding sphere, at the distance that a level given by its error measures. The number of pixels that its world diameter covers follows from the same factor as every level's switch distance:

```text
pixels = diameter × factor × threshold / distance
```

The object hides where that diameter covers fewer pixels than the `lodThreshold` setting. The render height, the render scale and the governor's doubled threshold all feed the factor, so they move the hide distance too. An orthographic camera hides an object by its diameter and the camera's zoom alone.

The object draws nothing past the band that follows the hide distance. That band, 8% of the hide distance long, thins the coarsest level out with the same dither. A shrinking object then fades away instead of popping. The band needs a fading build, which a level that fades has. A mesh whose levels all switch at once disappears at the hide distance.

A shadow map hides a caster whose bounds cover fewer of the map's texels than the `lodShadowThreshold` setting. A pebble 1 cm across draws nothing in a cascade whose texels are 2 cm wide, wherever the camera stands. The shadow passes draw no band.

## Distance bands

`setDrawRange` gives a band of distances in which a mesh, an instance batch or one of its rows draws. It works as Godot's visibility range and Bevy's `VisibilityRange` do:

```ts
stone.setDrawRange(8, 120); // nothing nearer than 8 m, nothing past 120 m
grass.setDrawRange(0, 60); // a far edge only
```

The mesh draws only while the camera's distance to its nearest point lies inside the band. Each edge fades inside the range over an 8% band, through the same dither. A stone then fades in as it comes near and out as it passes. A mesh that lies outside its band costs no draw on either GPU path. The `lodFade` quality setting turns these edges off on Low, where the dither costs tile GPUs their hidden-surface removal. A row's own range, in the array that `ranges: true` makes for a batch, overrides the batch's.

## See the levels

The development build draws a levels view: `debug.view('levels')` from the sketch, or `?view=levels` in a page's address. Each draw takes a color for its level, from blue for the base mesh to cyan for the sixth lower level. Every level past it draws gray. Where two levels hand over in a fading band, the view dithers the two colors, so the band shows. A source that the size rule or a draw range hid draws at its base level in a striped magenta marker, at the place it would have drawn. The view then shows what the culling dropped, rather than a hole.

The view reads the level that the culling picks, so it needs no shader for each material. `debug.cullingSpheres(true)` draws the bounding sphere that culling tests for each object whose mesh has levels, so a sphere that hid by its size shows where it lies. It draws in a development build only. An add-on registers a view of its own through the `debugViews` field of its [feature description](../api/features.md#the-fields).

## Shadows

Each shadow map picks its casters' levels in its own texels. A cascade of the sun's shadows is an orthographic view, so its texels have one size at every distance. A caster's level draws there while its error covers fewer of the cascade's texels than the `lodShadowThreshold` quality setting. A spot or point light's tile measures from the light, as a camera measures from its eye. The setting is 1 texel on every preset. Low's smaller maps have larger texels, so they pick coarser levels already.

The choice does not depend on the camera. Far cascades and the tiles of spot and point lights keep their depth between draws. That depth stays right as the camera moves. A cascade picks the same level for a caster while the camera moves inside it.

The normal bias moves each receiver up to one texel along its surface's normal. A caster's level that errs by less than a texel stays within that offset, so it does not shadow its own surface. A near cascade, whose texels are small, draws a near caster at a fine level, and a far cascade draws the same caster coarser.

A cluster tree picks its patches in each shadow map by the same rule. Each cascade and tile draws its own cut through the tree: fine patches where its texels are small, and coarse ones where they are large. The camera's cut is never reused for a shadow map.

Distance bands, and levels given by a distance or by screen coverage, keep the camera's distance in the shadow maps too, as their authors set them for the camera. Shadow maps draw no fading band.

## Cards beyond the levels

A level of detail keeps one draw and one mesh per object. Far past the last level, an object can draw as a card instead: a quad that stands upright, turns to the eye, and shows a picture of the object. The `@null3d/impostors` add-on draws those cards, and a distance band on the meshes hands the object over to them.

A bake stores the object from many directions, folded onto an octahedral grid, in a color atlas and a surface atlas of normals and depths. Each card blends the three stored views nearest the direction from the card toward the eye, so the picture changes smoothly as the camera moves rather than jumping between views. The card's light comes from the scene, through the stored normal, so a sun that moves relights the cards exactly as it relights the meshes. A copy's turn about the world's up turns its views and its light too, so a turned tree hands over to a card whose crown matches it. A camera that moves around the tree does not turn its light: the card turns to the eye, and the stored normal turns only with the tree. A card casts the crown's shape, and takes the shadows that fall on the surface it shows, when the sketch asks for it.

`setDrawRange` fades a band's edges with the dither, so the hand-over from a mesh to its cards need not pop. The vegetation add-on's `handOverToCards` sets the two bands for a row of plants. It starts the cards early enough that their own dithered edge finishes first. The mesh and the card are different sources, so their dither phases differ. The card must already cover every pixel that the mesh will drop. [Impostors](../api/impostors.md) gives the calls, and the demo `examples/impostors` draws a forest three ways by distance.

## From three.js

| three.js | null3D |
| --- | --- |
| `const lod = new LOD(); lod.addLevel(high, 0); lod.addLevel(low, 50)` | `highMesh.setLevels([{ mesh: lowMesh, distance: 50 }])`, then draw `highMesh` |
| a `LOD` object whose `far` the sketch checks | `mesh.setDrawRange(start, end)` |
| `lod.addLevel(object, distance, hysteresis)` | `{ mesh, distance }`. The bands replace hysteresis |
| `lod.autoUpdate`, `lod.update(camera)` | None: the engine picks levels in every frame |
| `lod.getCurrentLevel()` | None |
| `SimplifyModifier` from three/addons, to make the far copies | None: a mesh of 4,096 triangles or more plans its levels on the job workers when it first draws, and `mesh.buildLevels()` plans a smaller one |

A three.js `LOD` holds whole objects. In null3D the levels belong to the mesh, and every object and instance batch that draws it picks its own level. A level given by its distance switches in at that distance for an object of scale 1, on every screen. The distance measures to the nearest point of the object's bounds. three.js measures to the object's position instead, so a large object switches later in null3D. A level given by its error or its coverage compares at a field of view of 50 degrees, three.js's default. The `fov` option of `setLevels` names another one.

## API reference

`mesh.setLevels`, `mesh.buildLevels` and the options they take are on the [geometry page's reference](../api/reference/geometry.md). The quality settings are on [the quality page](../api/quality.md).
