// The shader files that a sketch will need, asked for early. A feature's shader builds load on
// first use (decision record D-56). The scene asks for a feature's file as soon as it knows that
// the sketch will use the feature: when a glTF file with skins loads, when the first sprite or line
// batch is made, when bloom or ambient occlusion turns on. The thread that draws then downloads
// the file while the sketch builds the objects, so they wait less for their pipelines.

import type { ShaderFeature } from '../generated/shader-features';
import type { PreloadSender } from '../shared/images';

/** Asks the thread that draws for the shader files of the features that the sketch will use. */
export class ShaderPreloads {
	private readonly asked = new Set<string>();

	constructor(private readonly send: PreloadSender = () => {}) {}

	/**
	 * Asks for the shader file of `feature`, once. It allocates nothing for a feature it asked for
	 * before, so a call that runs every frame may make it.
	 */
	need(feature: ShaderFeature): void {
		if (this.asked.has(feature)) return;
		this.asked.add(feature);
		this.send([feature]);
	}

	/**
	 * Asks for the shader files of `features`, once each. A loader that knows what an asset needs,
	 * such as the list of features that the asset tool records with a file, gives it here.
	 */
	needAll(features: Iterable<ShaderFeature>): void {
		for (const feature of features) this.need(feature);
	}
}
