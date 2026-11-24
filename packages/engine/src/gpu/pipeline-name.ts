// The name of a render pipeline for a message, the same on both GPU paths: its template's name, and
// the pass that its build draws in where that is not the shading.

import { SHADING_CUSTOM_FIRST } from '../generated/core';
import {
	PERMUTATION_CASTER,
	PERMUTATION_MOTION,
	PERMUTATION_PICK,
	PERMUTATION_PREPASS,
	TEMPLATE_MOTION,
} from '../generated/gpu';

/**
 * The name of the pipeline of `template` and `permutation`, from `label`, the template's own name.
 * A template of the sketch's WGSL takes its label, or else counts as a custom material. One of the
 * engine's own says so, before its label or its number.
 */
export function pipelineName(template: number, permutation: number, label?: string): string {
	const name =
		template >= SHADING_CUSTOM_FIRST
			? (label ?? `custom material ${template}`)
			: `engine template ${label ?? template}`;
	if (permutation & PERMUTATION_CASTER) return `${name}, its shadow caster build`;
	if (template !== TEMPLATE_MOTION && permutation & PERMUTATION_MOTION)
		return `${name}, its motion build`;
	if (permutation & PERMUTATION_PICK) return `${name}, its pick build`;
	if (permutation & PERMUTATION_PREPASS) return `${name}, its depth prepass build`;
	return name;
}
