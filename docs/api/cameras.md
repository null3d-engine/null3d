---
id: api/cameras
title: Cameras
status: planned
since: "0.1"
summary: "Perspective and orthographic cameras; screenToRay; worldToScreen; layers."
---

<!-- sokko3d:placeholder -->

# Cameras

> Planned for sokko3d 0.1. No release has these APIs yet, so coding agents must not use them. The reference below lists what the engine in this repository has so far, and the rest of the page is not written yet.

This page will cover: Perspective and orthographic cameras; screenToRay; worldToScreen; layers.

## API reference

This reference is generated from the TSDoc comments in `packages/engine/src`. To change it, edit the comments.

### `Camera`

Class `Camera`, which extends `Object3D`.

A perspective camera. Make it the scene's view with `scene.setActiveCamera`.

| Member | Description |
| --- | --- |
| `setFov(degrees: number): void` | Sets the vertical field of view in degrees. |
| `setNearFar(near: number, far: number): void` | Sets the distances to the near and far clipping planes. |

### `CameraOptions`

Interface `CameraOptions`, which extends `NodeOptions`.

Options for `scene.createPerspectiveCamera`.

| Member | Description |
| --- | --- |
| `fov?: number` | The vertical field of view in degrees. The default is 50. |
| `near?: number` | The distance to the near clipping plane. The default is 0.1. |
| `far?: number` | The distance to the far clipping plane. The default is 2000. |
| `target?: Vec3` | A point the camera turns toward. |
