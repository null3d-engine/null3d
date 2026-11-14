// Add-on namespaces: an add-on claims a name, a shader library, an error-code range and quality
// keys as its module loads, and the engine and the other add-ons keep theirs. The test checks the
// defaults that a claim fills, each refusal with the owner that it names, that a module which loads
// again under its package gets the namespace it claimed, and that a released name goes back to the
// pool.
import { beforeEach, describe, expect, it } from 'bun:test';
import { setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import { PLUGIN_INTERFACE_VERSION } from '../shared/version';
import {
	type AddonNamespace,
	AddonNamespaces,
	addonNamespaces,
	declareAddonNamespace,
} from './namespaces';

// The page sets the table of fixes that ends each error's message before it can raise an error.
beforeEach(() => setErrorFixes(ERROR_FIXES));

/** The package that owns a test add-on unless the test names another. */
const PACKAGE = '@acme/water';

/** Claims a namespace for the default package, with the fields that a test gives. */
function claim(
	namespaces: AddonNamespaces,
	description: {
		name: string;
		package?: string;
	} & Partial<Omit<AddonNamespace, 'name' | 'package'>>,
) {
	return namespaces.claim({ package: PACKAGE, ...description });
}

describe('the namespace that an add-on claims', () => {
	it('fills the shader library from the name and keeps the other names as declared', () => {
		const namespaces = new AddonNamespaces();
		const water = claim(namespaces, {
			name: 'water',
			errorCodes: [2100, 2199],
			qualityKeys: ['waterQuality'],
		});
		expect(water.name).toBe('water');
		expect(water.package).toBe(PACKAGE);
		expect(water.shaderLibrary).toBe('water');
		expect(water.errorCodes).toEqual([2100, 2199]);
		expect(water.qualityKeys).toEqual(['waterQuality']);
		expect(Object.isFrozen(water)).toBe(true);
		expect(namespaces.size).toBe(1);
		expect(namespaces.get('water')).toBe(water);
	});

	it('takes a shader library of another name, and no codes or keys', () => {
		const namespaces = new AddonNamespaces();
		const water = claim(namespaces, { name: 'ocean', shaderLibrary: 'water' });
		expect(water.shaderLibrary).toBe('water');
		expect(water.errorCodes).toBeUndefined();
		expect(water.qualityKeys).toEqual([]);
	});

	it('refuses the name and the shader library that the engine reserves', () => {
		const namespaces = new AddonNamespaces();
		expect(() => claim(namespaces, { name: 'null3d' })).toThrow(
			/E1225: declareAddonNamespace\(\) got the add-on name 'null3d', which the engine reserves\./,
		);
		expect(() => claim(namespaces, { name: 'water', shaderLibrary: 'null3d' })).toThrow(
			/E1225: declareAddonNamespace\(\) got the shader library 'null3d', which the engine reserves\./,
		);
	});

	it('gives the same namespace to a module that claims its names again under its package', () => {
		const namespaces = new AddonNamespaces();
		const first = claim(namespaces, {
			name: 'water',
			package: '@acme/water',
			errorCodes: [2100, 2199],
			qualityKeys: ['waveCount'],
		});
		const again = claim(namespaces, {
			name: 'water',
			package: '@acme/water',
			shaderLibrary: 'water',
			errorCodes: [2100, 2199],
			qualityKeys: ['waveCount'],
		});
		expect(again).toBe(first);
		expect(namespaces.size).toBe(1);
	});

	it('refuses a name that another package claims, even with the same fields, and names both', () => {
		const namespaces = new AddonNamespaces();
		claim(namespaces, { name: 'water', package: '@acme/water' });
		expect(() => claim(namespaces, { name: 'water', package: '@other/water' })).toThrow(
			/E1225: declareAddonNamespace\(\) got the add-on name 'water' for the package '@other\/water', which the package '@acme\/water' claims already\./,
		);
	});

	it('refuses a name that its own package claims with other names', () => {
		const namespaces = new AddonNamespaces();
		claim(namespaces, { name: 'water' });
		expect(() =>
			claim(namespaces, { name: 'water', package: PACKAGE, qualityKeys: ['waveCount'] }),
		).toThrow(
			/E1225: declareAddonNamespace\(\) got the add-on name 'water' for the package '@acme\/water', which that package claims with other names\./,
		);
	});

	it('refuses a namespace that names no package that owns it', () => {
		const namespaces = new AddonNamespaces();
		for (const owner of [undefined, '', 'two words', 42])
			expect(() => namespaces.claim({ name: 'water', package: owner as string })).toThrow(
				/E1225: declareAddonNamespace\(\) got the package .*; it takes 1 to 128 characters/,
			);
	});

	it('refuses a shader library that another add-on uses, and names both', () => {
		const namespaces = new AddonNamespaces();
		claim(namespaces, { name: 'water' });
		expect(() => claim(namespaces, { name: 'ocean', shaderLibrary: 'water' })).toThrow(
			/E1225: declareAddonNamespace\(\) got the shader library 'water' for the add-on 'ocean' of the package '@acme\/water', which the add-on 'water' of the package '@acme\/water' uses already\./,
		);
	});

	it('refuses a name that no shader library takes', () => {
		const namespaces = new AddonNamespaces();
		for (const name of ['', 'Water', 'water-pack', '1water', 'x'.repeat(33), 42])
			expect(() => claim(namespaces, { name: name as string })).toThrow(/E1225: .*add-on name/);
	});

	it('refuses a description that is no object', () => {
		const namespaces = new AddonNamespaces();
		expect(() => namespaces.claim(null as unknown as AddonNamespace)).toThrow(
			/E1225: declareAddonNamespace\(\) got null;/,
		);
	});

	it('refuses an option that a namespace does not take', () => {
		const namespaces = new AddonNamespaces();
		const withPrefix = { package: PACKAGE, name: 'water', prefix: 'water::' };
		expect(() => namespaces.claim(withPrefix as unknown as AddonNamespace)).toThrow(
			/E1225: declareAddonNamespace\(\) got the option 'prefix'/,
		);
	});
});

describe('the plugin interface range that an add-on declares', () => {
	it('keeps a range that holds the engine’s interface', () => {
		const namespaces = new AddonNamespaces();
		const water = claim(namespaces, {
			name: 'water',
			pluginInterface: {
				min: PLUGIN_INTERFACE_VERSION,
				max: PLUGIN_INTERFACE_VERSION,
			},
		});
		expect(water.pluginInterface).toEqual({
			min: PLUGIN_INTERFACE_VERSION,
			max: PLUGIN_INTERFACE_VERSION,
		});
		expect(Object.isFrozen(water.pluginInterface)).toBe(true);
	});

	it('refuses a range that leaves out the engine’s interface, and names the add-on', () => {
		const namespaces = new AddonNamespaces();
		const above = PLUGIN_INTERFACE_VERSION + 1;
		expect(() =>
			claim(namespaces, { name: 'water', pluginInterface: { min: above, max: above } }),
		).toThrow(/E1433: water was built for plugin interface /);
		expect(namespaces.get('water')).toBeUndefined();
	});

	it('refuses a range that is no range of whole versions', () => {
		const namespaces = new AddonNamespaces();
		expect(() => claim(namespaces, { name: 'water', pluginInterface: { min: 3, max: 2 } })).toThrow(
			/E1433: water declares plugin interface versions 3 to 2/,
		);
	});

	it('gives the same namespace to a reload with the same range', () => {
		const namespaces = new AddonNamespaces();
		const first = claim(namespaces, { name: 'water', pluginInterface: { min: 1, max: 2 } });
		expect(claim(namespaces, { name: 'water', pluginInterface: { min: 1, max: 2 } })).toBe(first);
		expect(() => claim(namespaces, { name: 'water', pluginInterface: { min: 1, max: 3 } })).toThrow(
			/E1225/,
		);
	});
});

describe('the error codes that an add-on claims', () => {
	it('refuses a range outside the add-ons’ own codes', () => {
		const namespaces = new AddonNamespaces();
		for (const errorCodes of [
			[1100, 1199],
			[1999, 2100],
			[9000, 10000],
			[2100, 2000],
			[2100.5, 2200],
		] as [number, number][])
			expect(() => claim(namespaces, { name: 'water', errorCodes })).toThrow(
				/E1225: .*got the error codes .*; they take a first and a last whole code from 2000 to 9999/,
			);
	});

	it('refuses a range that overlaps another add-on’s, and names both', () => {
		const namespaces = new AddonNamespaces();
		claim(namespaces, { name: 'water', errorCodes: [2100, 2199] });
		expect(() => claim(namespaces, { name: 'ocean', errorCodes: [2199, 2299] })).toThrow(
			/E1225: declareAddonNamespace\(\) got the error codes 2199 to 2299 for the add-on 'ocean', which overlap the add-on 'water's 2100 to 2199\./,
		);
		expect(claim(namespaces, { name: 'ocean', errorCodes: [2200, 2299] }).errorCodes).toEqual([
			2200, 2299,
		]);
	});
});

describe('the quality keys that an add-on claims', () => {
	it('refuses a key of the engine’s own quality table', () => {
		const namespaces = new AddonNamespaces();
		expect(() => claim(namespaces, { name: 'water', qualityKeys: ['maxPixelRatio'] })).toThrow(
			/E1225: .*got the quality key 'maxPixelRatio' for the add-on 'water', which is a setting of the engine's own quality table\./,
		);
	});

	it('refuses a key that another add-on uses, and names both', () => {
		const namespaces = new AddonNamespaces();
		claim(namespaces, { name: 'water', qualityKeys: ['waveCount'] });
		expect(() => claim(namespaces, { name: 'ocean', qualityKeys: ['waveCount'] })).toThrow(
			/E1225: .*got the quality key 'waveCount' for the add-on 'ocean', which the add-on 'water' uses already\./,
		);
	});

	it('refuses a key that one add-on claims twice', () => {
		const namespaces = new AddonNamespaces();
		expect(() =>
			claim(namespaces, { name: 'water', qualityKeys: ['waveCount', 'waveCount'] }),
		).toThrow(/E1225: .*got the quality key 'waveCount' twice for the add-on 'water'\./);
	});
});

describe('the names that add-ons release', () => {
	it('gives a released namespace and all its names to another add-on', () => {
		const namespaces = new AddonNamespaces();
		claim(namespaces, {
			name: 'water',
			errorCodes: [2100, 2199],
			qualityKeys: ['waveCount'],
		});
		expect(namespaces.release('water')).toBe(true);
		expect(namespaces.release('water')).toBe(false);
		const ocean = claim(namespaces, {
			name: 'ocean',
			errorCodes: [2100, 2199],
			qualityKeys: ['waveCount'],
		});
		expect(ocean.name).toBe('ocean');
		expect(namespaces.get('water')).toBeUndefined();
	});

	it('gives a released feature’s names to another add-on', () => {
		const namespaces = new AddonNamespaces();
		claim(namespaces, { name: 'water' });
		claim(namespaces, { name: 'ocean' });
		const names = {
			feature: 'waves',
			outputs: ['spray'],
			slots: ['sky'] as const,
			debugViews: ['water-waves'],
		};
		namespaces.claimFeature('water', names);
		expect(() => namespaces.claimFeature('ocean', names)).toThrow(
			/E1225: FeatureHost.add\(\) got the feature 'waves' for the add-on 'ocean', which the add-on 'water' registers already\./,
		);
		namespaces.releaseFeature('water', names);
		namespaces.claimFeature('ocean', names);
		expect(() => namespaces.releaseFeature('water', names)).not.toThrow();
	});
});

describe('the thread’s namespace registry', () => {
	it('is the registry that an add-on declares its namespace in', () => {
		const fields = { name: 'thread_test', package: '@acme/thread-test' };
		const water = declareAddonNamespace(fields);
		expect(addonNamespaces().get('thread_test')).toBe(water);
		expect(declareAddonNamespace(fields)).toBe(water);
		expect(() => declareAddonNamespace({ ...fields, shaderLibrary: 'other' })).toThrow(/E1225/);
		expect(() =>
			declareAddonNamespace({ name: 'thread_test', package: '@other/thread-test' }),
		).toThrow(/E1225/);
		addonNamespaces().release('thread_test');
		expect(addonNamespaces().get('thread_test')).toBeUndefined();
	});
});
