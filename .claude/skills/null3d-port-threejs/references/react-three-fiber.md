# Porting React Three Fiber and drei

React Three Fiber (R3F) describes a three.js scene as React components that run on the main thread. In null3d the scene lives in `game.ts` in a worker, and React keeps doing what it does best: the page UI. The port moves the component tree into imperative game code and connects React to the game with messages. Engine docs: `porting/react-three-fiber`, `api/page`, `guides/ui-overlays`.

## Contents

1. The target shape
2. A React wrapper for null3d
3. State between React and the game
4. R3F and drei mapping
5. Step by step

## 1. The target shape

```
React app (page)                                 game.ts (game worker)
----------------                                 ---------------------
<Configurator> UI, forms, menus    --messages--> scene setup and onUpdate
<FourView game={gameUrl} />                      the former <Canvas> contents
labels bound with engine.labels                  ui.trackLabel for former <Html> elements
```

The React tree above the former `<Canvas>` barely changes. The subtree inside `<Canvas>` becomes `game.ts`.

## 2. A React wrapper for null3d

```tsx
import { useEffect, useRef } from 'react';
import { createEngine, type Engine } from '@null3d/engine';

type Props = {
  game: URL;
  onMessage?: (type: string, data: unknown) => void;
  onReady?: (engine: Engine) => void;
};

export function FourView({ game, onMessage, onReady }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    // A canvas can be handed to a worker only once, and React's StrictMode mounts effects twice
    // in development, so each mount creates its own canvas.
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:100%;height:100%;display:block';
    hostRef.current!.appendChild(canvas);
    let engine: Engine | undefined;
    let disposed = false;
    createEngine({ canvas, game }).then((e) => {
      if (disposed) { e.destroy(); return; }
      engine = e;
      e.onGameMessage((type, data) => onMessageRef.current?.(type, data));
      onReady?.(e);
    });
    return () => { disposed = true; engine?.destroy(); canvas.remove(); };
  }, [game]);

  return <div ref={hostRef} style={{ width: '100%', height: '100%' }} />;
}
```

Create `game` once at module level (`const gameUrl = new URL('./game.ts', import.meta.url)`), so re-renders do not restart the engine.

## 3. State between React and the game

React to game, on change:

```tsx
const [color, setColor] = useState('#c0392b');
const engineRef = useRef<Engine>();
useEffect(() => { engineRef.current?.postToGame('config', { color }); }, [color]);
// <FourView game={gameUrl} onReady={(e) => { engineRef.current = e; e.postToGame('config', { color }); }} />
```

Game to React, on events:

```ts
// game.ts
page.onMessage((type, data) => { if (type === 'config') bodyMaterial.set({ color: data.color }); });
shoe.on('click', () => page.post('part-selected', { name: 'sole' }));   // (0.2)
```

```tsx
<FourView game={gameUrl} onMessage={(type, data) => { if (type === 'part-selected') setSelected(data.name); }} />
```

Never mirror per-frame scene state into React state: it re-renders React every frame, on the main thread.

## 4. R3F and drei mapping

| R3F or drei | null3d |
| --- | --- |
| `<Canvas camera={{ position, fov }}>` | `scene.createPerspectiveCamera({ position, fov })` in `game.ts` |
| `<Canvas dpr={[1, 2]}>` | `createEngine({ maxPixelRatio: 2 })`; presets and dynamic resolution handle the rest |
| `<Canvas shadows>` | `castShadows` on lights and meshes, `receiveShadows` on receivers |
| `<Canvas gl={{ antialias, alpha }}>` | Presets (MSAA), `createEngine({ transparent: true })` |
| `<Canvas frameloop="demand">` | No on-demand mode in 1.0: pause with `engine.setPaused(true)` while nothing changes, or use the battery-saver 30 fps cap |
| `<mesh>` with `<boxGeometry>` and `<meshStandardMaterial>` | `scene.createMesh({ mesh: geometry.box(...), material: materials.standard(...) })` |
| `<group>` | `scene.createGroup()` and `setParent` |
| `<primitive object={gltf.scene} />` | `scene.instantiate(prefab)` |
| `useFrame((state, delta) => ...)` | `onUpdate(dt)` |
| `useThree()` (camera, size, viewport) | The context: `scene`, `ctx.engine.viewport` |
| `useLoader(GLTFLoader, url)`, drei `useGLTF(url)` | `await assets.loadGltf(url)` (0.2) |
| `useGLTF.preload(url)`, `<Preload all />` | `assets.preload([...])` and `scene.warmUp()` |
| `<Suspense fallback>`, drei `<Loader>`, `useProgress` | `assets.onProgress` plus a `'loading'` message; the page shows the loader |
| drei `useAnimations(animations, ref)` | `obj.animator()` (0.2) |
| drei `<OrbitControls makeDefault />` | `createOrbitControls(ctx, camera, options)` |
| drei `<Environment preset="studio" />` | `scene.setEnvironment(assets.builtinEnvironment('studio'))`; other presets: `null3d assets env` from an HDR file |
| drei `<Environment files="x.hdr" background />` | `null3d assets env x.hdr`, then `setEnvironment` and `setBackground` |
| drei `<ContactShadows />` | `materials.shadowCatcher` on a ground plane (0.2); softer, blurred contact shadows are not built in |
| drei `<Html>` | `ui.trackLabel` in the game, `engine.labels.bind` on the page, with the HTML rendered by React (0.2) |
| drei `<Text>`, `<Text3D>` | Not in 1.0: HTML labels, a text texture, or a text mesh baked into glTF |
| drei `<Instances>`, `<Instance>`, `<Merged>` | `scene.createInstances` |
| drei `<Sky>` | `scene.setBackground({ sky: { ... } })` (0.2) |
| drei `<Stars>` | `scene.createPoints` (0.2) |
| drei `<Float>` | A sine offset in `onUpdate` |
| drei `<Center>`, `<Bounds>` | `prefab.bounds` and a camera fit computed at setup |
| drei `<PerformanceMonitor>`, `<AdaptiveDpr>` | `quality.onChange`; dynamic resolution is built in |
| drei `<Stats>` | `debug.stats(true)` |
| Mesh events: `onClick`, `onPointerOver`, `onPointerOut` | `obj.on('click' | 'pointerenter' | 'pointerleave', fn)` (0.2), then `page.post` if React needs to know |
| `@react-three/postprocessing` `<EffectComposer>` with `<Bloom>` and others | `post.set` (`references/post-processing.md`) |
| `@react-three/rapier` | Rapier inside the game worker (null3d-develop recipe 11) |
| Components that change props every frame through React state | `onUpdate` logic; React sends intent, not frames |

## 5. Step by step

1. Draw the scene tree: list every component inside `<Canvas>` with its props, and mark which props come from React state.
2. Write `game.ts` that creates the same objects at setup. Props that React changes become `page.onMessage` handlers.
3. Move `useFrame` bodies into `onUpdate`, turning refs into handles or batch rows.
4. Replace `<Canvas>` with `<FourView>`.
5. Route events: mesh events become `obj.on(...)` in the game plus `page.post` to React.
6. Replace `<Html>` elements with tracked labels, rendered by React on the page.
7. Compare parity images per camera view, then measure performance (`references/verification.md`).
