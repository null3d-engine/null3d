// One picture of the vegetation add-on's sparse form, so a later change to a species' floors cannot
// go unseen: the pedunculate oak at the level a phone asks for, drawn as its whole view.
import type { ImageTest } from '../lib/images.ts';

/** The picture tests of the sparse form. */
export function sparseFormTests(): ImageTest[] {
	return [
		{
			name: 'plant-sparse-oak',
			sketch:
				'tests/pages/sketches/plant-review-sketch.ts?species=pedunculate-oak&view=whole&sparse=1',
			hold: 1,
			size: [512, 512],
		},
	];
}
