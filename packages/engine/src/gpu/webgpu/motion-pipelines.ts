// The motion pass's parts of the WebGPU pipelines (decision record D-140), which the thread that
// draws loads with the first pipeline that draws or culls motion, so a page that never reads motion
// downloads none of them: the motion template, the motion view's compacted instance, and its
// culling pipeline.

import {
	LAYOUT_MOTION_FRAME,
	LAYOUT_TEXTURES,
	SIZE_MOTION_INSTANCE_STRIDE,
	TEMPLATE_MOTION,
	VERTEX_INSTANCE_LOCATION,
} from '../../generated/gpu';
import type { WgslShader } from '../../generated/shaders';
import { CULL_ENTRY_POINT, INSTANCE_BUFFERS, type Pipelines } from './pipelines';

/** What the pipelines read from the motion pass's parts once they load. */
export interface MotionParts {
	/** The motion view's compacted instance, which a custom material's motion builds read too. */
	readonly instances: GPUVertexBufferLayout[];
	/** How to build the motion view's culling pipeline from its build of the culling shader. */
	cull(shader: WgslShader): GPUComputePipelineDescriptor;
}

/**
 * The motion view's compacted instance: the matrix rows and the ids, then the rows of the last
 * frame's matrix after them.
 */
const INSTANCES: GPUVertexBufferLayout[] = [
	{
		arrayStride: SIZE_MOTION_INSTANCE_STRIDE,
		stepMode: 'instance',
		attributes: [
			...(INSTANCE_BUFFERS[0] as GPUVertexBufferLayout).attributes,
			{ shaderLocation: VERTEX_INSTANCE_LOCATION + 4, offset: 64, format: 'float32x4' },
			{ shaderLocation: VERTEX_INSTANCE_LOCATION + 5, offset: 80, format: 'float32x4' },
			{ shaderLocation: VERTEX_INSTANCE_LOCATION + 6, offset: 96, format: 'float32x4' },
		],
	},
];

/** The location of the last frame's place of each vertex in the motion template. */
const LAST_POSITION_LOCATION = 4;

/**
 * The buffer of each vertex's place in the last frame, in slot 2: the last frame's copy of a skinned
 * region, or the mesh's own vertices, read with the mesh's layout of the position.
 */
function lastVertices(mesh: GPUVertexBufferLayout): GPUVertexBufferLayout[] {
	const position = [...mesh.attributes].find((attribute) => attribute.shaderLocation === 0);
	if (!position) throw new Error('the motion template needs the vertex position');
	return [
		{
			arrayStride: mesh.arrayStride,
			stepMode: 'vertex',
			attributes: [{ ...position, shaderLocation: LAST_POSITION_LOCATION }],
		},
	];
}

/** Adds the motion pass's parts to the pipelines. */
export function addMotion(pipelines: Pipelines): void {
	// The motion of moving objects: the last frame's matrices after each instance's copy, and the
	// last frame's place of each vertex after them. Masked builds read the texture coordinates and
	// the base color map, whose group, or a blank one's, every build binds.
	pipelines.defineTemplate(TEMPLATE_MOTION, {
		label: 'mesh motion',
		shader: pipelines.shaders.motion,
		pipeline: 'main',
		layouts: [LAYOUT_MOTION_FRAME, LAYOUT_TEXTURES],
		meshLocations: [0],
		maskLocations: [2, 3],
		vertexBuffers: INSTANCES,
		afterInstances: lastVertices,
	});
	pipelines.motion = {
		instances: INSTANCES,
		cull(shader) {
			return {
				label: 'cull motion',
				layout: pipelines.cullLayout,
				compute: {
					module: pipelines.prepareModule('cull motion', shader),
					entryPoint: CULL_ENTRY_POINT,
				},
			};
		},
	};
}
