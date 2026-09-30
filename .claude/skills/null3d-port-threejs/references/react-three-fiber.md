# Porting React Three Fiber and drei

React Three Fiber (R3F) describes a three.js scene as React components that run on the main thread. In null3D the scene lives in `sketch.ts` in a worker, and React keeps doing what it does best: the page UI. The port moves the component tree into imperative sketch code and connects React to the sketch with messages. Engine docs: `porting/react-three-fiber`, `api/page`, `guides/ui-overlays`.

## Contents

1. The target shape
2. A React wrapper for null3D
3. State between React and the sketch
4. R3F and drei mapping
5. Step by step

## 1. The target shape

```
React app (page)                                 sketch.ts (sketch worker)
----------------                                 -------------------------
<Configurator> UI, forms, menus    --messages--> scene setup and onUpdate
<FourView sketch={sketchUrl} />                  the former <Canvas> contents
labels bound with engine.labels (0.2)            ui.trackLabel for former <Html> elements (0.2)
```

The React tree above the former `<Canvas>` barely changes. The subtree inside `<Canvas>` becomes `sketch.ts`.

## 2. A React wrapper for null3D

The wrapper keeps one engine per sketch while the app shows other views. Leaving the view detaches the canvas and pauses the engine; coming back attaches it again, with no new start.

```tsx
import { useEffect, useRef } from 'react';
import { createEngine, type Engine } from '@null3d/engine';

type Props = {
  sketch: URL;
  onMessage?: (type: string, data: unknown) => void;
  onReady?: (engine: Engine) => void;
};

/** How long an engine waits off the page before the wrapper destroys it. */
const KEEP_MS = 60_000;

type Kept = { canvas: HTMLCanvasElement; engine: Promise<Engine>; timer?: number };
const kept = new Map<string, Kept>();

function keptEngine(sketch: URL): Kept {
  let entry = kept.get(sketch.href);
  if (!entry) {
    // A canvas can be handed to a worker only once, so the kept engine owns its canvas.
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:100%;height:100%;display:block';
    entry = { canvas, engine: createEngine({ canvas, sketch }) };
    entry.engine.catch(() => kept.delete(sketch.href));
    kept.set(sketch.href, entry);
  }
  clearTimeout(entry.timer);
  return entry;
}

export function FourView({ sketch, onMessage, onReady }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    const host = hostRef.current!;
    const entry = keptEngine(sketch);
    let mounted = true;
    let off: (() => void) | undefined;
    host.append(entry.canvas);
    entry.engine.then(
      (engine) => {
        if (!mounted) return;
        engine.attach(host);
        off = engine.onSketchMessage((type, data) => onMessageRef.current?.(type, data));
        onReady?.(engine);
      },
      (error) => console.error(error),
    );
    return () => {
      mounted = false;
      off?.();
      entry.engine.then((engine) => engine.detach(), () => {});
      entry.timer = window.setTimeout(() => {
        kept.delete(sketch.href);
        entry.engine.then((engine) => engine.destroy(), () => {});
      }, KEEP_MS);
    };
  }, [sketch]);

  return <div ref={hostRef} style={{ width: '100%', height: '100%' }} />;
}
```

- Create `sketch` once at module level (`const sketchUrl = new URL('./sketch.ts', import.meta.url)`), so re-renders do not restart the engine.
- React's StrictMode mounts effects twice in development. The second mount finds the kept engine and attaches it, so development starts one engine, as production does.
- Each mount adds its own message handler and removes it on unmount, so an old component never hears the sketch.
- A kept engine holds its memory and GPU buffers. For a view the app shows once, destroy the engine on unmount instead of keeping it.

## 3. State between React and the sketch

React to sketch, on change:

```tsx
const [color, setColor] = useState('#c0392b');
const engineRef = useRef<Engine>();
useEffect(() => { engineRef.current?.postToSketch('config', { color }); }, [color]);
// <FourView sketch={sketchUrl} onReady={(e) => { engineRef.current = e; e.postToSketch('config', { color }); }} />
```

Sketch to React, on events:

```ts
// sketch.ts
page.onMessage((type, data) => { if (type === 'config') bodyMaterial.set({ color: data.color }); });
shoe.on('click', () => page.post('part-selected', { name: 'sole' }));   // (0.2)
```

```tsx
<FourView sketch={sketchUrl} onMessage={(type, data) => { if (type === 'part-selected') setSelected(data.name); }} />
```

Never mirror per-frame scene state into React state: it re-renders React every frame, on the main thread.

## 4. R3F and drei mapping

| R3F or drei | null3D |
| --- | --- |
| `<Canvas camera={{ position, fov }}>` | `scene.createPerspectiveCamera({ position, fov })` in `sketch.ts` |
| `<Canvas dpr={[1, 2]}>` | `createEngine({ maxPixelRatio: 2 })`, or leave it out and the quality preset sets the cap |
| `<Canvas shadows>` | `castShadows` on lights and meshes, `receiveShadows` on receivers; shadows draw later in 0.1 |
| `<Canvas gl={{ antialias, alpha }}>` | Every tier draws with MSAA; `alpha` becomes `createEngine({ transparent: true })` |
| `<Canvas frameloop="demand">` | No on-demand mode in 1.0: pause with `engine.setPaused(true)` while nothing changes |
| `<mesh>` with `<boxGeometry>` and `<meshStandardMaterial>` | `scene.createMesh({ mesh: geometry.box(...), material: materials.standard(...) })` |
| `<group>` | `scene.createGroup()` and `setParent` |
| `<primitive object={gltf.scene} />` | `scene.instantiate(prefab)` (0.2) |
| `useFrame((state, delta) => ...)` | `onUpdate(dt)` |
| `useThree()` (camera, size, viewport) | The context: `scene`, `ctx.engine.viewport` |
| `useLoader(GLTFLoader, url)`, drei `useGLTF(url)` | `await assets.loadGltf(url)` (0.2) |
| `useGLTF.preload(url)`, `<Preload all />` | `assets.preload([...])` and `scene.warmUp()` |
| `<Suspense fallback>`, drei `<Loader>`, `useProgress` | `assets.onProgress` plus a `'loading'` message; the page shows the loader |
| drei `useAnimations(animations, ref)` | `obj.animator()` (0.2) |
| drei `<OrbitControls makeDefault />` | `createOrbitControls(ctx, camera, options)` |
| drei `<Environment preset="studio" />` | `scene.setEnvironment(assets.builtinEnvironment('studio'))` (0.2); other presets: `bunx @null3d/cli assets env` from an HDR file (0.2) |
| drei `<Environment files="x.hdr" background />` | `bunx @null3d/cli assets env x.hdr`, then `setEnvironment` and `setBackground` (0.2) |
| drei `<ContactShadows />` | `materials.shadowCatcher` on a ground plane (0.2); softer, blurred contact shadows are not built in |
| drei `<Html>` | `ui.trackLabel` in the sketch, `engine.labels.bind` on the page, with the HTML rendered by React (0.2) |
| drei `<Text>`, `<Text3D>` | Not in 1.0: HTML labels, a text texture, or a text mesh baked into glTF |
| drei `<Instances>`, `<Instance>`, `<Merged>` | `scene.createInstances` |
| drei `<Sky>` | `scene.setBackground({ sky: { ... } })` (0.2) |
| drei `<Stars>` | `scene.createPoints` (0.2) |
| drei `<Float>` | A sine offset in `onUpdate` |
| drei `<Center>`, `<Bounds>` | `prefab.bounds` (0.2) and a camera fit computed at setup |
| drei `<PerformanceMonitor>`, `<AdaptiveDpr>` | `quality.onChange`; dynamic resolution comes later in 0.1 |
| drei `<Stats>` | `engine.measure()` on the page; the overlay `debug.stats(true)` comes later in 0.1 |
| Mesh events: `onClick`, `onPointerOver`, `onPointerOut` | `obj.on('click' | 'pointerenter' | 'pointerleave', fn)` (0.2), then `page.post` if React needs to know |
| `@react-three/postprocessing` `<EffectComposer>` with `<Bloom>` and others | `post.set`: tone mapping now, bloom and other effects in 0.2 (`references/post-processing.md`) |
| `@react-three/rapier` | Rapier inside the sketch worker (null3d-develop recipe 11) |
| Components that change props every frame through React state | `onUpdate` logic; React sends intent, not frames |

## 5. Step by step

1. Draw the scene tree: list every component inside `<Canvas>` with its props, and mark which props come from React state.
2. Write `sketch.ts` that creates the same objects at setup. Props that React changes become `page.onMessage` handlers.
3. Move `useFrame` bodies into `onUpdate`, turning refs into handles or batch rows.
4. Replace `<Canvas>` with `<FourView>`.
5. Route events: mesh events become `obj.on(...)` (0.2) in the sketch plus `page.post` to React.
6. Replace `<Html>` elements with tracked labels (0.2), rendered by React on the page.
7. Compare parity images per camera view, then measure performance (`references/verification.md`).
