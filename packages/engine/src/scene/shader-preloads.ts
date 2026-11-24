// The shader files that a sketch will need, asked for early. A feature's shader builds load on
// first use (decision record D-56). The scene asks for a feature's file as soon as it knows that
// the sketch will use the feature: when a glTF file with skins loads, when the first sprite or line
// batch is made, when bloom or ambient occlusion turns on. The thread that draws then downloads
// the file while the sketch builds the objects, so they wait less for their pipelines.

import { FORMAT_CANVAS } from '../generated/gpu';
import { SHADER_FEATURES, type ShaderFeature } from '../generated/shader-features';
import type { CoreDevice } from '../page/limits';
import type { QualitySettings } from '../quality/presets';
import { GENERATORS_PRELOAD, type PreloadSender } from '../shared/images';
import type { Tier } from '../shared/tier';

/**
 * What decides the passes that the device and the preset draw over a scene's opaque objects, and
 * the sky's cloud tier: the GPU path, the device, and the quality settings as they stand.
 */
export interface PassFacts {
	tier: Tier;
	device: Pick<CoreDevice, 'gpuOcclusion' | 'directDraws' | 'sceneColor'>;
	settings: () => Pick<QualitySettings, 'bounceRays' | 'cloudSteps'>;
}

/**
 * The features whose shader files the passes need that the device and the preset draw once a
 * scene has an opaque object: GPU occlusion culling on WebGPU, where the GPU culls the buckets,
 * and the screen-space bounce light on the HDR path, which reads ambient occlusion's steps and
 * the copy of the color.
 */
export function passFeatures({ tier, device, settings }: PassFacts): ShaderFeature[] {
	const features: ShaderFeature[] = [];
	if (tier !== 'webgl2' && device.gpuOcclusion && !device.directDraws) features.push('occlusion');
	if (settings().bounceRays > 0 && device.sceneColor !== FORMAT_CANVAS)
		features.push('ao', 'color_copy');
	return features;
}

/** Asks the thread that draws for the shader files of the features that the sketch will use. */
export class ShaderPreloads {
	private readonly asked = new Set<string>();
	/** The features that the page's settings cannot use now. */
	private readonly unusable = new Set<ShaderFeature>();
	/** The listed features held back while unusable, asked for once they turn usable. */
	private readonly held = new Set<ShaderFeature>();
	/** What decides the passes that the scene's objects bring, once the runner gives it. */
	private passes: PassFacts | undefined;

	constructor(private readonly send: PreloadSender = () => {}) {}

	/** Gives what decides the passes that the device and the preset draw. */
	setPassFacts(facts: PassFacts): void {
		this.passes = facts;
	}

	/**
	 * Asks for the shader files of the passes that the device and the preset draw over an opaque
	 * object, as the settings stand: a scene's first opaque material calls it. Without it, each
	 * file is asked for only when the first frame names its pipelines, after the setup.
	 */
	needPasses(): void {
		if (this.passes) this.needAll(passFeatures(this.passes));
	}

	/**
	 * Asks for the cloud tier's shader file for a sky whose clouds cover `coverage` of it, where the
	 * settings march the tier: the tier then draws over that sky in the first frame.
	 */
	needClouds(coverage: number): void {
		if (coverage > 0 && (this.passes?.settings().cloudSteps ?? 0) > 0) this.need('clouds');
	}

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
	 * Asks for the code and shaders of the GPU's environment generator, once, which a loading HDR
	 * file will need. The thread that draws loads them and builds the pipelines during the download.
	 */
	needGenerators(): void {
		if (this.asked.has(GENERATORS_PRELOAD)) return;
		this.asked.add(GENERATORS_PRELOAD);
		this.send([GENERATORS_PRELOAD]);
	}

	/**
	 * Asks for the shader files of `features`, once each. A loader that knows what an asset needs,
	 * such as the list of features that the asset tool records with a file, gives it here.
	 */
	needAll(features: Iterable<ShaderFeature>): void {
		for (const feature of features) this.need(feature);
	}

	/**
	 * Asks for the shader files of the features that `names` lists, once each, and leaves out a
	 * name that this engine does not know. A file that the asset tool wrote records its list as
	 * plain names, so a file from a newer tool gives its own extra names here. A feature that the
	 * page's settings cannot use now waits until they can: the list only says what the asset may
	 * draw with, and a pipeline that needs the feature still loads its file on first use.
	 */
	needListed(names: Iterable<string>): void {
		for (const name of names) {
			if (!(SHADER_FEATURES as readonly string[]).includes(name)) continue;
			const feature = name as ShaderFeature;
			if (this.unusable.has(feature)) this.held.add(feature);
			else this.need(feature);
		}
	}

	/**
	 * Says whether the page's settings can use `feature`, such as alpha to coverage, which only
	 * MSAA uses. A listed feature held back while it was unusable is asked for once it turns usable.
	 */
	setUsable(feature: ShaderFeature, usable: boolean): void {
		if (!usable) {
			this.unusable.add(feature);
			return;
		}
		this.unusable.delete(feature);
		if (this.held.delete(feature)) this.need(feature);
	}
}
