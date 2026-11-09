// Pipe-model radii (Shinozaki 1964; Leonardo's rule): every shoot feeds a pipe of the twig's radius
// down to the ground, so a node's diameter to the exponent is the sum of its children's. Pipes of
// branches that were shed stay in the wood below them, so a stem never thins when its lower crown
// goes. The radii are then fitted to the species' stem diameter at breast height: the twigs keep the
// record's radius, and the wood's thickness beyond it scales so the stem matches.
import { pow } from '../core/math';

/**
 * Pipe radii from the tips down, over nodes whose parents come before them.
 *
 * @param count Nodes.
 * @param parent Each node's parent, or -1 at a stem base.
 * @param live 1 for each node that stands; the others carry nothing.
 * @param pipes Pipes that end at each node: its live shoots and the memory of what was shed there.
 * @param exponent The pipe exponent, 2 to 3.
 * @param tip A twig's radius in metres.
 * @param out Each node's radius in metres.
 */
export function pipeRadii(
	count: number,
	parent: Int32Array,
	live: Uint8Array,
	pipes: Float64Array,
	exponent: number,
	tip: number,
	out: Float64Array,
): void {
	const sum = new Float64Array(count);
	for (let n = count - 1; n >= 0; n--) {
		if (!live[n]) continue;
		const total = (sum[n] as number) + (pipes[n] as number);
		const carried = total > 0 ? total : 1;
		sum[n] = carried;
		const p = parent[n] as number;
		if (p >= 0) sum[p] = (sum[p] as number) + carried;
	}
	const inverse = 1 / exponent;
	for (let n = 0; n < count; n++) out[n] = tip * pow(sum[n] as number, inverse);
}

/**
 * Fits pipe radii to a stem radius: each radius keeps the twig's radius and scales its excess over
 * it, so a fork's thick limbs keep the exponent's proportions and the twigs keep their size.
 *
 * @param radius The radii, changed in place.
 * @param count Nodes.
 * @param tip A twig's radius in metres.
 * @param measured The stem's pipe radius where the target is measured.
 * @param target The radius the stem should have there.
 */
export function fitRadii(
	radius: Float64Array,
	count: number,
	tip: number,
	measured: number,
	target: number,
): void {
	if (!(measured > tip) || !(target > tip)) return;
	const k = (target - tip) / (measured - tip);
	for (let n = 0; n < count; n++) {
		const r = radius[n] as number;
		radius[n] = tip + Math.max(0, r - tip) * k;
	}
}
