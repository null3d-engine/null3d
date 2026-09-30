// S3's shared per-frame code alone: the paths of the point lights and the orbiting camera. Its boxes
// never move.
import { createS3, S3_DEFAULT_COUNT, S3_LIGHT_COUNT, s3Camera, s3LightAt } from '../../scenes/spec';
import { runSceneCodePage } from './harness';

runSceneCodePage('s3', ({ count }) => {
	const data = createS3(count ?? S3_DEFAULT_COUNT);
	const lights = new Float64Array(S3_LIGHT_COUNT * 3);
	const position = new Float64Array(3);
	const eye = new Float64Array(3);
	const target = new Float64Array(3);
	return {
		n: data.count,
		frame(t) {
			for (let i = 0; i < S3_LIGHT_COUNT; i++) {
				s3LightAt(data, i, t, position);
				lights.set(position, i * 3);
			}
			s3Camera(t, eye, target);
		},
	};
});
