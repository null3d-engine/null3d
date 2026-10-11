// The texture generators of both GPU paths, which the thread that draws imports with the first
// generator that a sketch asks for: environment maps, and the filters of reflection probes' maps.
// The environment's steps are shared by both paths, so one file holds both paths' code, and the
// shader text of the device's path comes in files of their own.

export { environmentGenerator as webgl2EnvironmentGenerator } from './webgl2/environment';
export { probeFilter as webgl2ProbeFilter } from './webgl2/probes';
export { environmentGenerator as webgpuEnvironmentGenerator } from './webgpu/environment';
export { probeFilter as webgpuProbeFilter } from './webgpu/probes';
