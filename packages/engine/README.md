# null3D

The engine package of [null3D](https://github.com/null3d-engine/null3d), a browser 3D engine for games and apps with many moving objects.

The engine's core is Rust compiled to WebAssembly. It runs on worker threads, so the page's main thread stays free for the page. It draws with WebGPU, and with WebGL2 where WebGPU is missing, from the same code. You write your scenes in TypeScript.

null3D is experimental: the API can still change between versions until 1.0.

## Start a project

The command line tool writes a new project with everything below. It needs [Bun](https://bun.sh/) 1.4.3 or newer:

```sh
bunx @null3d/cli create my-game
cd my-game
bun install
bunx vite
```

## Add it to a Vite project

```sh
bun add @null3d/engine
bun add -d vite @null3d/vite-plugin
```

Every Vite build of a null3D project needs the plugin. It sends the two headers that worker threads need, and it compiles your sketch and your shaders:

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import null3d from '@null3d/vite-plugin';

export default defineConfig({ plugins: [null3d()] });
```

The page, `index.html`, needs a canvas and the page module:

```html
<!doctype html>
<style>
  html, body { margin: 0; height: 100%; }
  canvas { display: block; width: 100%; height: 100%; }
</style>
<canvas></canvas>
<script type="module" src="./page.ts"></script>
```

The page module starts the engine on the page's main thread:

```ts
// page.ts
import { createEngine } from '@null3d/engine';

const engine = await createEngine({
  canvas: document.querySelector('canvas')!,
  sketch: new URL('./sketch.ts', import.meta.url),
});
await engine.firstFrame;
```

In null3D, a 3D scene is called a sketch. A sketch builds its scene and updates it every frame, in a worker of its own:

```ts
// sketch.ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, geometry, materials }) => {
  const camera = scene.createPerspectiveCamera({ fov: 60, position: [0, 1.5, 4], target: [0, 0, 0] });
  scene.setActiveCamera(camera);
  scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 });

  const cube = scene.createMesh({
    mesh: geometry.box({ width: 1, height: 1, depth: 1 }),
    material: materials.standard({ color: '#4a8cff' }),
    dynamic: true, // it moves every frame
  });

  let angle = 0;
  return {
    onUpdate(dt) {
      angle += dt * 0.8;
      cube.setRotationEuler(0, angle, 0);
    },
  };
});
```

Run `bunx vite` and open the page. A blue cube turns in the light.

## Where it runs

- WebGPU in Chrome and Edge 113+, Safari 26, and Firefox 141+ on Windows. Chrome 121+ on Android 12+ gets it with ARM, Qualcomm or Intel GPUs.
- WebGL2 in older browsers down to Safari 18, Chrome and Edge 91, and Firefox 89, and on devices without WebGPU.
- Worker threads need two HTTP headers on your page. Without them, null3D runs on one thread.
- WebGPU needs a secure page: HTTPS, or localhost.

[Hosting and cross-origin isolation](https://github.com/null3d-engine/null3d/blob/generated/docs/getting-started/hosting.md) shows the headers for common hosts.

## Docs

The package holds the docs for its own version, in `docs/`. An agent can read them there, by page ID, such as `concepts/architecture`. The same pages are on [GitHub](https://github.com/null3d-engine/null3d/blob/generated/docs/index.md).

The [project's README](https://github.com/null3d-engine/null3d#readme) lists the add-on packages, such as water, terrain, grass and particles, and the benchmarks against three.js.

## License

Licensed under either of the Apache License 2.0 or the MIT license, at your option.
