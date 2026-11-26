# Shot and demo-link verdicts: api/math

## Shots

### math-drones: reject

- The source file exists: tests/image/references/chrome-real-gpu/webgpu/demo-math.png. It is the math demo's held frame at 8 seconds.
- The file is 320 by 180 pixels, as are the compat and webgl2 copies. At that size the 300 drones are small blue dots. Nothing in the picture is clearly a drone.
- The paragraph under the example talks about each drone's heading, lean and bank. The picture cannot show these at this distance or at any size of this view.
- This is an API page about array helpers. A picture of glowing dots does not teach a reader how vec3 or quat work. The demo link in that paragraph already sends readers to the moving scene.
- Corrected source: none. A larger scripted capture of the same default view would still show only dots.

## Demo links

### vec3 and quat helpers -> math/: reject (duplicate)

- The code is right. The math demo has no code value, so it is "math/". Its sketch uses vec3.create, lerp, add, sub, cross, transformQuat, and quat.fromEuler, multiply and rotateY on scratch arrays made once.
- But the page already links this demo in the same section ("The vector and quaternion math demo"). The statistics list it as the page's only example link. A second link adds nothing.

### The maths entry and createMath -> replay/: keep

- The code exists: the replay demo has code "replay/".
- Its simulation file (examples/replay/sim.ts) imports createMath from @null3d/engine/math and vec3, quat and math from the sub-paths. It builds the exact helpers with createMath({ sin, cos, acos, exp }) on an exact maths library, as the page's snippet does. It calls exact.quat.fromEuler for the view.
- This is the best live example of the section.

## Concepts said to have no demo

### Color helpers into row colors: confirmed

- No demo has this as its subject.
- The joint overrides demo (look-at/) does it in passing: its courtyard file converts hex colors with color.fromHex and writes them into an instance batch's row colors. But that demo is about turning a knight's joints, so a link from here would confuse readers.
- The animated values demo (property-animation/) uses color.fromHsl, but for material keyframes, not row colors.

### Seeded random numbers: not confirmed, use hold-mode/

- The repeatable frames demo (hold-mode/, no code value) shows the whole "Random numbers" section.
- Its sketch calls math.seed(2) and math.randFloat to make the same stone texture on every run.
- It also places 400 balls with Math.random. Each live run differs, and with hold mode the held frame is the same on every run. That is the page's third bullet: hold mode seeds the generator and makes Math.random draw from it.
- Suggested link: https://github.com/null3d-engine/null3d/tree/main/examples/hold-mode under "## Random numbers".
