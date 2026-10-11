// Reflection probes (D-149), which `scene.createReflectionProbe` makes: the light around a point of
// the scene, which the engine captures on the GPU and filters for each roughness as an
// environment's map, and which lights the surfaces inside the probe's box in place of the
// environment. The engine core keeps each probe in a slot, captures it through six views of the
// scene, and runs its filter with the generators' code, which this module sends with the first
// probe.

import { checkLayers, checkLive, DEV, type Destroyable } from '../errors/checks';
import { EngineError } from '../errors/engine-error';
import * as C from '../generated/core';
import type { CoreMemory } from './memory';
import type { Vec3 } from './scene';

/**
 * The options of `scene.createReflectionProbe` and `probe.set`. Each call sets every option, and an
 * option left out takes its default.
 *
 * @category api/scene
 */
export interface ReflectionProbeOptions {
	/**
	 * The box that the probe lights, from its corner of least x, y and z to the opposite corner, in
	 * meters in the world. Surfaces inside it reflect what the probe captured, and reflections
	 * meet its sides, as a room's walls stand.
	 */
	readonly box: { readonly min: Vec3; readonly max: Vec3 };
	/** The point that the probe captures the scene from, inside its box. The default is its center. */
	readonly position?: Vec3;
	/**
	 * How far beyond the box's sides the probe fades out, in meters, 0 or more. The probe lights
	 * its whole box, and the next probe, or the environment, lights the rest. The default is 1. 0
	 * gives a hard edge.
	 */
	readonly blend?: number;
	/** The factor of the probe's light, 0 or more. The default is 1. */
	readonly intensity?: number;
	/**
	 * True makes reflections meet the box's sides, which suits rooms and streets. False reads the
	 * probe as light from far away, as an environment, which suits open ground. The default is true.
	 */
	readonly boxProjection?: boolean;
	/**
	 * `'once'` captures the scene when the probe is made or moved, and when `probe.capture()` asks.
	 * `'always'` captures it again and again, one probe a frame in turns, so moving objects show.
	 * The default is `'once'`.
	 */
	readonly refresh?: 'once' | 'always';
	/** The layers of the objects that the probe's captures draw. The default is the default layer. */
	readonly layers?: number;
	/**
	 * Where boxes overlap, the probe with the higher priority lights the surfaces in both, and of two
	 * of the same priority, the smaller box. The default is 0.
	 */
	readonly priority?: number;
}

/** The option names that `scene.createReflectionProbe` and `probe.set` take. */
const OPTIONS = [
	'box',
	'position',
	'blend',
	'intensity',
	'boxProjection',
	'refresh',
	'layers',
	'priority',
];

/**
 * A reflection probe, which `scene.createReflectionProbe` makes. It lights the surfaces inside its
 * box with the scene around its capture point, in place of the environment.
 *
 * @category api/scene
 */
export class ReflectionProbe implements Destroyable {
	/** @internal The frame in which the probe was destroyed, or -1 while it lives. */
	destroyedFrame = -1;

	/** @internal */
	constructor(
		private readonly probes: ReflectionProbes,
		/** @internal The probe's slot in the engine core. */
		readonly slot: number,
	) {}

	/** @internal */
	describe(): string {
		return `the reflection probe of slot ${this.slot}`;
	}

	/**
	 * Sets every option of the probe, as `scene.createReflectionProbe` takes them. A new position or
	 * new layers capture the scene again. The other options need no capture.
	 */
	set(options: ReflectionProbeOptions): void {
		this.probes.apply(this, options, 'probe.set');
	}

	/**
	 * Captures the scene again, in a frame soon, as after objects around the probe moved. A probe
	 * that refreshes always needs no call.
	 */
	capture(): void {
		if (DEV) checkLive('probe.capture', this);
		this.probes.core.check(
			this.probes.core.glue.captureReflectionProbe(this.slot),
			'probe.capture',
			undefined,
			true,
		);
	}

	/**
	 * Removes the probe. Surfaces in its box take the light of other probes or of the environment
	 * from the next frame on. Calling a method of the probe afterwards throws E1101.
	 */
	destroy(): void {
		if (DEV) checkLive('probe.destroy', this);
		this.probes.remove(this);
	}
}

/** @internal What the probes need from the sketch's other parts. */
export interface ProbeHost {
	/** Sends the generator of the probes' filters under an image id that the engine core gave. */
	sendGenerator(id: number): void;
	/** True when the device draws into half-float targets, which probes' maps need. */
	readonly floatTargets: boolean;
	/** The sketch's frame, which a destroyed probe notes. */
	readonly time: { readonly frame: number };
}

/** @internal The scene's reflection probes, by slot. */
export class ReflectionProbes {
	private readonly slots: (ReflectionProbe | undefined)[] = [];
	/** True once the generator of the probes' filters went to the thread that draws. */
	private sent = false;

	constructor(
		readonly core: CoreMemory,
		private readonly host: ProbeHost,
	) {}

	/** Makes a probe with `options` in the first free slot. */
	create(options: ReflectionProbeOptions, call: string): ReflectionProbe {
		if (DEV && !this.host.floatTargets && this.slots.length === 0)
			console.warn(
				`${call}(): this device draws into no half-float targets, so reflection probes light nothing here and the environment lights the scene.`,
			);
		let slot = this.slots.indexOf(undefined);
		if (slot < 0) slot = this.slots.length;
		if (slot >= C.REFLECTION_PROBE_MAX)
			throw new EngineError(
				'E1430',
				`${call}() would make reflection probe ${slot + 1}; a scene has at most ${C.REFLECTION_PROBE_MAX}.`,
			);
		const probe = new ReflectionProbe(this, slot);
		this.apply(probe, options, call);
		this.slots[slot] = probe;
		if (!this.sent && this.host.floatTargets) {
			this.sent = true;
			this.host.sendGenerator(this.core.check(this.core.glue.probeGenerator(), call));
		}
		return probe;
	}

	/** Sends every option of `probe` to the engine core, after checking them in development builds. */
	apply(probe: ReflectionProbe, options: ReflectionProbeOptions, call: string): void {
		if (DEV) {
			checkLive(call, probe);
			check(options, call);
		}
		// Without half-float targets a probe captures nothing, and the environment lights its box.
		if (!this.host.floatTargets) return;
		const { min, max } = options.box;
		const {
			position = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
			blend = 1,
			intensity = 1,
			boxProjection = true,
			refresh = 'once',
			layers = 1,
			priority = 0,
		} = options;
		const flags =
			(boxProjection ? C.REFLECTION_PROBE_BOX_PROJECTION : 0) |
			(refresh === 'always' ? C.REFLECTION_PROBE_ALWAYS : 0);
		// Captures need the views that the scene's passes leave, so the first probe can fail.
		const result = this.core.glue.setReflectionProbe(
			probe.slot,
			min[0],
			min[1],
			min[2],
			max[0],
			max[1],
			max[2],
			position[0],
			position[1],
			position[2],
			blend,
			intensity,
			flags,
			layers >>> 0,
			priority,
		);
		if (result !== 0)
			throw new EngineError(
				'E1430',
				`${call}() needs ${C.REFLECTION_PROBE_VIEWS} views of the scene for its captures, and the scene's passes leave fewer. Remove a scene pass or a reflection pass first.`,
			);
	}

	/** Removes `probe` from its slot. */
	remove(probe: ReflectionProbe): void {
		if (this.host.floatTargets) this.core.glue.removeReflectionProbe(probe.slot);
		this.slots[probe.slot] = undefined;
		probe.destroyedFrame = this.host.time.frame;
	}
}

/** Throws the error of options that probes do not take. Development builds only. */
function check(options: ReflectionProbeOptions, call: string): void {
	if (typeof options !== 'object' || options === null)
		throw new EngineError(
			'E1213',
			`${call}() got ${String(options)}, which is not an object of options.`,
		);
	for (const key of Object.keys(options))
		if (!OPTIONS.includes(key))
			throw new EngineError(
				'E1213',
				`${call}() got the option "${key}", which reflection probes do not take. They take ${OPTIONS.join(', ')}.`,
			);
	const point = (name: string, value: unknown) => {
		if (!Array.isArray(value) || value.length !== 3)
			throw new EngineError(
				'E1213',
				`${call}() got ${name} ${JSON.stringify(value)}; it takes [x, y, z].`,
			);
		for (const v of value)
			if (!Number.isFinite(v)) throw new EngineError('E1203', `${call}() got ${v} in ${name}.`);
	};
	const { box, position, blend, intensity, boxProjection, refresh, layers, priority } = options;
	if (typeof box !== 'object' || box === null)
		throw new EngineError(
			'E1213',
			`${call}() got no box; it takes { min: [x, y, z], max: [x, y, z] }.`,
		);
	point('box.min', box.min);
	point('box.max', box.max);
	if (box.min.some((v, k) => v >= (box.max[k] as number)))
		throw new EngineError(
			'E1108',
			`${call}() got a box whose min ${JSON.stringify(box.min)} does not lie below its max ${JSON.stringify(box.max)} on every axis.`,
		);
	if (position !== undefined) point('position', position);
	const amount = (name: string, value: number | undefined) => {
		if (value === undefined) return;
		if (!Number.isFinite(value))
			throw new EngineError('E1203', `${call}() got ${value} for ${name}.`);
		if (value < 0) throw new EngineError('E1108', `${call}() got ${value} for ${name}, below 0.`);
	};
	amount('blend', blend);
	amount('intensity', intensity);
	if (priority !== undefined && !Number.isFinite(priority))
		throw new EngineError('E1203', `${call}() got ${priority} for priority.`);
	if (boxProjection !== undefined && typeof boxProjection !== 'boolean')
		throw new EngineError(
			'E1213',
			`${call}() got boxProjection ${String(boxProjection)}; it takes true or false.`,
		);
	if (refresh !== undefined && refresh !== 'once' && refresh !== 'always')
		throw new EngineError(
			'E1213',
			`${call}() got refresh ${JSON.stringify(refresh)}; it takes 'once' or 'always'.`,
		);
	if (layers !== undefined) checkLayers(call, layers);
}
