---
id: api/reference/particles
title: "Particles (@null3d/particles): API reference"
status: generated
since: "0.2"
summary: "Every export of the Particles (@null3d/particles) API, from the engine's doc comments."
---

# Particles (@null3d/particles): API reference

> [Particles (@null3d/particles)](../particles.md) explains these exports. The engine's doc comments make this page.

## `createParticles`

```ts
function createParticles(context: SketchContext, options: ParticleSystemOptions): Promise<ParticleSystem>
```

Makes a particle system in the sketch's scene: an emitter, and the engine's particle buffer that it fills. Call the system's `update()` once per frame in `onLateUpdate`. The first system downloads the engine's particle code. Throws E1108 for a capacity out of range, and E1406 when the particle code does not download.

## `EmitterShape`

```ts
type EmitterShape =
	| { type: 'point'; }
	| { type: 'sphere'; radius: number; surface?: boolean; }
	| { type: 'cone'; radius: number; angle: number; }
	| { type: 'box'; size: Vec3Like; }
	| { type: 'disc'; radius: number; };
```

Where an emitter's particles are born, in its own space, and which way they set off. A `point` emits at the emitter, along `direction`. A `sphere` emits inside a ball of `radius`, or on its surface with `surface`, and sends particles outward. A `cone` emits on a disc of `radius` across the emitter's +y axis. It sends particles up within `angle` radians of that axis, as a fountain or a flame does. A `box` emits inside a box of `size`, centered on the emitter, along `direction`. A `disc` emits on a disc of `radius` across the +y axis, along `direction`.

## `ParticleBuffer`

Class `ParticleBuffer`.

A particle buffer: a scene object that draws a quad for each live particle record. The particles add-on's emitters write records into it. Write a particle's record once, when it is born, with `write`, or write a frame's births in one call with `writeRecords`. The GPU moves it and changes its look as it ages, as the buffer's values say. It stops drawing the particle at the end of its lifetime. Once per frame, write the buffer's time and the records the GPU reads into `frame`, and call `commit`. Every call takes typed arrays and whole numbers, so a frame's calls allocate nothing.

| Member | Description |
| --- | --- |
| `readonly capacity: number` | The particles that the buffer holds at once. |
| `readonly object: Mesh` | The buffer's scene object: place, turn, scale, layers, visibility and bounds. Moving it moves every particle with it, so emitters that leave particles behind keep it still. |
| `dropViews(): void` | Forgets the record and value arrays, which the next read makes again. |
| `write(index: number, record: ArrayLike<number>, seed: number): void` | Writes the record of particle `index`, from 0 to the capacity. `record` holds eight numbers: the birth place (x, y, z) in the space of the buffer's object, the birth time in the buffer's seconds, the velocity (x, y, z), and the lifetime in seconds. `seed`, from 0 to 65,535, picks the particle's random size, turn, spin, color and first frame. |
| `writeRecords(block: Float32Array, count: number, first: number): void` | Writes `count` records from a block of birth parameters, from record `first` on, in one call into the core, which packs them and marks the ranges it wrote. The block holds nine numbers for each birth, in the order that `write` takes them: the birth place, the birth time, the velocity, the lifetime, then the seed. Pass the whole block that the births fill, so the core's room for it stays the same from frame to frame. |
| `shiftRecords(from: number, to: number, seconds: number): void` | Takes whole `seconds` off the birth times of records `from` to `to`, which moves the time that they count from, and marks them. The GPU takes the shift off the birth times that the move has not reached. |
| `read(index: number, out: Float32Array): void` | Reads the record of particle `index` into `out`: its birth place and time, its velocity, its lifetime, as the GPU reads them, and its seed. |
| `readonly frame: Float32Array` | The frame's values, which the GPU reads in each frame: the buffer's time in seconds, which ages its particles, then how many records from the first the GPU reads, at most the capacity. Then a record and a number of seconds, which the GPU takes off the birth times of the records from that one up. An emitter that moves the time its birth times count from writes the shift there, and rewrites the records a share at a time, so no frame uploads them all. |
| `commit(): void` | Sends the records written since the last call to the GPU with the next frame. Call it once per frame. |
| `configureEmitter(options: ParticleEmitterOptions): void` | Gives the core the emitter's settings and starts its birth schedule, its time base and its events again. From then on the core writes every record that the emitter makes, so the sketch starts a frame and reads settings but runs no loop over the births. Call this once, before the first `emitFrame`. |
| `setEmitterFollow(last: Mat4Like, now: Mat4Like, toLocal: Mat4Like): void` | Places the followed object's world matrix in this frame and in the frame before, and this buffer's inverse world matrix, for the births that it follows. |
| `setEmitterEvents(world: Mat4Like, children: readonly Mat4Like[]): void` | Gives this buffer's world matrix and each sub-emitter's inverse world matrix for the frame's events, in the order that the sub-emitters were configured. |
| `emitFrame(numbers: Float64Array): void` | Emits the emitter's particles for one frame, fires the sub-emitters that fall due, and moves the time base when the time calls for it. The core writes the records, so this call runs no per-birth loop. Call it once per frame, after `numbers` holds the frame's start and end in seconds, its rate, and 1 or 0 for whether it emits and whether it is the first frame of a prewarmed system. The numbers cross in a typed array, so no fraction crosses as a call argument, which the browser would box. |
| `emitBurst(count: number, at?: Vec3Like, velocity?: Vec3Like): void` | Emits `count` particles at once, at the emitter, or at `at` in the buffer's space with the shape's spread around it. Each particle adds `velocity` to its own start velocity, in place of the emitter's `velocity` option. |
| `readonly emitted: number` | The particles that the emitter has made so far. |
| `set(values: ParticleValues): void` | Changes the values that `values` gives, from the next frame on; the rest keep theirs. |
| `setWind(field: ParticleWindField \| undefined, time: number): void` | Gives the buffer the field of air that moves its particles, or removes it, from the next frame on. Call it once per frame for a field, because the box follows the camera and the texture's newest layer moves. `time` is the sketch time, which the field's gust and swirl read. |
| `destroy(): void` | Removes the buffer and its object from the scene. It drops its views, so a destroyed buffer that the sketch still holds keeps none of the engine's memory, and its arrays throw at their next use. |

## `ParticleBufferOptions`

Interface `ParticleBufferOptions`, which extends `ParticleValues`.

Options of `scene.createParticleBuffer`.

| Member | Description |
| --- | --- |
| `capacity: number` | The most particles alive at once: the buffer's records, from 1 to 4,194,304. |
| `blending?: 'normal' \| 'additive'` | How the particles meet what lies behind them: `additive` adds their light, for fire, sparks and glows, and `normal` covers it, for smoke and leaves. The default is `additive`. |
| `map?: Texture` | A map whose color and alpha multiply each particle's, or a flipbook's frames with `flipbook`. Without one, each particle is a soft round dot. |
| `layers?: number` | The layers the particles draw on. The default is the default layer. |
| `windField?: ParticleWindField` | A field of air that moves the particles. Its local air replaces the fixed `wind`, so dust, motes, smoke and rain ride the same gusts as the plants around them. Give it again with `setWind` in each frame, because its box follows the camera. |

## `ParticleBurst`

Interface `ParticleBurst`.

A burst: `count` particles at once, at `time` seconds after the system starts, then every `interval` seconds, `cycles` times in all.

| Member | Description |
| --- | --- |
| `time: number` | Seconds after the system starts. |
| `count: number` | The particles of each burst. |
| `interval?: number` | Seconds between bursts. Without it, the burst happens once, or once per loop of a looping system. |
| `cycles?: number` | How many bursts, with `interval`. The default is no limit. |

## `ParticleEmitterBurst`

Interface `ParticleEmitterBurst`.

A burst of an emitter: `count` particles at once, at `time` seconds after the system starts, then every `interval` seconds, `cycles` times in all.

| Member | Description |
| --- | --- |
| `time: number` | Seconds after the system starts. |
| `count: number` | The particles of each burst. |
| `interval?: number` | Seconds between bursts. Without it, the burst happens once, or once per loop of a looping system. |
| `cycles?: number` | How many bursts, with `interval`. The default is no limit. |

## `ParticleEmitterOptions`

Interface `ParticleEmitterOptions`.

What an emitter writes, and the settings that the core keeps to write its births. The core makes a frame's records in one call from these numbers, so no per-birth loop runs in TypeScript.

| Member | Description |
| --- | --- |
| `seed?: number` | The seed of the emitter's random numbers. Emitters with the same seed emit the same particles. |
| `shape?: ParticleEmitterShape` | Where the particles are born. The default is a point. |
| `direction?: Vec3Like` | The way particles set off from a point, box or disc, in the emitter's space. The default is up. |
| `spread?: number` | How far from `direction` particles set off at random, in radians. The default is 0. |
| `speed?: readonly [number, number]` | The smallest and the largest start speed, in meters per second. The default is 1. |
| `velocity?: Vec3Like` | A velocity that every particle adds to its own at birth, in meters per second. |
| `lifetime?: readonly [number, number]` | The smallest and the largest lifetime, in seconds. The default is 1. |
| `bursts?: readonly ParticleEmitterBurst[]` | Bursts of particles at set times. |
| `duration?: number` | Seconds that the emitter emits for. With `loop`, it starts again after it; without, it stops. The default is no end. |
| `loop?: boolean` | True to start again after `duration`. The default is true. |
| `follow?: boolean` | True when particles move with a followed object, which `setEmitterFollow` places. |
| `subEmitters?: readonly ParticleEmitterSub[]` | Buffers that burst where this emitter's particles die or meet the ground. |

## `ParticleEmitterShape`

```ts
type ParticleEmitterShape =
	| { type: 'point'; }
	| { type: 'sphere'; radius: number; surface?: boolean; }
	| { type: 'cone'; radius: number; angle: number; }
	| { type: 'box'; size: Vec3Like; }
	| { type: 'disc'; radius: number; };
```

Where an emitter's particles are born, in its own space, and which way they set off. A `point` emits at the emitter, along `direction`. A `sphere` emits inside a ball of `radius`, or on its surface with `surface`, and sends particles outward. A `cone` emits on a disc of `radius` across the emitter's +y axis. It sends particles up within `angle` radians of that axis. A `box` emits inside a box of `size`, centered on the emitter, along `direction`. A `disc` emits on a disc of `radius` across the +y axis, along `direction`.

## `ParticleEmitterSub`

Interface `ParticleEmitterSub`.

A sub-emitter of an emitter: another particle buffer that bursts where a particle of this one dies or first meets the ground.

| Member | Description |
| --- | --- |
| `buffer: ParticleBuffer` | The buffer that bursts. |
| `on: 'death' \| 'ground'` | `death` at the end of the particle's life, or `ground` where it first meets the ground. |
| `count: number` | The particles of each burst. |
| `inheritVelocity?: number` | The share of the particle's velocity that the burst's particles take on. The default is 0. |

## `ParticleFacing`

```ts
type ParticleFacing = 'camera' | 'velocity' | 'ground' | 'tumble';
```

How the particles' quads turn. With `camera`, a quad faces the camera. With `velocity`, it lies along the particle's motion and stretches with its speed, as sparks and rain do. With `ground`, it lies flat on the object's ground plane, as ripples do. With `tumble`, it turns freely about an axis of its own, as leaves do.

## `ParticleFlipbook`

Interface `ParticleFlipbook`.

A flipbook: a grid of frames in the buffer's map, which each particle plays through.

| Member | Description |
| --- | --- |
| `columns: number` | The frames across the map. |
| `rows: number` | The frames down the map. Frame 0 is the top left one, and frames count along each row. |
| `frames?: number` | The frames to play, from 1 to columns times rows. The default is all of them. |
| `fps?: number` | Frames per second, or 0 to play the frames once over each particle's life. The default is 0. |
| `randomStart?: boolean` | True to start each particle on a random frame. The default is false. |
| `blend?: boolean` | True to blend each frame into the next, so slow flipbooks play smoothly. The default is true. |
| `hold?: boolean` | True to keep each particle on its first frame, so a flipbook of variants, such as leaves of several shapes, gives each particle one of them with `randomStart`. The default is false. |

## `ParticleGroundMode`

```ts
type ParticleGroundMode = 'kill' | 'bounce' | 'stick';
```

What the ground does to a particle that reaches it.

## `ParticleLook`

Interface `ParticleLook`.

How the particles of a buffer look. Colors take a hex string or number in sRGB, or three linear components from 0 to 1. Curves over life give values at even steps from birth to death, which the GPU reads with linear filtering. At most 16 steps keep their place, and a longer curve is resampled to 16.

| Member | Description |
| --- | --- |
| `size?: readonly [number, number]` | The smallest and the largest size at birth, in meters. Each particle takes a random one. |
| `aspect?: number` | The quad's height over its width. The default is 1. |
| `stretch?: number` | With the `velocity` facing, how much the speed lengthens the quad: the quad grows by the distance that the particle moves in this many seconds. The default is 0. |
| `rotation?: readonly [number, number]` | The smallest and the largest turn at birth, in radians. The default is none. |
| `spin?: readonly [number, number]` | The smallest and the largest spin, in radians per second. The default is none. |
| `facing?: ParticleFacing` | How the quads turn. The default is `camera`. |
| `colors?: ColorInput \| readonly [ColorInput, ColorInput]` | The color at birth, or two colors that each particle mixes by a random share. The default is white. |
| `colorOverLife?: readonly ColorInput[]` | A tint over life, which multiplies the birth color. The default is white throughout. |
| `alphaOverLife?: readonly number[]` | The alpha over life, from 0 to 1. The default is 1 throughout. |
| `sizeOverLife?: readonly number[]` | Size over life, steps that multiply the birth size. |
| `intensity?: number` | A factor on the color, above 1 for light that blooms. The default is 1. |
| `opacity?: number` | A factor on the alpha. The default is 1. |
| `alphaCutoff?: number` | The alpha below which a pixel draws nothing. The default is 0.002. |
| `flipbook?: ParticleFlipbook` | The flipbook of the buffer's map. The default plays its whole map as one frame. |
| `softness?: number` | The distance over which particles fade out where they near the surfaces behind them, in meters, so they do not cut lines into the ground or walls. 0 turns it off. The default is 0. |
| `nearFade?: number` | The distance from the camera inside which particles fade out, in meters, so one never fills the view. 0 turns it off. The default is 0. |

## `ParticleMotion`

Interface `ParticleMotion`.

How the particles of a buffer move: closed-form motion that the GPU works out at each particle's age. Every vector is in the space of the buffer's object.

| Member | Description |
| --- | --- |
| `gravity?: Vec3Like` | The acceleration of gravity, in meters per second squared. The default is none. |
| `drag?: number` | How fast the particles take on the wind's velocity, per second. 0 keeps their own; 2 loses most of the difference in about a second. The default is 0. |
| `wind?: Vec3Like` | The velocity that drag pulls the particles toward, in meters per second. The default is still air. A buffer with a `windField` uses the field's local air instead. |
| `turbulence?: number` | How far simplex noise moves each particle from its path, in meters. Each particle starts on its path and wanders as it ages. The default is 0, for none. |
| `turbulenceScale?: number` | The size of the turbulence's swirls, as a frequency in swirls per meter. The default is 1. |
| `turbulenceSpeed?: number` | How fast the turbulence changes along a particle's life, per second. The default is 1. |
| `groundHeight?: number` | A ground plane at this height, where the particles end, bounce or stop as `groundMode` says. The default is none. |
| `groundMode?: ParticleGroundMode` | What the ground does to a particle that reaches it: `kill` ends it, `bounce` bounces it up to twice and then stops it, and `stick` stops it. The default is `bounce`. |
| `restitution?: number` | The share of the speed off the ground that a bounce keeps, from 0 to 1. The default is 0.4. |
| `friction?: number` | The share of the speed along the ground that a bounce loses, from 0 to 1. The default is 0.2. |

## `ParticleRange`

```ts
type ParticleRange = number | readonly [number, number];
```

A number, or the smallest and the largest of a random number.

## `ParticleSystem`

Class `ParticleSystem`.

A particle system: an emitter that fills a particle buffer. `createParticles` makes one. Call `update()` once per frame, in `onLateUpdate`, where objects' world places are the frame's.

| Member | Description |
| --- | --- |
| `rate: number` | Particles born per second, which may change at any time. |
| `emitting: boolean` | False to stop emitting, as the rate and the bursts say; live particles live out their lives. |
| `time: number` | Seconds since the system started, as `update` adds them up. |
| `readonly buffer: ParticleBuffer` | The engine's particle buffer that the system fills, with its scene object. |
| `readonly object: Mesh` | The system's scene object: place, layers, visibility and bounds. |
| `set(values: ParticleValues): void` | Changes the motion and the look from the next frame on, as the options name them. |
| `update(dt?: number): void` | Moves the system on by the frame's step, or by `dt` seconds: emits the particles born in that time, fires the sub-emitters of particles that died or met the ground, and gives the buffer its time. The core writes the records in one call, so `update` runs no loop over the births. Call it once per frame in `onLateUpdate`. It allocates nothing. A system with a `windField` also gives the core the field's current box and layer, so call the wind's `update()` before this call. |
| `burst(count: number, at?: Vec3Like, velocity?: Vec3Like): void` | Emits `count` particles at once, at the emitter, or at `at` in the system's space with the shape's spread around it. Each particle adds `velocity` to its own start velocity, in place of the system's `velocity` option. The core writes the records. |
| `destroy(): void` | Removes the system and its particles from the scene. |

## `ParticleSystemOptions`

Interface `ParticleSystemOptions`, which extends `Omit`.

Options of `createParticles`: the emitter, then the engine's particle buffer options, which give the motion and the look.

| Member | Description |
| --- | --- |
| `capacity?: number` | The most particles alive at once. The default fits the rate and the bursts over the longest lifetime. A system past its capacity reuses the oldest particles' places. |
| `position?: Vec3Like` | Where the system sits in the world, or under `parent`. The default is the origin. |
| `parent?: Object3D` | The object that the system moves with, as a child of it. The default is the scene's root. |
| `follow?: Object3D` | An object to emit from, in place of the system's own place. Its particles stay in the world where they were born, so a moving emitter leaves a trail, as smoke from a torch does. Without it, particles move with the system's object. |
| `shape?: EmitterShape` | Where the particles are born. The default is a point. |
| `direction?: Vec3Like` | The way particles set off from a point, box or disc, in the emitter's space. The default is up. |
| `spread?: number` | How far from `direction` particles set off at random, in radians. The default is 0. |
| `speed?: ParticleRange` | The start speed, in meters per second. The default is 1. |
| `velocity?: Vec3Like` | A velocity that every particle adds to its own at birth, in meters per second. |
| `lifetime?: ParticleRange` | How long each particle lives, in seconds. The default is 1. |
| `rate?: number` | Particles born per second. The default is 0. |
| `bursts?: readonly ParticleBurst[]` | Bursts of particles at set times. |
| `duration?: number` | Seconds that the system emits for. With `loop`, it starts again after it; without, it stops. The default is no end. |
| `loop?: boolean` | True to start again after `duration`. The default is true. |
| `prewarm?: boolean` | True to start as if the system had run for its longest lifetime already. The default is false. |
| `subEmitters?: readonly SubEmitter[]` | Systems that burst where this system's particles die or meet the ground. |
| `seed?: number` | The seed of the system's random numbers. Systems with the same seed emit the same particles. |

## `ParticleTexture`

Interface `ParticleTexture`.

A particle texture made in code, and its flipbook, which `createParticles` takes in its options: `{ ...particleTextures.smoke(textures), ... }`.

| Member | Description |
| --- | --- |
| `map: Texture` | The texture: white or light shades, with alpha. |
| `flipbook: ParticleFlipbook` | Its frames. |

## `ParticleTextureOptions`

Interface `ParticleTextureOptions`.

Options of the particle textures made in code.

| Member | Description |
| --- | --- |
| `size?: number` | Texels along each side of one frame. The default suits the texture, from 32 to 64. |
| `seed?: number` | The seed of the texture's random shapes. The default is 1. |

## `particleTextures`

```ts
const particleTextures: { glow(textures: Textures, options?: ParticleTextureOptions): ParticleTexture; spark(textures: Textures, options?: ParticleTextureOptions): ParticleTexture; smoke(textures: Textures, options?: ParticleTextureOptions): ParticleTexture; flame(textures: Textures, options?: ParticleTextureOptions): ParticleTexture; rain(textures: Textures, options?: ParticleTextureOptions): ParticleTexture; leaves(textures: Textures, options?: ParticleTextureOptions): ParticleTexture; }
```

Particle textures made in code. Each takes the sketch's `textures` and returns a texture with its flipbook.

## `ParticleValues`

Interface `ParticleValues`, which extends `ParticleMotion`, `ParticleLook`.

The values of a particle buffer, which `set` changes at any time.

## `ParticleWindField`

Interface `ParticleWindField`.

A field of air that a buffer's particles sample: a texture of the air, the box that it covers, and the steady settings that a reader works out beyond the box. The wind add-on's field is one, and a page connects the two without either add-on importing the other.

| Member | Description |
| --- | --- |
| `readonly texture: Texture` | The field's texture, whose `layer` names the newest state. |
| `readonly origin: readonly [number, number]` | The box's near corner across the ground, in meters: x and z. |
| `readonly size: number` | The box's width across the ground, in meters, or 0 for the steady field everywhere. |
| `readonly air: { readonly base: readonly number[]; readonly gust: readonly number[]; readonly swirl: readonly number[]; readonly sent: readonly number[]; }` | The air's steady settings: the base wind, the gust, the swirl and the gust a page sent. |

## `SubEmitter`

Interface `SubEmitter`.

A sub-emitter: another system that bursts where a particle of this system dies or first meets the ground. A firework's rocket bursts into sparks this way, and a raindrop splashes.

| Member | Description |
| --- | --- |
| `system: ParticleSystem` | The system that bursts. |
| `on: 'death' \| 'ground'` | `death` at the end of the particle's life, or `ground` where it first meets the ground. |
| `count: number` | The particles of each burst. |
| `inheritVelocity?: number` | The share of the particle's velocity that the burst's particles take on. The default is 0. |
