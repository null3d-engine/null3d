// GPU particle systems for null3D sketches: emitters with shapes, rates, bursts and sub-emitters
// that fill the engine's particle buffers, and particle textures made in code. The GPU moves each
// particle in closed form, so no pass simulates them, and the same systems run on WebGPU and WebGL2.

export type {
	EmitterShape,
	ParticleBurst,
	ParticleRange,
	ParticleSystemOptions,
	SubEmitter,
} from './system';
export { createParticles, ParticleSystem } from './system';
export type { ParticleTexture, ParticleTextureOptions } from './textures';
export { particleTextures } from './textures';
