// The null3d version of S3, the lights: still boxes (20,000 unless the page asks for another count)
// in one static batch on a floor, lit by 256 point lights with a range that move every frame. The
// point lights are scene objects, and the engine culls them by their ranges each frame. The lights
// shade surfaces once the engine has clustered lighting; this sketch needs no change for that.
import { defineSketch, type PointLight } from '@null3d/engine';
import {
	createS3,
	S3_BOX,
	S3_FLOOR,
	S3_LIGHT,
	S3_LIGHT_COUNT,
	S3_VIEW_LIGHTS,
	s3BoxAt,
	s3Camera,
	s3LightColor,
	s3LightsAt,
} from '../../scenes/spec';
import { followPath, readCount, setUpView } from './sketch-common';

export default defineSketch((context) => {
	const { scene, materials, geometry, time } = context;
	const moveCamera = followPath(setUpView(context, S3_VIEW_LIGHTS), s3Camera);
	const data = createS3(readCount(import.meta.url));

	scene.createMesh({
		mesh: geometry.plane({ width: S3_FLOOR.size, height: S3_FLOOR.size }),
		material: materials.standard({ color: S3_FLOOR.color }),
		rotation: [...S3_FLOOR.rotation],
	});

	const batch = scene.createInstances(geometry.box(), data.count, {
		material: materials.standard({ color: S3_BOX.color }),
	});
	const { positions, rotations, scales } = batch;
	const position = new Float64Array(3);
	const rotation = new Float64Array(4);
	const scale = new Float64Array(3);
	for (let i = 0; i < data.count; i++) {
		s3BoxAt(data, i, position, rotation, scale);
		positions.set(position, i * 3);
		rotations.set(rotation, i * 4);
		scales.set(scale, i * 3);
	}
	batch.markDirty();

	const lights: PointLight[] = [];
	for (let i = 0; i < S3_LIGHT_COUNT; i++)
		lights.push(
			scene.createPointLight({
				color: s3LightColor(i),
				intensity: S3_LIGHT.intensity,
				range: S3_LIGHT.range,
				decay: S3_LIGHT.decay,
				dynamic: true,
			}),
		);

	// The lights move in a function of their own that takes no fraction, so the browser allocates
	// nothing for its call whether it inlines it or not. The time reaches it in `clock`.
	const clock = new Float64Array(1);
	const lightPositions = new Float64Array(S3_LIGHT_COUNT * 3);
	const moveLights = (): void => {
		s3LightsAt(data, clock, lightPositions);
		for (let i = 0; i < S3_LIGHT_COUNT; i++)
			lights[i]?.setPosition(
				lightPositions[i * 3] as number,
				lightPositions[i * 3 + 1] as number,
				lightPositions[i * 3 + 2] as number,
			);
	};
	const pose = (t: number): void => {
		clock[0] = t;
		moveLights();
		moveCamera(t);
	};
	pose(time.now);
	return {
		onUpdate() {
			pose(time.now);
		},
	};
});
