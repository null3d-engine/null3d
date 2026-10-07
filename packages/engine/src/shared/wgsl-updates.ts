// Hot updates of a project's WGSL on the dev server. The null3D Vite plugin gives the WGSL of each
// `.wgsl` file and tagged template literal a key, and when only that WGSL changes, it sends the
// new compiled WGSL to the page under the key. The plugin's client module on the page fires an
// event with the updates on the page's global object. Each engine on the page hands them to the
// thread that runs its sketch, whose materials swap the shader of every custom material made
// from WGSL under one of the keys. The file imports nothing, so the plugin's tests read it too.

/** The event on the page's global object that carries the hot updates of WGSL. */
export const WGSL_UPDATE_EVENT = 'null3d:wgsl';

/** One hot update: the new compiled WGSL under its key, as `CompiledWgsl` describes it. */
export interface WgslUpdate {
	readonly key: string;
	readonly shader: { readonly kind: 'material' | 'shader' };
}
