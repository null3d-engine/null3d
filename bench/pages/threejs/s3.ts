// The three.js twin of S3, the lights: still boxes (20,000 unless `?n=` asks for another count) in
// one InstancedMesh on a floor, lit by 256 PointLight objects with a distance and a decay, which
// move every frame. Both engines' boxes and floor use a standard (physically based) material.
//
// The choice of renderer: the benchmark compares null3D with the faster of three.js's two
// renderers, and this twin gives each one its best lighting for many point lights. The pinned
// three.js has clustered lighting (Forward+) for WebGPURenderer, the `ClusteredLighting` addon,
// so the WebGPU page shades each fragment with the point lights of its cluster only. WebGLRenderer
// has no tiled or clustered lighting, so the WebGL page shades all 256 point lights in every
// fragment, in a shader that three.js unrolls light by light.
import type * as ThreeModule from 'three';
import {
	createS3,
	S3_BOX,
	S3_DEFAULT_COUNT,
	S3_FLOOR,
	S3_LIGHT,
	S3_LIGHT_COUNT,
	S3_VIEW_LIGHTS,
	s3BoxAt,
	s3Camera,
	s3LightColor,
	s3LightsAt,
} from '../../scenes/spec';
import { runThreePage } from './harness';

runThreePage(
	's3',
	(three, scene, { count }) => {
		const data = createS3(count ?? S3_DEFAULT_COUNT);

		const floor = new three.Mesh(
			new three.PlaneGeometry(S3_FLOOR.size, S3_FLOOR.size),
			new three.MeshStandardMaterial({ color: S3_FLOOR.color }),
		);
		floor.quaternion.fromArray(S3_FLOOR.rotation);
		scene.add(floor);

		const boxes = new three.InstancedMesh(
			new three.BoxGeometry(1, 1, 1),
			new three.MeshStandardMaterial({ color: S3_BOX.color }),
			data.count,
		);
		const position = new three.Vector3();
		const rotation = new three.Quaternion();
		const scale = new three.Vector3();
		const matrix = new three.Matrix4();
		const out = { position: [0, 0, 0], rotation: [0, 0, 0, 0], scale: [0, 0, 0] };
		for (let i = 0; i < data.count; i++) {
			s3BoxAt(data, i, out.position, out.rotation, out.scale);
			matrix.compose(
				position.fromArray(out.position),
				rotation.fromArray(out.rotation),
				scale.fromArray(out.scale),
			);
			boxes.setMatrixAt(i, matrix);
		}
		boxes.computeBoundingSphere();
		scene.add(boxes);

		const lights: ThreeModule.PointLight[] = [];
		for (let i = 0; i < S3_LIGHT_COUNT; i++) {
			const light = new three.PointLight(
				s3LightColor(i),
				S3_LIGHT.intensity,
				S3_LIGHT.range,
				S3_LIGHT.decay,
			);
			lights.push(light);
			scene.add(light);
		}
		const clock = new Float64Array(1);
		const lightPositions = new Float64Array(S3_LIGHT_COUNT * 3);
		return {
			n: data.count,
			update(t) {
				clock[0] = t;
				s3LightsAt(data, clock, lightPositions);
				for (let i = 0; i < S3_LIGHT_COUNT; i++)
					lights[i]?.position.fromArray(lightPositions, i * 3);
			},
			camera: s3Camera,
		};
	},
	{ lights: S3_VIEW_LIGHTS, clusteredLighting: true },
);
