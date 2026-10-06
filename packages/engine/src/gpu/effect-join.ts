// Joined custom effects on the thread that draws (D-71). The engine has no shader compiler at run
// time, so the shader build gives each effect and tone curve pieces: the top-level items that the
// effect adds to each build of each host, as naga wrote them (see `pieces.rs` in the shader
// crate). A host is the engine's group template (`effect_group.wgsl`) or the final pass's fold
// build (`final.wgsl` with EFFECT_CHAIN), which arrive in a shader file that loads on first use.
// The joiner itself, `effect-joiner.ts`, loads on first use too.
//
// The backends ask `joinedReady` before they define a group's or a fold's template, and keep their
// builds of joined shaders in a `JoinedBuilds`, which times them and turns a failure into separate
// passes instead of a stopped engine.

import type { GlslTexture, GlslUniformBlock } from '../generated/shaders';
import { DEV } from '../shared/dev';
import type { CustomShader } from '../shared/images';
import type { DeviceShaderSet } from './device-shaders';

/** The broadcast channel on which the thread that draws answers requests for joined builds' times. */
export const JOIN_TIMING_CHANNEL = 'null3d-join-timing';
/** The message that asks for the times; the answer is a `JoinTimingReport`. */
export const JOIN_TIMING_REQUEST = 'join-timing-request';

/** How long each joined shader's pipeline took to build, in the order they finished. */
export interface JoinTimingReport {
	readonly type: 'join-timing';
	/** Each build: the shader's template, its kind, and milliseconds from the request to built. */
	readonly builds: readonly { template: number; kind: string; ms: number }[];
	/** The templates whose builds failed. */
	readonly failed: readonly number[];
}

/** The joined builds' times of every backend on this thread, which development builds keep. */
const timing: { builds: JoinTimingReport['builds'][number][]; failed: number[] } = {
	builds: [],
	failed: [],
};
let answering = false;

/** Answers requests for the joined builds' times on the broadcast channel, from the first on. */
function answer(): void {
	if (answering || typeof BroadcastChannel !== 'function') return;
	answering = true;
	const channel = new BroadcastChannel(JOIN_TIMING_CHANNEL);
	channel.onmessage = (event: MessageEvent<unknown>) => {
		if (event.data !== JOIN_TIMING_REQUEST) return;
		channel.postMessage({ type: 'join-timing', ...timing } satisfies JoinTimingReport);
	};
}

/**
 * A backend's builds of joined shaders: whether a template is one, how long each took, which
 * development builds keep for the effect cost page, and the failures, which go to `onFailed` so
 * that the sketch thread draws those effects alone. A joined shader's failure never stops the
 * engine: its effects still draw, one pass each.
 */
export class JoinedBuilds {
	/** Hears each joined template whose build failed. */
	onFailed: (template: number) => void = () => {};

	constructor(private readonly shaders: ReadonlyMap<number, CustomShader>) {}

	/** True when `template` is a group's or a fold's joined shader. */
	joined(template: number): boolean {
		const kind = this.shaders.get(template)?.kind;
		return kind === 'effectGroup' || kind === 'effectFold';
	}

	/** Notes that the pipeline of joined template `template` built in `ms` milliseconds. */
	built(template: number, ms: number): void {
		if (!DEV) return;
		timing.builds.push({ template, kind: this.shaders.get(template)?.kind ?? '', ms });
		answer();
	}

	/** Notes that the pipeline of joined template `template` failed to build, for `reason`. */
	failed(template: number, reason: unknown): void {
		if (DEV) {
			timing.failed.push(template);
			answer();
			console.warn(
				`null3D: a shader of joined custom effects failed to build, so those effects draw one pass each: ${reason instanceof Error ? reason.message : String(reason)}`,
			);
		}
		this.onFailed(template);
	}
}

/** The items that a piece adds to a host's WGSL, and the function that the chain or hook calls. */
export interface WgslPiece {
	readonly items: readonly string[];
	readonly run: string;
}

/** The items that a piece adds to a host's GLSL fragment shader, with its blocks and textures. */
export interface GlslPiece extends WgslPiece {
	readonly uniformBlocks: readonly GlslUniformBlock[];
	readonly textures: readonly GlslTexture[];
}

/** One build of a piece, for the host's build of the same name. */
export interface ShaderPiece {
	readonly permutation: number;
	readonly wgsl: WgslPiece | null;
	readonly glsl: GlslPiece | null;
}

/** A piece's builds by the name of the host's build. */
export type PieceBuilds = Readonly<Record<string, ShaderPiece>>;

/** An effect's or a tone curve's pieces for each host, as the shader build gives them. */
export interface EffectPieces {
	readonly group: PieceBuilds;
	readonly fold: PieceBuilds;
}

/** An effect of a join: its pieces for the host, and the slot of its uniform block. */
export interface JoinMember {
	readonly pieces: PieceBuilds;
	readonly slot: number;
}

/**
 * Makes the builds of a group's or a fold's shader for `target` once, from the host in `set` and
 * the pieces of its effects in `shaders`, and returns true once it has them. The hosts arrive in a
 * file that loads on first use: until it has, this returns false, and the pipeline waits as for
 * any shader that loads on first use. Other shaders have their builds already.
 */
export function joinedReady(
	shader: CustomShader,
	shaders: ReadonlyMap<number, CustomShader>,
	set: DeviceShaderSet | undefined,
	target: 'wgsl' | 'glsl',
): boolean {
	const { kind, members } = shader;
	if ((kind !== 'effectGroup' && kind !== 'effectFold') || !members) return true;
	for (const _ in shader.variants) return true;
	if (!set) throw new Error('the engine has no device shaders to join effects with');
	const fold = kind === 'effectFold';
	const host = fold ? set.shaders.final_effects : set.shaders.effect_group;
	if (!set.ready(host, 0, target)) return false;
	const joiner = loadedJoiner();
	if (!joiner) return false;
	const piecesOf = (template: number): PieceBuilds => {
		const pieces = shaders.get(template)?.pieces;
		if (!pieces) throw new Error(`the effect of template ${template} has no pieces to join`);
		return fold ? pieces.fold : pieces.group;
	};
	const joined = joiner.joinShaders(
		host,
		members.map(({ template, slot }) => ({ pieces: piecesOf(template), slot })),
		shader.curve === undefined ? undefined : piecesOf(shader.curve),
		target,
	);
	Object.assign(shader.variants, joined);
	return true;
}

/** The joiner, which loads on first use, once it has loaded. */
let joiner: typeof import('./effect-joiner') | undefined;
/** True while the joiner loads. */
let loading = false;

/**
 * The joiner once it has loaded. The first call starts to load it, and a pipeline that needs it
 * waits as for any file that loads on first use: the backends ask again while they build. A failed
 * load is tried again at the next call.
 */
function loadedJoiner(): typeof import('./effect-joiner') | undefined {
	if (joiner || loading) return joiner;
	loading = true;
	import('./effect-joiner').then(
		(module) => {
			joiner = module;
		},
		() => {
			loading = false;
		},
	);
	return undefined;
}
