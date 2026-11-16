// The types of three.js r187's modules that the desert's page imports through the `three-r187`
// alias. three.js ships no types, and `@types/three` matches the bench's r186, so each module
// takes r186's types where they hold. The meshlet renderer is new in r187, so its part is written
// here: the options the page passes and the counts it reads.

declare module 'three-r187/webgpu' {
	export * from 'three/webgpu';
}

declare module 'three-r187/addons/loaders/GLTFLoader.js' {
	export * from 'three/addons/loaders/GLTFLoader.js';
}

declare module 'three-r187/addons/csm/CSMShadowNode.js' {
	export * from 'three/addons/csm/CSMShadowNode.js';
}

declare module 'three-r187/addons/pipelines/MeshletDrawingPipeline.js' {
	/** WebGPURenderer's drawing pipeline that culls and draws each copy's 64-triangle meshlets. */
	export class MeshletDrawingPipeline {
		constructor(parameters?: {
			lodThreshold?: number;
			shadowLodThreshold?: number;
			minScreenRadius?: number;
			coarseScreenRadius?: number;
			occlusionCulling?: boolean;
			depthPrepass?: boolean;
		});
		/**
		 * The meshlets that the newest frame read back from the GPU drew, and their triangles at 64 a
		 * meshlet. The pipeline reads its counts back every 30 frames.
		 */
		readonly info: { triangles: number; clusters: number };
	}
}
