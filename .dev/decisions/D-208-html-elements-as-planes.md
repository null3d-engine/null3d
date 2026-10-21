# D-208: HTML elements as planes of the scene

Status: decided. Date: 2026-10-21. Task: M3-K4.

Summary: A label whose `transform` is `'world'` or `'billboard'` is an HTML element that CSS turns with the scene's perspective. It takes three.js's `CSS3DRenderer` matrices for `CSS3DObject` and `CSS3DSprite`. The sketch composes the element's world matrix and the frame's camera. The page then writes one `matrix3d` per element and the camera's transform on one container. The matrices take a table set of their own, so a page that shows no such label can hold none.

## Question

The labels of [D-38](D-38-labels.md) are places on the canvas: the sketch projects each anchor, and the page translates an element to it. A place has no turn and no scale. A panel that turns away from the camera therefore cannot carry its label, and a card in the scene cannot lean.

three.js answers this with `CSS3DRenderer`, which needs no GPU and no mesh. It puts a `perspective()` and the camera's inverse world matrix on a container element. It writes each element's world matrix as a `matrix3d`, and the browser then scales, turns and leans the element as it draws the scene. A `CSS3DObject` takes the object's world matrix. A `CSS3DSprite` replaces its turn with the camera's own.

What must the engine hold for a label to be a plane of the scene? Which side computes what, and how does it do that without a message or an allocation per frame?

The question has four parts:

1. Where the element's matrix lives, and how it follows the frame on screen in every thread mode.
2. What the sketch computes, and what the page computes.
3. How the page makes the DOM that the perspective needs.
4. Where the result matches `CSS3DRenderer`, and where it differs.

## Rule

- A label with `transform: 'world'` or `'billboard'` puts its element where that frame's camera and its object's world matrix place it, in every thread mode.
- The sketch thread and the thread that draws allocate nothing per frame for the matrices (hard rule 1). The page writes a transform only when its matrix changed.
- A page with no such label runs no extra work and holds no memory for them.
- The element's matrix matches three.js's `CSS3DRenderer` for the same object, offset and camera, to the precision of a 32-bit float.

## Data

| Measure | Result | How |
| --- | --- | --- |
| An element's matrix against three.js's `CSS3DObject` matrix, a turned and scaled object with an offset, both lenses | Within a ten-thousandth | `packages/engine/src/scene/scene.test.ts`, "labels" |
| A billboard's matrix against three.js's `CSS3DSprite` matrix, a turned camera, a turned and scaled object and `rotation2D` | Within a ten-thousandth | Same test |
| The container's transform against three.js's `CSS3DRenderer` camera transform, a perspective view and two orthographic views | Within a ten-thousandth | Same test |
| An element's box against three.js's `CSS3DRenderer` box, a turned card and a billboard card | Within 1.5 CSS pixels | `tests/image/labels-3d.spec.ts`, hold mode |
| A billboard's element against the card's place in the frame on screen, while the camera rolls | Within 2 CSS pixels, in every thread mode: the box comes from two composed transforms, so a reading can catch a fraction of the card's move | Same test |
| Download, after Brotli | The page's label loop grows from 1,157 to 2,009 bytes, 852 bytes more, and loads with the first bind | `bun run build`, against main's size report |

## Decision

### A table set of its own, with a capacity of its own

A 3D label needs twelve floats where a screen label needs two, and the page needs the frame's camera with them. Two designs were open:

- Twelve floats in every label record. A buffer of 4,096 labels then takes 786 KB of the memory that the threads share, for a page that may show two tags.
- A second table set, of a capacity that the page names, with the frame's camera records beside it.

The second wins on principle 8, pay only for what you use. `createEngine`'s `maxLabels3d` sets the capacity, and 256 is the default. That takes 40 KB of the control buffer, and it fits the tables of three.js's periodic table example. A page with `maxLabels3d: 0` holds no 3D table and pays nothing.

The header gains the 3D capacity and the camera of each frame parity. `labelRegion` reads the capacity from the header. The sketch never sees `createEngine`'s options, so it derives the same layout from the buffer alone. The thread that draws copies the parity table and the parity camera into the presented ones, under the sequence counter that guards the screen labels. A 3D element therefore follows the frame on screen by the same rule.

A 3D label takes a slot in the 3D table, and a screen label in the screen table. A label that changes its transform gives its slot back and takes one in the other table, under a new generation. The page then never shows an element from the wrong label. The message that names a slot's id also names its table.

### The sketch composes the matrix, the page writes the CSS

The sketch already reads each object's world matrix for the screen labels. For a `'world'` label it writes that matrix with the label's anchor in its translation column. The offset then turns and scales with the object, as a `CSS3DObject` child at that offset does. For a `'billboard'` label it composes the camera's own axes, turned in the element's plane by the label's `rotation` and scaled by the object's. That is what `CSS3DSprite` builds.

Both are twelve numbers, row by row, and both are plain world matrices. CSS's own conventions stay in the page. It turns the element's y axis over, because the page's y axis runs down. It builds the container's transform from the frame's camera and the canvas's CSS size. The camera record holds the view's rotation, the camera's position, half the view's height and the orthographic view's center. That is the least a page needs to build three.js's own strings.

Rejected:

- The page projecting a screen label's place into a matrix. A place has no turn, and the page has no lens.
- The sketch writing CSS strings. Each string allocates, and the sketch thread may not allocate per frame.
- The page reading the parity tables directly, for the reason [D-38](D-38-labels.md) gives: the sketch may write them while the page reads.

### A container that the engine makes, inside the element's parent

CSS reaches a 3D element through a parent that holds `perspective()` and the camera's transform. That parent passes 3D to its children with `transform-style: preserve-3d`. The engine makes the container on the first frame that shows a 3D label, inside the element's parent. It moves the element into it, as `CSS3DRenderer` moves an element into its camera element. The wrapper covers its parent and clips, so an element off the view costs nothing.

The engine leaves the pointer to the page's CSS. `CSS3DRenderer` sets `pointer-events: auto` on every element, which catches the pointer over a label that only shows text. A page that wants a clickable card sets that one property itself, and the mapping note says so.

### Hidden by the anchor, as the screen labels are

A 3D element hides by the same rules as a screen element. It hides when its object or an ancestor is hidden, or when the camera draws none of its layers. It also hides when its anchor lies outside the near and far planes. three.js's `CSS3DRenderer` keeps drawing an element behind the camera. Chrome draws it there, mirrored and enlarged. That is not what an author means by a label behind the viewpoint, so the engine hides it.

## Consequences

- `ui.trackLabel`'s `transform` and `rotation` options, `createEngine`'s `maxLabels3d` option, and the E1219 cases they add are public, on `api/ui`, `guides/ui-overlays`, `api/engine` and the mapping entry for `CSS3DRenderer`.
- The control buffer's label header holds each parity's camera, 57 words before the tables.
- The develop skill's recipe 7 shows a label that is a plane, and the 3D labels demo turns a ring of cards.
- `tests/image/labels-3d.spec.ts` compares an element's box with three.js's `CSS3DRenderer` and follows the frame on screen.
