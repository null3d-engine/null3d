# D-284: Screen-space bounce light

Status: decided by task M3-F12. The feature draws on High and Ultra, and on WebGL2's Medium,
which is that path's highest preset. It takes one bounce of the indirect light that the camera's
view showed in the frame before. It draws at half the render size, and a spatial filter denoises
it.
It feeds the opaque pass's indirect light, in place of the environment's diffuse light, before the
tone mapping. The accumulation that M3-A11 built does not denoise it, because that accumulation
does not ship ([D-206](D-206-temporal-resolve.md)). The measured cost is in "Figures".

Summary: The camera's opaque pass lights each surface from what the screen showed in the frame
before. A trace at ambient occlusion's half-size grid samples a disk of screen texels around each
surface. It keeps those in the surface's hemisphere, weighted by the cosine of their direction.
Each takes the color that the frame before showed there. A denoise keeps the light on each surface. The light adds to the ambient
light and replaces the environment's diffuse light where the screen has an answer. It fades to the
environment where it does not. The light is off on the 8-bit path, whose scene color holds the
display's already.

## Question

Which light does one bounce add, where does the pass sit, and what denoises it?

The plan's task M3-F12 asks for one bounce of indirect light from what the camera sees. The light
must reach the lighting model before the tone mapping, not be painted over the finished picture.
An add-on pass could only tint the final color. Only the core can feed what surfaces are lit by.
[D-179](D-179-technique-rulings.md) ruling 20 makes the task core work for that reason.

## Rule

- The light is one bounce of the light that the camera saw. It comes from the copy of the opaque
  color that screen-space reflections and transmission read too. A disk of screen texels around
  each surface samples it, rather than a ray marched through the depth.
- It draws at half the render size on ambient occlusion's grid, so it follows the render scale.
- It is off on Low and Medium, because the cost is not worth the look there. High draws 4 rays a
  texel, and Ultra draws 8. WebGL2 caps at Medium, so its Medium draws 4.
- It adds to the ambient and hemisphere lights. It replaces the environment's diffuse light by
  its share, as the light probe grid does ([D-146](D-146-light-probe-grid.md)). The environment
  keeps the light of the directions whose rays left the screen. The two do not count the same
  light twice.
- It is off on the 8-bit path. The copy there holds the display's color, which is no radiance to
  bounce.
- It makes no GPU object while it is off, and its shaders load on first use with ambient
  occlusion's steps.

## The denoise

M3-A11's accumulation does not ship. [D-206](D-206-temporal-resolve.md) refuses the temporal
resolve at every preset on both paths. The owner has ruled it out for good. It stays behind the
internal setting, and no preset uses it.

The engine's other accumulation, M2-F11's still-camera accumulation
([D-114](D-114-still-camera-accumulation.md)), is no denoiser for this light:

- It blends the finished scene color, not a radiance target, so it cannot smooth the bounce before
  the lighting model reads it.
- It blends only while the view is still. A moving camera, which needs the denoise most, gets
  nothing.
- Hold mode and the image tests turn it off, so the image tests would never see its effect.
- It rests the GPU once a view settles, so a still view's light would stop changing.

The bounce therefore samples the screen, and denoises in space at the grid's size. The trace
samples a spiral disk around each texel. The disk spans 64 texels of the grid, almost half its
height, so that a wall beside a floor shows its upper part. The trace keeps the samples whose
surface lies in the texel's hemisphere, weighted by the cosine of their direction.
The denoise blurs that light over 24 taps in a disk of 4 texels. Each tap keeps to the
texel's own surface, by its distance from that surface's plane and its normal. This is the filter
that ambient occlusion's denoise already applies to its occlusion. The opaque pass reads the light
through the four depth-weighted texels that it reads the occlusion from. The light therefore
reaches each pixel at its own surface, and no second gather is needed.

## Where the pass sits

The steps run in the screen texture's block of the render graph, after ambient occlusion's denoise
and before the camera's opaque pass:

1. The depth copy and the horizon step's normals, from ambient occlusion's steps.
2. The trace, which reads the color copy as the frame before left it.
3. The denoise, which writes the screen texture's second layer.

The opaque pass binds that texture and mixes its second layer into the indirect light. The
environment's diffuse light falls by the light's share, so a ray that hit nothing leaves the
environment's light in its place.

The screen texture is an array of two layers: the first holds ambient occlusion's and the
reflections' values, and the second holds the bounce light. The lit shader's fragment stage already
reads every sampled texture that WebGPU allows: eight in the frame's group and eight map slots. A
new binding would fail every standard material. The bounce therefore takes the second layer of a
texture that the pass already binds, and the binding count does not change. The array has two
layers only while the light draws.

## Data

The figures are in "Figures", from the cost page and the image test.

## Decision

1. **The light draws from the frame before's color.** A sample takes the color that the frame
   before showed at its surface. The light is therefore one frame behind, as screen-space
   reflections are.
2. **The denoise is spatial.** The tap disk weights depth and normal, as ambient occlusion's
   denoise does. The still-camera accumulation and the temporal resolve are not used.
3. **The light takes three quarters of its share of the ambient light.** The screen disk gives the
   surfaces beside a texel more of its samples than their solid angle would. The full share then
   lights a floor beside a colored wall more than the baked reference does. The three quarters
   bring the bleed within that reference's reach. It is the `intensity` of the settings.
4. **The light adds to the ambient light and replaces the environment's diffuse light by its
   share.** A ray that hit nothing or left the screen leaves the environment's light. The double
   counting of the environment with an added term is avoided.
5. **The preset table turns it on at High and above, and at WebGL2's Medium.** The row is
   `bounceRays`: 0, 0, 4, 8 on the presets, and 0, 4, 4, 8 on WebGL2.
6. **The 8-bit path draws none.** The copy there holds display color. Compatibility mode draws
   that path, so it draws no bounce light.
7. **The light is off while a light probe grid is set.** The grid is the engine's global
   illumination ([D-179](D-179-technique-rulings.md) ruling 12). Its bake already holds one bounce,
   and the grid replaces the environment's diffuse light. This rule keeps the two from counting the
   same light twice.

## Figures

### Cost

The effect cost page's bounce scene, at 1920 x 1080, with the light off and on in turns. Each side
took three rounds of two seconds, and the figures are the medians of GPU time per frame. Chrome 156
on the Mac's M5 Max ran them, and the load stayed under 8 through the run. The light used the
preset's own samples: 4 on High, 8 on Ultra, and 4 on WebGL2's Medium.

| Preset | GPU path | Render scale | Off, ms | On, ms | Added, ms |
| --- | --- | --- | --- | --- | --- |
| High | WebGPU | 1 | 0.629 | 3.104 | +2.475 |
| High | WebGPU | 0.5 | 1.335 | 2.484 | +1.149 |
| Ultra | WebGPU | 1 | 0.632 | 1.958 | +1.326 |
| Ultra | WebGPU | 0.5 | 1.436 | 2.571 | +1.135 |
| Medium | WebGL2 | 1 | 2.362 | 3.187 | +0.825 |
| Medium | WebGL2 | 0.5 | 2.519 | 2.503 | -0.016 |

The scale-1 rows sit inside the 1.5 to 3 ms that the estimate gave. The High and Ultra rows
cross. Eight samples on Ultra measured less than four on High, so the difference between the two
lies inside these runs' spread. At half the render scale the light draws a quarter of the texels,
and adds about a millisecond. WebGL2's Medium is a light scene on that path. Its half-scale row's
change is inside the noise.

### The picture

The image test draws the room at the reference preset, with the sketch setting 8 samples itself. On
WebGPU, the floor under the red wall is 6.5 levels redder than the plain room's. The floor under the
green wall is 4.5 levels greener. The baked grid moves those boxes by 7.7 and 1.6 levels the same
way. The light moves 48% of the frame's pixels by two steps or more. It differs from the baked room
over 9.4% of the frame past the image tests' threshold, within the test's limit of 45%.

The test holds what the eye can see and what it cannot. A screen estimate and a bake differ in the
soft edges of the light and where the screen cannot see, so the test does not demand equality. It
holds the bake's signs on both floor boxes, the share of the frame that the light moves, and a limit
on the share that differs past one tenth of full scale, about 13 levels in a channel. A step that
small disappears into the gradient of a lit wall, while a missing, swapped or wrongly colored bleed
fails the signs and the moved share.

The look reviewer approved the pictures against the plain room's. It measured the floor's bleed
within about two levels of the bake at most sampled points, and the worst differences, about six
levels, in the intended direction.
