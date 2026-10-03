// Types for the modules that the null3D Vite plugin makes. A project adds them with
// `/// <reference types="@null3d/vite-plugin/client" />`, or with `@null3d/vite-plugin/client` in
// the `types` of its tsconfig.json.

declare module '*.wgsl' {
	/** The WGSL file, compiled for WebGPU and WebGL2: a whole shader, or a custom material. */
	const shader: import('./shader-types').CompiledWgsl;
	export default shader;
}
