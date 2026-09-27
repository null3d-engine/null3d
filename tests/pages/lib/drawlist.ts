// A draw-list encoder and data arena for tests. It writes the same format as the Rust encoder
// (crates/sokko3d-gpu/src/drawlist.rs): a header word with the opcode in the low 8 bits and the
// command length in words above them, then 32-bit operands.

export class TestMemory {
	readonly buffer: ArrayBuffer;
	readonly bytes: Uint8Array;
	readonly words: Uint32Array;
	readonly floats: Float32Array;
	private top: number;

	/** `listWords` words at the start hold the draw list; data blobs follow. */
	constructor(
		bytes: number,
		private readonly listWords: number,
	) {
		this.buffer = new ArrayBuffer(bytes);
		this.bytes = new Uint8Array(this.buffer);
		this.words = new Uint32Array(this.buffer);
		this.floats = new Float32Array(this.buffer);
		this.top = listWords * 4;
	}

	/** Copies data into the arena and returns its byte address, aligned to 256 bytes. */
	put(data: ArrayBufferView): number {
		const at = Math.ceil(this.top / 256) * 256;
		this.bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), at);
		this.top = at + data.byteLength;
		if (this.top > this.buffer.byteLength) throw new Error('test memory is full');
		return at;
	}

	private length = 0;

	/** Appends one command. Floats pass through as their bits. */
	push(op: number, ...operands: number[]): void {
		const at = this.length;
		if (at + operands.length + 1 > this.listWords) throw new Error('test draw list is full');
		this.words[at] = op | ((operands.length + 1) << 8);
		operands.forEach((value, k) => {
			this.words[at + 1 + k] = value >>> 0;
		});
		this.length += operands.length + 1;
	}

	pushFloats(op: number, operands: (number | { f: number })[]): void {
		const at = this.length;
		this.words[at] = op | ((operands.length + 1) << 8);
		operands.forEach((value, k) => {
			if (typeof value === 'number') this.words[at + 1 + k] = value >>> 0;
			else this.floats[at + 1 + k] = value.f;
		});
		this.length += operands.length + 1;
	}

	get listLength(): number {
		return this.length;
	}

	reset(): void {
		this.length = 0;
	}
}

/** Column-major 4 x 4 perspective with reversed depth: 1 at the near plane, 0 at the far plane. */
export function perspectiveReversed(
	fovYRadians: number,
	aspect: number,
	near: number,
	far: number,
): Float32Array {
	const f = 1 / Math.tan(fovYRadians / 2);
	const m = new Float32Array(16);
	m[0] = f / aspect;
	m[5] = f;
	m[10] = near / (far - near);
	m[11] = -1;
	m[14] = (near * far) / (far - near);
	return m;
}

export function lookAt(eye: number[], target: number[], up = [0, 1, 0]): Float32Array {
	const sub = (a: number[], b: number[]) => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
	const norm = (v: number[]) => {
		const l = Math.hypot(v[0]!, v[1]!, v[2]!);
		return [v[0]! / l, v[1]! / l, v[2]! / l];
	};
	const cross = (a: number[], b: number[]) => [
		a[1]! * b[2]! - a[2]! * b[1]!,
		a[2]! * b[0]! - a[0]! * b[2]!,
		a[0]! * b[1]! - a[1]! * b[0]!,
	];
	const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
	const z = norm(sub(eye, target));
	const x = norm(cross(up, z));
	const y = cross(z, x);
	return new Float32Array([
		x[0]!,
		y[0]!,
		z[0]!,
		0,
		x[1]!,
		y[1]!,
		z[1]!,
		0,
		x[2]!,
		y[2]!,
		z[2]!,
		0,
		-dot(x, eye),
		-dot(y, eye),
		-dot(z, eye),
		1,
	]);
}

export function multiply(a: Float32Array, b: Float32Array): Float32Array {
	const out = new Float32Array(16);
	for (let c = 0; c < 4; c++) {
		for (let r = 0; r < 4; r++) {
			let sum = 0;
			for (let k = 0; k < 4; k++) sum += (a[k * 4 + r] as number) * (b[c * 4 + k] as number);
			out[c * 4 + r] = sum;
		}
	}
	return out;
}

/** The six frustum planes of a column-major view-projection matrix, for WebGPU clip space, normalized. */
export function frustumPlanes(m: Float32Array): Float32Array {
	const row = (i: number) => [m[i]!, m[4 + i]!, m[8 + i]!, m[12 + i]!];
	const [r0, r1, r2, r3] = [row(0), row(1), row(2), row(3)];
	const add = (a: number[], b: number[]) => a.map((v, k) => v + b[k]!);
	const sub = (a: number[], b: number[]) => a.map((v, k) => v - b[k]!);
	const planes = [add(r3, r0), sub(r3, r0), add(r3, r1), sub(r3, r1), r2, sub(r3, r2)];
	const out = new Float32Array(24);
	planes.forEach((p, k) => {
		const l = Math.hypot(p[0]!, p[1]!, p[2]!);
		out.set(
			p.map((v) => v / l),
			k * 4,
		);
	});
	return out;
}

/** A unit box centered at the origin: positions and normals interleaved, and 16-bit indices. */
export function boxMesh(size: number): { vertices: Float32Array; indices: Uint16Array } {
	const h = size / 2;
	const faces: [number[], number[], number[]][] = [
		[
			[1, 0, 0],
			[0, 0, -1],
			[0, 1, 0],
		],
		[
			[-1, 0, 0],
			[0, 0, 1],
			[0, 1, 0],
		],
		[
			[0, 1, 0],
			[1, 0, 0],
			[0, 0, -1],
		],
		[
			[0, -1, 0],
			[1, 0, 0],
			[0, 0, 1],
		],
		[
			[0, 0, 1],
			[1, 0, 0],
			[0, 1, 0],
		],
		[
			[0, 0, -1],
			[-1, 0, 0],
			[0, 1, 0],
		],
	];
	const vertices: number[] = [];
	const indices: number[] = [];
	faces.forEach(([n, u, v], f) => {
		for (const [su, sv] of [
			[-1, -1],
			[1, -1],
			[1, 1],
			[-1, 1],
		] as const) {
			vertices.push(
				n[0]! * h + u[0]! * su * h + v[0]! * sv * h,
				n[1]! * h + u[1]! * su * h + v[1]! * sv * h,
				n[2]! * h + u[2]! * su * h + v[2]! * sv * h,
				...n,
			);
		}
		const b = f * 4;
		indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
	});
	return { vertices: new Float32Array(vertices), indices: new Uint16Array(indices) };
}
