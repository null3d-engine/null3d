// The names that a browser reports for a device that draws on the CPU. Rule 14 of AGENTS.md reads
// no browser or GPU name, with one exception: a software renderer, which the adapter's reported
// description names. It keeps the engine's current draw path (D-174), and it keeps the whole render
// scale once a step below it failed, since its upscale costs about what the smaller scene saves
// (D-237).

/** The words of a reported name that mark drawing on the CPU, as on a machine without a GPU. */
const SOFTWARE = /swiftshader|llvmpipe|softpipe|basic render driver|software/i;

/** True when any of the device's reported names says that the browser draws on the CPU. */
export function softwareRendererName(...names: (string | null | undefined)[]): boolean {
	for (const name of names)
		if (name !== null && name !== undefined && SOFTWARE.test(name)) return true;
	return false;
}

/**
 * The device names that a capability report holds, which a software renderer is read from: the
 * WebGPU adapter's, or the WebGL2 context's renderer.
 */
export interface DeviceNames {
	webgpu: {
		adapterInfo?: {
			vendor: string;
			architecture: string;
			device: string;
			description: string;
		} | null;
	};
	webgl2: { renderer?: string | null };
}

/**
 * True when the device's reported names say that the browser draws on the CPU. A software renderer
 * keeps the engine's current draw path, and the whole render scale once a step below it failed.
 */
export function softwareRenderer(report: DeviceNames): boolean {
	const info = report.webgpu.adapterInfo;
	return softwareRendererName(
		info?.vendor,
		info?.architecture,
		info?.device,
		info?.description,
		report.webgl2.renderer,
	);
}
