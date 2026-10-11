import { describe, expect, it } from 'bun:test';
import { releaseOf, shipsSentence } from './steps';

describe('releaseOf', () => {
	it('words a roadmap step as the first release, and any other version as itself', () => {
		expect(releaseOf('0.3')).toBe('roadmap step 0.3, first released in null3D 0.1.0');
		expect(releaseOf('1.0')).toBe('null3D 1.0');
		expect(releaseOf('after 1.0')).toBe('after null3D 1.0');
	});

	it('opens a note with the same words as a sentence', () => {
		expect(shipsSentence('0.1')).toBe('Roadmap step 0.1, first released in null3D 0.1.0.');
		expect(shipsSentence('1.0')).toBe('Ships in null3D 1.0.');
	});
});
