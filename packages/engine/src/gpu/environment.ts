// The texture generators of both GPU paths, which the thread that draws imports with the first
// generator that a sketch asks for. They share the steps of environment-steps.ts, so one file holds
// both paths' code, and the shader text of the device's path comes in a file of its own.

export { environmentGenerator as webgl2EnvironmentGenerator } from './webgl2/environment';
export { environmentGenerator as webgpuEnvironmentGenerator } from './webgpu/environment';
