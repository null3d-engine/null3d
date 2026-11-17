// The conifer family's adapter, read on its three directed records: the model holds the frame's
// axes and the plan's sockets one for one, the pieces are the record's own rules, and the inner
// body is a data axis whose ring count the shared bake reads. A record that states no piece rules
// emits no foliage, as its directed plan stands.
import { describe, expect, it } from 'bun:test';
import { directed as sequoia } from '../species/giant-sequoia/directed';
import { directed as cypress } from '../species/italian-cypress/directed';
import { directed as pine } from '../species/scots-pine/directed';
import { emitConifer } from './conifer';
import { crownOf } from './model';

const CONIFERS = [
	{ id: 'italian-cypress', record: cypress },
	{ id: 'scots-pine', record: pine },
	{ id: 'giant-sequoia', record: sequoia },
] as const;

const emit = (record: (typeof CONIFERS)[number]['record']) =>
	emitConifer({ record, seed: 11, variant: 0, season: record.seasons.default });

describe('the conifer adapter', () => {
	it('emits the Italian cypress’s frame, its sockets and its inner body', () => {
		const model = emit(cypress);
		expect(model.axes.length).toBe(1380);
		expect(model.sockets.length).toBe(1768);
		expect(model.pieces.map((piece) => piece.name)).toEqual(['fan']);
		expect(model.least).toBe(1);
		expect(model.scale).toBe(1);
		expect(model.keepShare).toBe(1);
		// The inner body is drawn wood at every state, and its ring count is the figure the shared
		// bake reads: its nodes less the one the closed surface ends on.
		const body = model.axes.find((axis) => axis.body === true);
		expect(body).toBeDefined();
		expect(body?.nodes?.length).toBe(44);
		expect(body?.segments).toBe(43);
		expect(body?.order).toBe(1);
		// Joined to nothing, so the allocator's trunk part draws it under every maximum.
		expect(body?.parent).toBe(-1);
		expect(body?.radius[0]).toBeCloseTo(0.3009, 4);
		expect(body?.radius[1]).toBeCloseTo(0.3724, 4);
		expect(model.axes.filter((axis) => axis.body === true).length).toBe(1);
		// The plant's foot is axis 0 and is not the body.
		expect(model.axes[0]?.body).toBe(false);
		expect(model.axes[0]?.parent).toBe(-1);
	});

	it('emits the Scots pine’s frame and sockets, and no body axis', () => {
		const model = emit(pine);
		expect(model.axes.length).toBe(1218);
		expect(model.sockets.length).toBe(2673);
		expect(model.pieces.map((piece) => piece.name)).toEqual(['bough']);
		expect(model.axes.some((axis) => axis.body === true)).toBe(false);
	});

	it('mirrors the giant sequoia’s directed plan, which states no piece rules yet', () => {
		const model = emit(sequoia);
		expect(model.axes.length).toBe(163);
		// The directed record states a patch but no socket rule and no pieces, so the plan lays no
		// foliage; the model shows that gap rather than inventing a piece.
		expect(model.pieces.length).toBe(sequoia.pieces?.length ?? 0);
		expect(model.pieces.length).toBe(0);
		expect(model.sockets.length).toBe(0);
	});

	it('states every socket on a real axis, with its order and share inside the axis', () => {
		for (const conifer of CONIFERS) {
			const model = emit(conifer.record);
			for (const socket of model.sockets) {
				const axis = model.axes[socket.axis];
				expect(axis).toBeDefined();
				if (!axis) continue;
				expect(socket.order).toBe(axis.order + 1);
				expect(socket.share).toBeGreaterThanOrEqual(0);
				expect(socket.share).toBeLessThanOrEqual(1);
				expect(socket.piece).toBeLessThan(model.pieces.length);
				expect(socket.keep).toBeGreaterThanOrEqual(0);
				expect(socket.keep).toBeLessThanOrEqual(1);
			}
			// The model's box is the pieces' own reading, not a figure stated beside them.
			const crown = crownOf(model.sockets, model.pieces);
			expect(model.crown.top).toBeCloseTo(crown.top, 9);
			expect(model.crown.base).toBeCloseTo(crown.base, 9);
			expect(model.crown.reach).toBeCloseTo(crown.reach, 9);
		}
	});
});
