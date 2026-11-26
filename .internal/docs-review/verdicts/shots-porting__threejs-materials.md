# Shot and demo-link verdicts: porting/threejs-materials

## Shots

### toon-and-matcap (scripted): KEEP, steps corrected
A picture of what the two recipes draw helps a reader under "Recipes". The steps as given cannot be run as written:
- No clay matcap texture exists in the repository (the recipe loads /tex/matcap-clay.ktx2). The test page must draw one in code with textures.fromData, or ship a file.
- Both recipes ignore the scene's lights (the toon recipe reads a uniform direction, the matcap is unlit). The page's directional light only matters for the background, so point it the same way as the toon uniform, [-0.5, -1, -0.3], so the picture does not look inconsistent.
- Give the toon material a base color, since its bands mix the shadow color with it.

### clipping-plane (scripted): KEEP, steps corrected
The cut and the cut shadow are worth seeing. Problems with the steps:
- The plane [0, -1, 0, 1.2] removes everything above y = 1.2. A torus knot at the origin (radius 1, tube 0.3) reaches only about y = 1.3, so the cut takes a thin cap. Place the knot's centre at y = 1.2 so the plane cuts it through the middle.
- With a light from above, the missing top half barely changes the shadow's outline. Use a low light from the side, so the shadow on the ground shows the cut.
- Make the material doubleSided so the inside of the cut tube shows, not empty back faces.
- The torus knot comes from @null3d/geometry (torusKnot) through geometry.fromArrays.

### coat-and-sheen (reference): KEEP
tests/image/references/chrome-real-gpu/webgpu/demo-coat-and-sheen.png exists and shows the red car on its plinth, with velvet (red drapes and a teal cushion) beside it. Note: the image is 320x180, small for a docs page. The coat itself is set in examples/coat-and-sheen/car.ts and the velvet sheen in sketch.ts, so the source list should name those, not only surfaces.ts.

### parity-diff (scripted): REJECT
- `bunx @null3d/cli test` checks a user project: it draws the image tests that null3d.json lists and compares them with tests/references in that project. It does not run the examples/compare pages, and the steps do not say how the night-town view would become such a test.
- The night-town comparison draws each effect with each engine's own technique (the image manifest says the two frames are reviewed side by side, not diffed). A diff of a whole town would be mostly red from technique differences, not from materials. That teaches the wrong thing on a section that says "compare one material type at a time, on a sphere and a plane".
Better source: a small project with one image test of a textured sphere and plane. Take the reference with the color map loaded as sRGB, then load it as linear and run `bunx @null3d/cli test`. Crop the reference, the new image and the -diff.png from test-results/null3d/<environment>/<tier>/. The diff then shows the "brighter or darker everywhere" case that step 3 describes.

## Demo links

- coat-and-sheen/: KEEP. car.ts sets clearcoat and clearcoatRoughness, and the velvet sets sheenColor.
- iridescence-and-anisotropy/: KEEP. scene.ts sets iridescence, iridescenceIor, iridescenceThicknessRange and an anisotropy direction.
- relief/: KEEP. sketch.ts and wall.ts set displacementMap; outlines and shadows follow it.
- decals/: KEEP. marks.ts builds boxes with materials.decal, the exact replacement the page gives.
- water/: REJECT. The water demo draws with the @null3d/water add-on, which this page never mentions. A reader who opens its code finds no render.addPass({ kind: 'reflection' }) and no custom material that reads it. Use mesh-arrays/ instead: examples/mesh-arrays/sketch.ts adds a reflection pass and a custom water material that bends the reflection with its waves, which is the route the table row gives. (mesh-arrays has no code value, so its link is mesh-arrays/.)
- tone-mapped/: KEEP. The entry has no code value, so its name, tone-mapped/ is right, and the folder exists. The sketch shows toneMapped: false beside the tone-mapped row.

## Concepts said to have no demo

- Lambert and Phong conversion: confirmed, no demo.
- Toon recipe: confirmed, no demo (the car-paint add-on has a lobe function, but not toon bands).
- Matcap recipe: confirmed, no demo.
- Clipping planes: confirmed, no demo.
- Alpha map: confirmed for the recipe (a separate alpha texture read from green). forest/ cuts tree cards by the alpha of their map, the table's first route, but only on phones and far away, so it is not a good link.
- scene.overrideMaterial: NOT confirmed. The objects demo (objects/) has a Look button whose "One material" choice sets scene.overrideMaterial, and back to null. It also has a reference image: tests/image/references/chrome-real-gpu/webgpu/demo-objects-one-material.png (test demo-objects-one-material, sketch examples/objects/sketch.ts?look=one), with demo-objects.png as the "Materials" view. Link objects/ under "Other materials", and consider these two images as a before-and-after shot.
