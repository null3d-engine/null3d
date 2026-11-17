// A game's simulation in miniature, as a deterministic engine runs it: it imports null3D's math
// through the maths entry alone, steps a ship by its input, and gives its state as numbers. It calls
// helpers of every sub-path and every helper that createMath builds, so a bundle of it holds each of
// them. The maths entry's test (packages/engine/src/math/math-entry.test.ts) bundles it as a game's
// build bundles its simulation, and reads the bundle for every name that such a simulation may not
// use. The exact functions come from the caller, as an exact math library's would.
import { createMath, type MathFunctions } from '@null3d/engine/math';
import * as mat4 from '@null3d/engine/math/mat4';
import * as math from '@null3d/engine/math/math';
import * as quat from '@null3d/engine/math/quat';
import * as vec3 from '@null3d/engine/math/vec3';

/** One tick's input: how far the stick turns the ship, and how hard it pushes. */
export interface Input {
	turn: number;
	thrust: number;
}

const UP = [0, 1, 0];
const AHEAD = [0, 0, -1];
const GOAL = [40, 0, -25];
const HIGH = [100, 100, 100];
const LOW = [-100, -100, -100];
const ONE = [1, 1, 1];
/** The simulation's fixed step, in seconds. */
const STEP = 1 / 60;

/** Makes a simulation on the functions given, and returns its step, which gives the state after it. */
export function createSimulation(functions: MathFunctions): (input: Input) => number[] {
	const exact = createMath(functions);
	const position = vec3.create();
	const velocity = vec3.create();
	const forward = vec3.create();
	const side = vec3.create();
	const toGoal = vec3.create();
	const heading = quat.create();
	const turn = quat.create();
	const aim = quat.create();
	const bank = quat.create();
	const back = quat.create();
	const pose = mat4.create();
	const view = mat4.create();
	const scale = vec3.create();
	const place = vec3.create();
	const rotation = quat.create();
	let speed = 0;
	let tick = 0;

	return (input) => {
		tick++;
		const steer = math.clamp(input.turn, -1, 1);
		const push = math.clamp(input.thrust, 0, 1);
		exact.quat.setAxisAngle(turn, UP, math.degToRad(steer * 3));
		quat.multiply(heading, heading, turn);
		quat.normalize(heading, heading);
		vec3.transformQuat(forward, AHEAD, heading);
		vec3.cross(side, forward, UP);
		vec3.normalize(side, side);
		speed = exact.math.damp(speed, push * 12, 4, STEP);
		vec3.scaleAndAdd(velocity, velocity, forward, speed * STEP);
		vec3.scale(velocity, velocity, 0.98);
		vec3.add(position, position, velocity);
		vec3.min(position, position, HIGH);
		vec3.max(position, position, LOW);

		// How the ship leans into a turn, nods with its thrust, and how far it has to turn to the goal.
		exact.quat.fromEuler(bank, 0, 0, math.lerp(0, steer * 0.4, 0.5), 'YXZ');
		exact.quat.rotateX(bank, bank, push * 0.05);
		exact.quat.rotateY(bank, bank, math.degToRad(math.euclideanModulo(tick, 360)));
		exact.quat.rotateZ(bank, bank, -steer * 0.1);
		quat.lookAt(aim, position, GOAL);
		exact.quat.slerp(aim, heading, aim, math.smoothstep(vec3.distance(position, GOAL), 50, 0));
		const facing = exact.vec3.angle(forward, vec3.sub(toGoal, GOAL, position));
		quat.rotationTo(back, forward, AHEAD);

		mat4.compose(pose, position, heading, ONE);
		mat4.invert(view, pose);
		mat4.multiply(view, view, pose);
		mat4.decompose(place, rotation, scale, pose);

		return [
			...position,
			...heading,
			...aim,
			...bank,
			...back,
			...rotation,
			facing,
			speed,
			vec3.length(velocity),
			vec3.dot(side, toGoal),
			quat.dot(heading, back),
			view[0] as number,
			math.inverseLerp(0, 100, position[0] as number),
			math.mapLinear(speed, 0, 12, 0, 1),
			math.radToDeg(facing),
		];
	};
}
