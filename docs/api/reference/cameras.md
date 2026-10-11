---
id: api/reference/cameras
title: "Cameras: API reference"
status: generated
since: "0.1"
summary: "Every export of the Cameras API, from the engine's doc comments."
---

# Cameras: API reference

> [Cameras](../cameras.md) explains these exports. The engine's doc comments make this page.

## `Camera`

Class `Camera`, which extends `Object3D`.

An object that the scene can be drawn from. `scene.setActiveCamera` picks the camera that the canvas shows. A camera is a `PerspectiveCamera` or an `OrthographicCamera`, and `isOrthographic` tells them apart.

| Member | Description |
| --- | --- |
| `readonly isOrthographic: boolean` | True for an `OrthographicCamera`, false for a `PerspectiveCamera`. |
| `readonly near: number` | The distance to the near clipping plane. |
| `readonly far: number` | The distance to the far clipping plane. |
| `setLayers(mask: number): void` | Sets the layers the camera draws, as a 32-bit mask: it draws the objects whose masks share a layer with it. The default, 1, draws layer 0, where every object starts. |
| `setNearFar(near: number, far: number): void` | Sets the distances to the near and far clipping planes. |
| `screenToRay(x: number, y: number, out: Ray): void` | Writes the ray from the camera through a point on the canvas into `out`: `x` and `y` are CSS pixels from the canvas's top-left corner, as `input.pointer` gives them. A perspective ray starts at the camera, and an orthographic ray on the near plane. The direction has length 1. When the point is the position of the pointer or a finger from `input`, the ray uses the camera of the frame that was on screen at that event, if the engine still keeps it. It keeps the last four views, and frames in a row with the same view count as one. So a click during a fast pan picks what the user saw. Any other point uses the camera of the frame that last ran, with its lens as it is now. Objects stay where they are now, so a moving object can be up to a frame of its motion away from where the user saw it. |
| `worldToScreen(point: Vec3Like, out: Vec3Like): void` | Writes where a point in the world lies on the canvas into `out`: x and y in CSS pixels from the canvas's top-left corner, then the point's depth, its distance in front of the camera along the view. A depth below 0 puts the point behind the camera, where x and y have no meaning. It uses the camera of the frame that last ran, with its lens as it is now, so in `onLateUpdate` it places points where the frame draws them. |

## `CameraOptions`

Interface `CameraOptions`, which extends `NodeOptions`.

Options that both kinds of camera take.

| Member | Description |
| --- | --- |
| `near?: number` | The distance to the near clipping plane. The default is 0.1. |
| `far?: number` | The distance to the far clipping plane. The default is 2000. |
| `target?: Vec3` | A point the camera turns toward. |

## `OrthographicCamera`

Class `OrthographicCamera`, which extends `Camera`.

A camera whose view is a box: things keep their size at every distance, as in maps and isometric games.

| Member | Description |
| --- | --- |
| `readonly isOrthographic: true` | True: an orthographic camera. |
| `readonly height: number` | The view's height in world units. |
| `readonly width: number \| undefined` | The view's width in world units, or undefined when the width follows the canvas's aspect ratio. |
| `setOrthoHeight(height: number): void` | Sets the view's height in world units. A width that follows the canvas keeps following it. A view made from four edges scales about its center and keeps its shape, as three.js's `zoom` scales it. |

## `OrthographicCameraOptions`

Interface `OrthographicCameraOptions`, which extends `CameraOptions`.

Options for `scene.createOrthographicCamera`. Give `height`, and the width follows the canvas's aspect ratio. Or give all four edges, as three.js's `OrthographicCamera` takes them, for a view that keeps its shape on any canvas.

| Member | Description |
| --- | --- |
| `height?: number` | The view's height in world units. The default is 2. Leave it out when you give the edges. |
| `left?: number` | The view's left edge, in world units from the camera's axis. |
| `right?: number` | The view's right edge, in world units from the camera's axis. |
| `top?: number` | The view's top edge, in world units from the camera's axis. |
| `bottom?: number` | The view's bottom edge, in world units from the camera's axis. |

## `PerspectiveCamera`

Class `PerspectiveCamera`, which extends `Camera`.

A camera that shows near things larger than far things, as the eye does.

| Member | Description |
| --- | --- |
| `readonly isOrthographic: false` | False: a perspective camera. |
| `readonly fov: number` | The vertical field of view in degrees. |
| `setFov(degrees: number): void` | Sets the vertical field of view in degrees. |
| `readonly focalLength: number` | The focal length in millimetres of a lens with this field of view on a full-frame sensor, 24 mm tall. The default field of view of 50 degrees is about 25.7 mm. |
| `setFocalLength(millimetres: number): void` | Sets the field of view of a lens of `millimetres` on a full-frame sensor, 24 mm tall, as a photographer picks a lens: 24 is wide, 50 normal and 85 a portrait lens. Depth of field takes the same focal length unless its settings give another. Throws E1108 for a length that is not above 0. |

## `PerspectiveCameraOptions`

Interface `PerspectiveCameraOptions`, which extends `CameraOptions`.

Options for `scene.createPerspectiveCamera`.

| Member | Description |
| --- | --- |
| `fov?: number` | The vertical field of view in degrees. The default is 50. |

## `Ray`

Interface `Ray`.

A ray: a start point and a direction of length 1, in world space.

| Member | Description |
| --- | --- |
| `origin: Vec3Like` | The point the ray starts from. |
| `direction: Vec3Like` | The direction the ray points in, with length 1. |
