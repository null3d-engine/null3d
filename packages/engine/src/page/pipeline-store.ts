// The stored pipeline list: the pipelines that the first frame of each sketch's last start built,
// kept in the page's localStorage. The next start of the sketch in the same browser hands the list
// to the thread that draws, which starts those builds as soon as their shaders are there, while
// the core downloads and the setup runs (`gpu/early-builds.ts`). A start without a stored list
// builds each pipeline when the first frame asks for it. Chrome's own cache of compiled pipelines
// is small on Android, so a scene of a few dozen pipelines outgrows it and each visit compiles
// every pipeline again. A list applies only to a start on the same GPU path, with the same fixed
// shader bits, at the same preset, with the same engine version. It only names pipelines, so a
// list that the scene outgrew costs builds that no frame takes, never a wrong picture. Storage that
// cannot be read or written counts as empty.

import { OP_CREATE_COMPUTE_PIPELINE, OP_CREATE_RENDER_PIPELINE } from '../generated/gpu';
import { operandsAfterId, PIPELINE_LIST_LIMIT } from '../gpu/early-builds';
import type { QualityPreset } from '../quality/presets';
import type { Tier } from '../shared/tier';
import { VERSION } from '../shared/version';
import { pageStorage } from './start-marker';

const KEY_PREFIX = 'null3d.pipelines:';

/** What the store keeps for a sketch. */
interface StoredList {
	/** The facts that the list depended on, as `pipelineConditions` gives them. */
	conditions: string;
	/** The pipeline list, as numbers. */
	list: number[];
}

/**
 * The facts that a pipeline list depends on, as one text: the engine's version, the GPU path, the
 * device's fixed shader bits, the preset and the canvas's format. Two starts with the same text
 * ask for the same pipelines for the same scene.
 */
export function pipelineConditions(
	tier: Tier,
	shaderBits: number,
	preset: QualityPreset,
	canvasFormat: string | undefined,
): string {
	return JSON.stringify([VERSION, tier, shaderBits, preset, canvasFormat ?? null]);
}

/** True when `list` holds whole create commands only, as a thread that draws lists them. */
export function isPipelineList(list: readonly number[]): boolean {
	let commands = 0;
	for (let i = 0; i < list.length; commands++) {
		const op = list[i];
		if (op !== OP_CREATE_RENDER_PIPELINE && op !== OP_CREATE_COMPUTE_PIPELINE) return false;
		const end = i + 1 + operandsAfterId(op);
		if (end > list.length || commands >= PIPELINE_LIST_LIMIT) return false;
		for (let k = i + 1; k < end; k++) {
			const word = list[k] as number;
			if (!Number.isInteger(word) || word < 0 || word > 0xffffffff) return false;
		}
		i = end;
	}
	return list.length > 0;
}

/** The stored pipeline list of one sketch, for one start of it. */
export class PipelineStore {
	private readonly key: string;

	/**
	 * `conditions` are the start's, as `pipelineConditions` gives them. `storage` stands in for the
	 * page's localStorage in tests.
	 */
	constructor(
		sketchUrl: string,
		private readonly conditions: string,
		private readonly storage: Storage | undefined = pageStorage(),
	) {
		this.key = KEY_PREFIX + sketchUrl;
	}

	/** The stored list that applies to this start, or undefined. */
	read(): Uint32Array | undefined {
		try {
			const text = this.storage?.getItem(this.key);
			if (!text) return undefined;
			const stored = JSON.parse(text) as Partial<StoredList> | null;
			if (stored?.conditions !== this.conditions || !Array.isArray(stored.list)) return undefined;
			return isPipelineList(stored.list) ? Uint32Array.from(stored.list) : undefined;
		} catch {
			return undefined;
		}
	}

	/** Stores the list of the pipelines that this start's first frame built. */
	save(list: Uint32Array): void {
		if (!isPipelineList(Array.from(list))) return;
		const stored: StoredList = { conditions: this.conditions, list: Array.from(list) };
		try {
			this.storage?.setItem(this.key, JSON.stringify(stored));
		} catch {
			// The next start builds each pipeline when its first frame asks for it.
		}
	}
}
