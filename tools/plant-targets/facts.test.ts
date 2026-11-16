import { describe, expect, test } from 'bun:test';
import { factBullets, readFacts } from './facts.ts';

describe('a fact sheet', () => {
	const sheet = [
		'# Test tree: fact sheet',
		'',
		'- **Names:** test tree; *Arbor exempli*.',
		'- **Habit and silhouette:** open-grown mature tree 20 to 30 m tall, spread 8 to 12 m; height about',
		'  2 to 2.5 times the width. Crown about 70 to 75 % of the height; clear white bole about a quarter. Trunk',
		'  40 to 60 cm thick. Outline a narrow open flame, light and see-through. One slender trunk.',
		'- **Branching:** alternate. Main branches rise at a steep angle.',
		'- **Leaves:** pinnate fronds 2 to 3 m long, smooth. Many leaflets, 20 to 40 cm long and 1 to 2 cm wide.',
		'- **Not:** "not a dome".',
	].join('\n');
	const facts = readFacts(sheet);

	test('reads its bullets with their continued lines', () => {
		const bullets = factBullets(sheet);
		expect([...bullets.keys()]).toEqual([
			'names',
			'habit and silhouette',
			'branching',
			'leaves',
			'not',
		]);
		expect(bullets.get('habit and silhouette')).toContain('One slender trunk.');
	});

	test('reads the stated sizes and shares', () => {
		expect(facts.heightMetres).toEqual([20, 30]);
		expect(facts.spreadMetres).toEqual([8, 12]);
		expect(facts.widthToHeight).toEqual([0.4, 0.5]);
		expect(facts.crownShare).toEqual([0.7, 0.75]);
		expect(facts.clearTrunkShare).toEqual([0.25, 0.25]);
		expect(facts.trunkMetres).toEqual({ range: [0.4, 0.6], words: 'thick' });
		expect(facts.stems).toBe('One slender trunk');
	});

	test('reads the leaf, its leaflet and the arrangement', () => {
		expect(facts.leafLengthCm).toEqual([200, 300]);
		expect(facts.leafWidthCm).toBeNull();
		expect(facts.leafletCm).toEqual({ length: [20, 40], width: [1, 2] });
		expect(facts.arrangement).toBe('alternate');
		expect(facts.habitWords).toEqual(['flame', 'narrow', 'open', 'see-through']);
		expect(facts.outline).toBe('a narrow open flame, light and see-through');
	});

	test('gives a reason for each field the sheet does not state', () => {
		expect(facts.flowerStemMetres).toBeNull();
		expect(facts.missing.flowerStemMetres).toContain('no flowering stem');
		// A height given for the trunk alone is not the plant's height.
		expect(
			readFacts('- **Habit and silhouette:** trunk 2 to 5 m tall, crown 4 to 6 m wide.')
				.heightMetres,
		).toBeNull();
		const bare = readFacts('- **Names:** a plant.\n- **Leaves:** none. Spines stand in for them.');
		expect(bare.heightMetres).toBeNull();
		expect(bare.missing.heightMetres).toContain('no line for the habit');
		expect(bare.missing.leafLengthCm).toContain('no leaves');
		expect(
			readFacts(
				'- **Habit and silhouette:** a mound 0.5 to 0.6 m tall and 0.9 to 1.2 m wide (width about twice the height).',
			).widthToHeight,
		).toEqual([2, 2]);
		expect(
			readFacts(
				'- **Habit and silhouette:** a plant 10 to 15 m tall; height to width about 3 to 1.',
			).widthToHeight,
		).toEqual([0.3333, 0.3333]);
	});
});
