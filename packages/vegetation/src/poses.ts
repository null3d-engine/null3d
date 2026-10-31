// The branch poses of a plant variant, for the near trees: a compute pass that turns each branch
// once for the whole frame, with a spring, and a texture of the turns that the leaf and bark offsets
// read in every pass that draws the plant. The pass keeps two states, so a branch answers the run
// before and the motion pass reads the frame before's pose.
//
// A page decides which trees stand near enough to move and gives each one a slot, in the order that
// the pass writes them. The pass writes the slot of each copy into a header row, so a far copy reads
// no slot and stands still. The pose table takes one row for the header, one for the field's steady
// settings, and a row for each slot.
import {
	type Camera,
	defineFeature,
	type EngineCapabilities,
	type InstanceBatch,
	type RenderPass,
	type SketchContext,
	type Texture,
} from '@null3d/engine';
import type { PlantAsset } from './asset';
import type { PlantWind } from './plant';
import posesFallback from './poses.fallback.wgsl';
import posesShader from './poses.wgsl';

/**
 * What a page gives the branch-pose pass: the copies of the variant that it places, and how many of
 * them may stand near the camera at once.
 *
 * @category api/vegetation
 */
export interface PlantPoseOptions {
	/** The copies of the variant that the page places: each takes one row of the batch it draws. */
	readonly trees: number;
	/**
	 * The copies that may stand within the sway distance at once, which the pose table gives a slot
	 * each. The default is every copy, which suits a scene whose trees all sway.
	 */
	readonly slots?: number;
	/** A name of its own for the pass. A page with several variants names each one. */
	readonly name?: string;
}

/**
 * The branch poses of one variant: the texture that its leaf and bark materials read, and the call
 * that chooses the near trees and sends the pass this frame's values.
 *
 * @category api/vegetation
 */
export interface PlantPoses {
	/** The texture that a material's branch data reads. */
	readonly texture: Texture;
	/** The pass itself, which a page reads with `render.readPass` and switches with `render.setPassEnabled`. */
	readonly pass: RenderPass;
	/** The copies that the pose table gives a slot each. */
	readonly slots: number;
	/**
	 * Attaches the batch whose rows are the variant's copies. Call it once after the batch is made,
	 * and give both parts of the variant a batch whose rows stand in the same order.
	 */
	attach(batch: InstanceBatch): void;
	/**
	 * Chooses the slots of the near trees and sends the pass this frame's values and places. Call it
	 * in each frame after the wind field's own `update`, so the pass reads the box of this frame, and
	 * before the frame draws.
	 */
	update(camera: Camera): void;
	/** Removes the pass and its texture. A material that still reads the pose sees nothing. */
	destroy(): void;
}

/** A number that makes each pass's feature name its own, since a page names one feature once. */
let SERIAL = 0;

/** The floats that one near tree's row of the slot table holds: a texel for each of four numbers. */
const TREE_STRIDE = 16;
/** The rows that the target holds before the pose rows: the slot header, then the field's settings. */
const TABLE_ROWS = 2;
/** The texels that one branch's pose takes. */
const POSE_TEXELS = 3;

/**
 * True when the device draws into a 16-bit float texture, which the pose table needs. Every WebGPU
 * path does, and a WebGL2 device needs one of the two float extensions, as the wind add-on's grid
 * does. A device that holds none keeps the per-vertex sway.
 */
function holdsPoses(capabilities: Pick<EngineCapabilities, 'tier' | 'features'>): boolean {
	const { tier, features } = capabilities;
	return (
		tier !== 'webgl2' ||
		features.includes('EXT_color_buffer_float') ||
		features.includes('EXT_color_buffer_half_float')
	);
}

/**
 * Makes the branch-pose pass of one plant variant, beside the wind data that {@link plantWind}
 * gives its materials. The pass turns each branch once in every frame, with a spring that lets it
 * lag a gust and spring back after it, and writes each near tree's turn into a texture that the
 * leaf and bark offsets read. Only near trees take a slot, so a grove costs its near trees' rows.
 *
 * Returns nothing on a device that cannot draw into a 16-bit float texture, where the plants keep
 * the per-vertex sway.
 *
 * @param ctx The sketch's context, or its `render`, `textures`, `time` and `engine` alone.
 * @param wind The plant's wind data, from {@link plantWind}, which holds the branch records and the
 * field that the pass samples.
 * @param asset The grown plant.
 * @param options The variant's copies and the slots that the near ones take.
 * @returns The pose data for the plant's leaf and bark materials, or undefined on a device that
 * keeps no float target.
 * @category api/vegetation
 */
export function plantPoses(
	ctx: Pick<SketchContext, 'render' | 'textures' | 'time' | 'engine'>,
	wind: PlantWind,
	asset: PlantAsset,
	options: PlantPoseOptions,
): PlantPoses | undefined {
	if (!holdsPoses(ctx.engine.capabilities)) return undefined;
	const field = wind.field;
	const trees = Math.max(1, Math.floor(options.trees));
	const slots = Math.max(1, Math.min(Math.floor(options.slots ?? trees), trees));
	const branches = Math.max(1, asset.wind.branches);
	// The header needs one texel for each copy's row, and each branch's pose takes its texels along
	// the same row.
	const width = Math.max(branches * POSE_TEXELS, trees);
	if (width > ctx.textures.maxSize)
		throw new Error(
			`plantPoses() got ${trees} copies of a plant of ${branches} branches, whose pose table needs ${width} texels in a row, but this device's largest texture is ${ctx.textures.maxSize} texels across. Draw the variant as several batches with fewer copies each, or use a species with fewer branches.`,
		);
	const name = options.name ?? `plantPoses${++SERIAL}`;
	const values: number[] = new Array<number>(32).fill(0);
	// The slot table: each near tree's place, its normal matrix's three rows, and the row of its
	// batch. The fourth number of the first texel marks a tree that this frame gave a new slot.
	const table = ctx.textures.fromData({
		width: 4,
		height: slots,
		format: 'rgba16float',
		data: new Float32Array(4 * slots * 4),
	});
	const pass = ctx.render.addPass({
		kind: 'compute',
		description: defineFeature({
			name,
			frame: 'background',
			kind: 'compute',
			outputs: { [name]: { default: 'black' } },
		}),
		wgsl: posesShader,
		fallback: { wgsl: posesFallback },
		format: 'rgba16float',
		size: [width, slots + TABLE_ROWS],
		history: true,
		dispatch: [slots, 1, 1],
		workgroupSize: [1, 1, 1],
		values,
		textures: [field.texture, wind.pivots, table],
		name,
	});
	const texture = ctx.textures.fromPass(pass);
	// The slot that each row of the batch takes, and the row that each slot stands for, both as a
	// row's index plus one, so a zero marks a row or a slot that stands for nothing.
	let slotOfRow = new Int32Array(trees);
	const rowOfSlot = new Int32Array(slots);
	const fresh = new Uint8Array(slots);
	const data = new Float32Array(TREE_STRIDE * slots);
	const eye = [0, 0, 0];
	let batch: InstanceBatch | undefined;
	let live = true;
	const sway = Math.max(0, wind.swayDistance);

	const freeSlot = (): number => {
		for (let slot = 0; slot < slots; slot++) if (rowOfSlot[slot] === 0) return slot;
		return -1;
	};

	/** Writes one near tree's place, normal matrix and row into the slot table. */
	const placeTree = (slot: number, row: number, batches: InstanceBatch): void => {
		const position = batches.positions;
		const rotations = batches.rotations;
		const scales = batches.scales;
		const at = slot * TREE_STRIDE;
		const from = row * 3;
		const turn = row * 4;
		const x = position[from] as number;
		const y = position[from + 1] as number;
		const z = position[from + 2] as number;
		// The quaternion's rotation matrix, whose rows the normal matrix scales by one over each
		// scale, since a normal turns by the inverse transpose of the instance's own transform.
		const qx = rotations[turn] as number;
		const qy = rotations[turn + 1] as number;
		const qz = rotations[turn + 2] as number;
		const qw = rotations[turn + 3] as number;
		const xx = qx * qx;
		const yy = qy * qy;
		const zz = qz * qz;
		const xy = qx * qy;
		const xz = qx * qz;
		const yz = qy * qz;
		const wx = qw * qx;
		const wy = qw * qy;
		const wz = qw * qz;
		const inverse = (value: number) => 1 / (Math.abs(value) < 1e-6 ? 1e-6 : value);
		const sx = inverse(scales[from] as number);
		const sy = inverse(scales[from + 1] as number);
		const sz = inverse(scales[from + 2] as number);
		data[at] = x;
		data[at + 1] = y;
		data[at + 2] = z;
		data[at + 3] = fresh[slot] as number;
		data[at + 4] = (1 - 2 * (yy + zz)) * sx;
		data[at + 5] = 2 * (xy - wz) * sy;
		data[at + 6] = 2 * (xz + wy) * sz;
		data[at + 7] = 0;
		data[at + 8] = 2 * (xy + wz) * sx;
		data[at + 9] = (1 - 2 * (xx + zz)) * sy;
		data[at + 10] = 2 * (yz - wx) * sz;
		data[at + 11] = 0;
		data[at + 12] = 2 * (xz - wy) * sx;
		data[at + 13] = 2 * (yz + wx) * sy;
		data[at + 14] = (1 - 2 * (xx + yy)) * sz;
		data[at + 15] = row;
	};

	return {
		texture,
		pass,
		slots,
		attach(given) {
			batch = given;
			if (slotOfRow.length < given.count) slotOfRow = new Int32Array(given.count);
			for (let row = 0; row < slotOfRow.length; row++) slotOfRow[row] = 0;
			for (let slot = 0; slot < slots; slot++) rowOfSlot[slot] = 0;
		},
		update(camera) {
			if (!live || !batch) return;
			camera.getPosition(eye);
			// The field keeps two states, and each frame reads the one that its last run wrote.
			const air = field.air;
			const cap = sway * sway;
			let used = 0;
			fresh.fill(0);
			const count = Math.min(batch.count, slotOfRow.length);
			const position = batch.positions;
			for (let row = 0; row < count; row++) {
				const dx = (position[row * 3] as number) - (eye[0] as number);
				const dy = (position[row * 3 + 1] as number) - (eye[1] as number);
				const dz = (position[row * 3 + 2] as number) - (eye[2] as number);
				const near = sway <= 0 || dx * dx + dy * dy + dz * dz <= cap;
				let slot = slotOfRow[row] as number;
				if (near && slot === 0) {
					const found = freeSlot();
					if (found >= 0) {
						slot = found + 1;
						slotOfRow[row] = slot;
						rowOfSlot[found] = row + 1;
						fresh[found] = 1;
					}
				} else if (!near && slot !== 0) {
					rowOfSlot[slot - 1] = 0;
					slotOfRow[row] = 0;
					slot = 0;
				}
				if (slot !== 0) {
					placeTree(slot - 1, row, batch);
					used += 1;
				}
			}
			values.splice(0, 12, ...air.base, ...air.gust, ...air.swirl);
			values[12] = field.origin[0];
			values[13] = field.origin[1];
			values[14] = field.size;
			values[15] = used;
			values[16] = branches;
			values[17] = sway;
			values[18] = field.texture.layer;
			values[19] = ctx.time.dt;
			ctx.render.setPassUniforms(pass, values);
			table.update(data);
		},
		destroy() {
			if (!live) return;
			live = false;
			ctx.render.removePass(pass);
			table.destroy();
		},
	};
}
