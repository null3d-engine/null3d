// Scratch probe (not for commit): does holding small array buffers shrink the room for 1 GiB
// shared memories, and does it matter whether the room's last count was freed first?
import { publish } from './lib/result';

const params = new URLSearchParams(location.search);
const SIZE = Number(params.get('size') ?? 1024) * 1024;
const N = Number(params.get('n') ?? 400);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const allocate = () => new WebAssembly.Memory({ initial: 18, maximum: 16384, shared: true });

function countRoom(): number {
	const memories: WebAssembly.Memory[] = [];
	try {
		while (memories.length < 64) memories.push(allocate());
	} catch {}
	return memories.length;
}
async function countAndRelease(): Promise<number> {
	const room = countRoom();
	await sleep(0);
	try {
		allocate();
	} catch {}
	return room;
}
function smalls(): ArrayBuffer[] {
	const held: ArrayBuffer[] = [];
	for (let i = 0; i < N; i++) {
		const b = new ArrayBuffer(SIZE);
		new Uint8Array(b)[0] = 1;
		held.push(b);
	}
	return held;
}

const steps: [string, number][] = [];
const note = async (what: string) => {
	steps.push([what, await countAndRelease()]);
	(document.getElementById('status') as HTMLElement).textContent = JSON.stringify(steps);
};

(async () => {
	await note('start');
	await sleep(2000);
	await note('after 2 s');
	let held: ArrayBuffer[] | undefined = smalls();
	await note(`holding ${N} x ${SIZE / 1024} KiB`);
	held = undefined;
	await sleep(3000);
	await note('dropped, 3 s later');
	// A count whose memories are not yet freed, then small buffers at once.
	countRoom();
	held = smalls();
	try {
		allocate();
	} catch {}
	await sleep(3000);
	await note(`small buffers made right after a count, held`);
	await sleep(5000);
	await note('5 s later, still held');
	held = undefined;
	await sleep(3000);
	await note('dropped, 3 s later');
	void held;
	await publish('zz-room-probe', { ok: true, size: SIZE, n: N, steps });
})();
