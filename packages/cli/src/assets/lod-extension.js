// Levels of detail in glTF files, as the MSFT_lod extension stores them. A node with levels names
// the nodes that draw its lower levels, in order. Its extras give the screen coverage below which
// each level gives way to the next, and the engine's own field, NULL3D_lod_error, gives each lower
// level's error: the largest distance between its surface and the full mesh's, in the units of
// the mesh's stored positions, or of the scene that holds its skeleton for a skinned mesh, in its
// rest pose. glTF-Transform drops extensions it does not know, so the tool reads
// and writes this one itself.
import { Extension, ExtensionProperty, PropertyType, RefList } from '@gltf-transform/core';

/** @import { Node, ReaderContext, WriterContext } from '@gltf-transform/core' */

export const MSFT_LOD = 'MSFT_lod';

/** The extras field that holds each lower level's error. */
export const LOD_ERROR = 'NULL3D_lod_error';

/**
 * A node's lower levels of detail and the screen coverage of each level.
 *
 * @extends {ExtensionProperty<any>}
 */
export class Lod extends ExtensionProperty {
	static EXTENSION_NAME = MSFT_LOD;
	/** @type {string} */
	extensionName = MSFT_LOD;
	/** @type {string} */
	propertyType = 'Lod';
	/** @type {string[]} */
	parentTypes = [PropertyType.NODE];

	/** Sets nothing: the fields above name the property. */
	init() {}

	/** @returns {any} */
	getDefaults() {
		return Object.assign(super.getDefaults(), { levels: new RefList(), coverage: [], errors: [] });
	}

	/**
	 * The nodes of the lower levels, from the most detailed down.
	 *
	 * @returns {Node[]}
	 */
	listLevels() {
		return /** @type {Node[]} */ (this.listRefs('levels'));
	}

	/**
	 * Adds the node of the next lower level.
	 *
	 * @param {Node} node
	 */
	addLevel(node) {
		return this.addRef('levels', node);
	}

	/**
	 * The screen coverage of each level, the node's own first: the share of the screen's height
	 * that the model must cover for the level to draw. It falls from level to level, and the last
	 * is 0, so the lowest level draws at any distance.
	 *
	 * @returns {number[]}
	 */
	getCoverage() {
		return this.get('coverage');
	}

	/** @param {number[]} coverage */
	setCoverage(coverage) {
		return this.set('coverage', coverage);
	}

	/**
	 * Each lower level's error, in the order of the levels: the largest distance between its
	 * surface and the full mesh's, in the units of the mesh's stored positions, or of the scene
	 * that holds its skeleton for a skinned mesh.
	 *
	 * @returns {number[]}
	 */
	getErrors() {
		return this.get('errors');
	}

	/** @param {number[]} errors */
	setErrors(errors) {
		return this.set('errors', errors);
	}
}

/**
 * The node's levels of detail, or null.
 *
 * @param {Node} node
 * @returns {Lod | null}
 */
export const lodOf = (node) => /** @type {Lod | null} */ (node.getExtension(MSFT_LOD));

/** The MSFT_lod extension for glTF-Transform's reader and writer. */
export class MSFTLod extends Extension {
	static EXTENSION_NAME = MSFT_LOD;
	/** @type {string} */
	extensionName = MSFT_LOD;

	createLod() {
		return new Lod(this.document.getGraph());
	}

	/** @param {ReaderContext} context */
	read(context) {
		const nodes = context.jsonDoc.json.nodes ?? [];
		nodes.forEach((def, index) => {
			/** @type {{ ids?: number[] } | undefined} */
			const lodDef = /** @type {any} */ (def.extensions)?.[MSFT_LOD];
			if (!lodDef) return;
			const lod = this.createLod();
			for (const id of lodDef.ids ?? []) {
				const level = context.nodes[id];
				if (level) lod.addLevel(level);
			}
			const extras = /** @type {any} */ (def.extras);
			if (Array.isArray(extras?.MSFT_screencoverage))
				lod.setCoverage(extras.MSFT_screencoverage.map(Number));
			if (Array.isArray(extras?.[LOD_ERROR])) lod.setErrors(extras[LOD_ERROR].map(Number));
			context.nodes[index]?.setExtension(MSFT_LOD, /** @type {any} */ (lod));
		});
		return this;
	}

	/** @param {WriterContext} context */
	write(context) {
		const defs = context.jsonDoc.json.nodes ?? [];
		for (const node of this.document.getRoot().listNodes()) {
			const lod = lodOf(node);
			if (!lod) continue;
			const def = defs[/** @type {number} */ (context.nodeIndexMap.get(node))];
			if (!def) continue;
			def.extensions ??= {};
			def.extensions[MSFT_LOD] = {
				ids: lod.listLevels().map((level) => context.nodeIndexMap.get(level)),
			};
			const coverage = lod.getCoverage();
			const errors = lod.getErrors();
			def.extras = {
				...def.extras,
				...(coverage.length > 0 && { MSFT_screencoverage: coverage }),
				...(errors.length > 0 && { [LOD_ERROR]: errors }),
			};
			if (Object.keys(def.extras).length === 0) delete def.extras;
		}
		return this;
	}
}
