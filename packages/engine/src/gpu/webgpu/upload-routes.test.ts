import { describe, expect, it } from 'bun:test';
import {
	STAGING_MAX_BYTES,
	STAGING_MIN_BYTES,
	TIME_EVERY,
	TRY_EVERY,
	UploadRoutes,
} from './upload-routes';

const MIB = 1024 * 1024;
/** Uploads of one class from one try of the costlier route to the next. */
const WINDOW = TIME_EVERY * TRY_EVERY;

/**
 * Sends `count` uploads of `size` bytes, one per submit, as the backend does: it times an upload
 * only in a timed submit, costing each route its given milliseconds per MiB. Returns how many
 * uploads took each route.
 */
function drive(
	routes: UploadRoutes,
	size: number,
	count: number,
	cost: { direct: number; ring: number },
): { direct: number; ring: number } {
	const taken = { direct: 0, ring: 0 };
	for (let i = 0; i < count; i++) {
		const timed = routes.timing;
		const ring = routes.takesRing(size);
		taken[ring ? 'ring' : 'direct']++;
		const ms = (ring ? cost.ring : cost.direct) * (size / MIB);
		if (timed && ring) routes.wroteToRing(size, ms);
		else if (timed) routes.wroteDirect(size, ms);
		routes.submitted(false);
	}
	return taken;
}

describe('UploadRoutes', () => {
	it('tries the ring first, then writeBuffer, then keeps to the cheaper route', () => {
		const routes = new UploadRoutes();
		expect(drive(routes, MIB, 2, { direct: 0.6, ring: 0.13 })).toEqual({ direct: 1, ring: 1 });
		const taken = drive(routes, MIB, WINDOW * 4, { direct: 0.6, ring: 0.13 });
		expect(taken).toEqual({ direct: 4, ring: WINDOW * 4 - 4 });
	});

	it('keeps to writeBuffer where it is cheaper, and tries the ring now and then', () => {
		const taken = drive(new UploadRoutes(), 1.5 * MIB, 2 + WINDOW * 4, { direct: 0.1, ring: 1 });
		expect(taken).toEqual({ direct: 2 + WINDOW * 4 - 5, ring: 5 });
	});

	it('switches when the chosen route gets costlier', () => {
		const routes = new UploadRoutes();
		drive(routes, MIB, 8, { direct: 0.6, ring: 0.13 });
		expect(routes.takesRing(MIB)).toBe(true);
		drive(routes, MIB, TIME_EVERY * 4, { direct: 0.6, ring: 5 });
		expect(routes.takesRing(MIB)).toBe(false);
	});

	it('keeps separate costs for each size class', () => {
		const routes = new UploadRoutes();
		drive(routes, STAGING_MIN_BYTES, 8, { direct: 0.1, ring: 1 });
		drive(routes, STAGING_MAX_BYTES - 4, 8, { direct: 1, ring: 0.1 });
		expect(routes.takesRing(STAGING_MIN_BYTES)).toBe(false);
		expect(routes.takesRing(STAGING_MAX_BYTES - 4)).toBe(true);
	});

	it("counts a submit's ring work against its ring uploads", () => {
		const routes = new UploadRoutes();
		routes.wroteDirect(MIB, 0.5);
		routes.wroteToRing(MIB, 0.1);
		routes.ringWork(2);
		routes.submitted(false);
		expect(routes.takesRing(MIB)).toBe(false);
	});

	it('records nothing from a submit for which the ring made a buffer, and tries again', () => {
		const routes = new UploadRoutes();
		expect(routes.takesRing(MIB)).toBe(true);
		routes.wroteToRing(MIB, 50);
		routes.submitted(true);
		expect(routes.timing).toBe(true);
		expect(routes.takesRing(MIB)).toBe(true);
	});

	it('times one submit in each few once the costs are known', () => {
		const routes = new UploadRoutes();
		drive(routes, MIB, 4, { direct: 0.6, ring: 0.13 });
		let timed = 0;
		for (let i = 0; i < TIME_EVERY * 10; i++) {
			if (routes.timing) timed++;
			routes.takesRing(MIB);
			routes.submitted(false);
		}
		expect(timed).toBe(10);
	});

	it('sends a class without costs through writeBuffer in an untimed submit, and times the next', () => {
		const routes = new UploadRoutes();
		// Read through a call, as a submit changes the flag behind the compiler's back.
		const timing = (): boolean => routes.timing;
		drive(routes, MIB, 4, { direct: 0.6, ring: 0.13 });
		while (timing()) {
			routes.takesRing(MIB);
			routes.submitted(false);
		}
		expect(routes.takesRing(STAGING_MIN_BYTES)).toBe(false);
		routes.submitted(false);
		expect(timing()).toBe(true);
		expect(routes.takesRing(STAGING_MIN_BYTES)).toBe(true);
	});

	it('keeps to a fixed route', () => {
		const direct = new UploadRoutes(false);
		const ring = new UploadRoutes(true);
		for (let i = 0; i < WINDOW * 2; i++) {
			expect(direct.takesRing(MIB)).toBe(false);
			expect(ring.takesRing(MIB)).toBe(true);
			direct.submitted(false);
			ring.submitted(false);
		}
	});
});
