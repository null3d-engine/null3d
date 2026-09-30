import { afterAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageError } from './args.js';
import { readPng, writePng } from './png.js';
import { lint, typeCheck } from './project-checks.js';
import { sketchPagePath } from './sketch-page.js';
import {
	imageFiles,
	judgeImage,
	outcomeText,
	parseTestArgs,
	REFERENCES_DIR,
	RESULTS_DIR,
	summaryLine,
} from './test.js';
import { parseTestConfig } from './test-config.js';

/** A folder for the files of these tests, removed after them. */
const folder = mkdtempSync(join(tmpdir(), 'null3d-cli-test-'));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

/** A new empty folder inside the tests' folder. */
function newFolder(name: string): string {
	const path = join(folder, name);
	mkdirSync(path, { recursive: true });
	return path;
}

/** What parsing `args` throws, as the message a person sees. */
function mistake(args: string[]): string {
	try {
		parseTestArgs(args);
	} catch (error) {
		expect(error).toBeInstanceOf(UsageError);
		return (error as Error).message;
	}
	throw new Error(`${args.join(' ')} parsed without a mistake`);
}

describe('parseTestArgs', () => {
	it('draws on each test tier and keeps the references by default', () => {
		expect(parseTestArgs([])).toEqual({ updateReferences: false, help: false });
	});

	it('reads the tiers to draw on, and whether to update the references', () => {
		expect(parseTestArgs(['--gpu', 'webgl2,compat', '--update-references'])).toEqual({
			gpu: ['webgl2', 'compat'],
			updateReferences: true,
			help: false,
		});
	});

	it('refuses a tier it does not know, a repeated tier and an empty list', () => {
		const rule = '--gpu takes tiers from webgpu, compat, webgl2, joined by commas';
		expect(mistake(['--gpu', 'metal'])).toStartWith(rule);
		expect(mistake(['--gpu', 'webgl2,webgl2'])).toStartWith(rule);
		expect(mistake(['--gpu', ''])).toStartWith(rule);
	});
});

describe('parseTestConfig', () => {
	const exists = (file: string) => ['sketch.ts', 'src/boat.ts'].includes(file);

	it('reads each test, with the default size and every tier', () => {
		const text = JSON.stringify({
			tests: [
				{ name: 'start', sketch: 'sketch.ts', hold: 1.5 },
				{
					name: 'harbor-view',
					sketch: 'src/boat.ts?view=harbor',
					hold: 0,
					size: '640x360',
					tiers: ['webgl2'],
				},
				{ name: 'home', page: '/index.html', hold: 2 },
			],
		});
		expect(parseTestConfig(text, exists)).toEqual({
			tests: [
				{
					name: 'start',
					sketch: 'sketch.ts',
					hold: 1.5,
					size: [320, 180],
					tiers: ['webgpu', 'compat', 'webgl2'],
				},
				{
					name: 'harbor-view',
					sketch: 'src/boat.ts?view=harbor',
					hold: 0,
					size: [640, 360],
					tiers: ['webgl2'],
				},
				{
					name: 'home',
					page: '/index.html',
					hold: 2,
					size: [320, 180],
					tiers: ['webgpu', 'compat', 'webgl2'],
				},
			],
			problems: [],
		});
	});

	it('says what is wrong with each test', () => {
		const text = JSON.stringify({
			tests: [
				{ name: 'Start Screen', sketch: 'sketch.ts', hold: 1, time: 2 },
				{ name: 'both', sketch: 'sketch.ts', page: '/', hold: 1 },
				{ name: 'missing', sketch: 'gone.ts', hold: 700, size: '0x10', tiers: ['metal'] },
				{ name: 'outside', sketch: '/sketch.ts', hold: '1' },
				{ name: 'page', page: 'index.html', hold: 1, tiers: [] },
				{ name: 'page', page: '/', hold: 1 },
				{ name: 'page', page: '/', hold: 1 },
				'start',
			],
		});
		expect(parseTestConfig(text, exists).problems).toEqual([
			'the test Start Screen: "time" is not a setting of a test. A test takes name, sketch, page, hold, size, tiers',
			'the test Start Screen: "name" takes lowercase words joined by dashes, such as "harbor-at-night", not "Start Screen"',
			'the test both: give either "sketch", a sketch module to draw, or "page", a page to open',
			'the test missing: the sketch gone.ts does not exist',
			'the test missing: "hold" takes the sketch time in seconds, from 0 to 600, not 700',
			'the test missing: "size" takes a width and a height in pixels from 1 to 8192, such as 1280x720, not "0x10"',
			'the test missing: "tiers" lists each of webgpu, compat, webgl2 at most once, and at least one, not ["metal"]',
			`the test outside: "sketch" takes a path from the project's folder, such as "sketch.ts", not "/sketch.ts"`,
			'the test outside: "hold" takes the sketch time in seconds, from 0 to 600, not "1"',
			'the test page: "page" takes a path on the dev server that starts with /, such as "/", not "index.html"',
			'the test page: "tiers" lists each of webgpu, compat, webgl2 at most once, and at least one, not []',
			'two tests are named page',
			'test 8: each test is an object, such as { "name": "start", "sketch": "sketch.ts", "hold": 1.5 }',
		]);
	});

	it('says when the file is not JSON, or not a list of tests', () => {
		expect(parseTestConfig('{ tests: [] }', exists).problems[0]).toStartWith(
			'it is not valid JSON: ',
		);
		const shape =
			'it holds one object with a "tests" list and nothing else, such as { "tests": [{ "name": "start", "sketch": "sketch.ts", "hold": 1.5 }] }';
		expect(parseTestConfig('[]', exists).problems).toEqual([shape]);
		expect(parseTestConfig('null', exists).problems).toEqual([shape]);
		expect(parseTestConfig('{ "tests": [], "gpu": "webgl2" }', exists).problems).toEqual([shape]);
		expect(parseTestConfig('{ "tests": [] }', exists)).toEqual({ tests: [], problems: [] });
	});
});

describe('sketchPagePath', () => {
	it("gives the sketch page the sketch from the server's root, with its query, and the size", () => {
		const path = sketchPagePath('./src/boat.ts?view=harbor', [640, 360]);
		expect(path).toBe('/@null3d/sketch?sketch=%2Fsrc%2Fboat.ts%3Fview%3Dharbor&size=640x360');
		const params = new URL(path, 'http://localhost').searchParams;
		expect([params.get('sketch'), params.get('size')]).toEqual([
			'/src/boat.ts?view=harbor',
			'640x360',
		]);
	});
});

describe('imageFiles', () => {
	it("keeps references in the project's tests, and each run's images apart from them", () => {
		expect(imageFiles('/game', 'chrome-real-gpu', 'webgl2', 'start')).toEqual({
			reference: `/game/${REFERENCES_DIR}/chrome-real-gpu/webgl2/start.png`,
			image: `/game/${RESULTS_DIR}/chrome-real-gpu/webgl2/start.png`,
			diff: `/game/${RESULTS_DIR}/chrome-real-gpu/webgl2/start-diff.png`,
		});
	});
});

/** A 10 x 10 image of one gray, with `changed` pixels of the first row turned white. */
function gray(changed = 0) {
	const data = new Uint8Array(10 * 10 * 4).fill(128);
	data.fill(255, 0, changed * 4);
	return { width: 10, height: 10, data };
}

describe('judgeImage', () => {
	/** The files of a test in a new project folder, with its reference when it has one. */
	function files(name: string, reference?: ReturnType<typeof gray>) {
		const found = imageFiles(newFolder(name), 'chrome-real-gpu', 'webgl2', 'start');
		if (reference) writePng(found.reference, reference);
		return found;
	}

	it('passes an image within the tolerance of its reference', () => {
		const found = files('pass', gray());
		const outcome = judgeImage(gray(), found, false);
		expect(outcome.status).toBe('PASS');
		expect(outcome.text).toStartWith('it matches the reference (image ');
		expect(existsSync(found.diff)).toBe(false);
	});

	it('fails an image that differs, and saves the diff', () => {
		const found = files('differs', gray());
		const outcome = judgeImage(gray(3), found, false);
		expect(outcome).toEqual({
			status: 'FAIL',
			text: `3.000% of pixels differ from the reference, and at most 0.100% may (image ${found.image}, reference ${found.reference}, diff ${found.diff})`,
		});
		expect(readPng(found.diff)).toMatchObject({ width: 10, height: 10 });
		expect(readPng(found.reference).data).toEqual(gray().data);
	});

	it('fails an image without a reference, and says how to keep it', () => {
		const found = files('missing');
		expect(judgeImage(gray(), found, false)).toEqual({
			status: 'FAIL',
			text: `there is no reference yet. When the image is right, bunx @null3d/cli test --update-references keeps it as the reference (image ${found.image})`,
		});
		expect(existsSync(found.reference)).toBe(false);
	});

	it('fails an image of another size than its reference', () => {
		const found = files('size', { width: 5, height: 20, data: new Uint8Array(400) });
		expect(judgeImage(gray(), found, false).text).toStartWith(
			'the image is 10 x 10 pixels, and the reference 5 x 20 (image ',
		);
	});

	it('keeps a new or changed image as the reference when asked to', () => {
		const missing = files('update-missing');
		expect(judgeImage(gray(), missing, true)).toEqual({
			status: 'SAVED',
			text: `there was no reference, so the image is the reference now (reference ${missing.reference})`,
		});
		expect(readPng(missing.reference).data).toEqual(gray().data);
		const changed = files('update-changed', gray());
		expect(judgeImage(gray(5), changed, true)).toEqual({
			status: 'SAVED',
			text: `5.000% of pixels differed from the old reference, so the image is the reference now (reference ${changed.reference}, diff ${changed.diff})`,
		});
		expect(readPng(changed.reference).data).toEqual(gray(5).data);
		// An image that matches its reference keeps it.
		expect(judgeImage(gray(5), changed, true).status).toBe('PASS');
	});
});

describe('outcomeText and summaryLine', () => {
	it('prints each result on its own line, with the lines under it indented', () => {
		expect(
			outcomeText({
				status: 'FAIL',
				text: 'type check (tsc --noEmit): 1 error',
				details: ["a.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'."],
			}),
		).toBe(
			[
				'FAIL  type check (tsc --noEmit): 1 error',
				"      a.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.",
			].join('\n'),
		);
		expect(outcomeText({ status: 'SAVED', text: 'start on webgl2' })).toBe('SAVED start on webgl2');
	});

	it('counts the results by status', () => {
		const outcome = (status: 'PASS' | 'FAIL' | 'SKIP' | 'SAVED') => ({ status, text: '' });
		expect(summaryLine(['PASS', 'PASS', 'FAIL', 'SKIP'].map(outcome as never))).toBe(
			'2 passed, 1 failed, 1 skipped.',
		);
		expect(summaryLine(['PASS', 'SAVED'].map(outcome as never))).toBe(
			'1 passed, 1 reference saved.',
		);
	});
});

describe('the checks of the code', () => {
	it('skip a project without a tsconfig.json or a lint script', async () => {
		const root = newFolder('bare');
		expect(await typeCheck(root)).toEqual({
			status: 'SKIP',
			text: 'type check: the project has no tsconfig.json',
		});
		expect(await lint(root)).toEqual({
			status: 'SKIP',
			text: "lint: the project's package.json has no lint script",
		});
	});

	it('skip the type check of a project that does not install TypeScript, and say how to add it', async () => {
		const root = newFolder('no-typescript');
		writeFileSync(join(root, 'tsconfig.json'), '{}');
		expect((await typeCheck(root)).text).toBe(
			'type check: the project has a tsconfig.json but does not install TypeScript. Add it with bun add -d typescript',
		);
	});

	/** A project whose TypeScript prints what `tsc` prints and exits with `code`. */
	function projectWithTsc(name: string, tsconfig: string, output: string, code: number): string {
		const root = newFolder(name);
		writeFileSync(join(root, 'tsconfig.json'), tsconfig);
		const typescript = join(root, 'node_modules/typescript');
		mkdirSync(join(typescript, 'bin'), { recursive: true });
		writeFileSync(join(typescript, 'package.json'), '{ "name": "typescript" }');
		writeFileSync(
			join(typescript, 'bin/tsc'),
			`console.log(${JSON.stringify(output)} + process.argv.slice(2).join(' ')); process.exit(${code});`,
		);
		return root;
	}

	it("type check with the project's own TypeScript, and list the errors of a failure", async () => {
		const passing = projectWithTsc('tsc-pass', '{}', '', 0);
		expect(await typeCheck(passing)).toEqual({ status: 'PASS', text: 'type check (tsc --noEmit)' });
		const error = "a.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.\n";
		const failing = projectWithTsc('tsc-fail', '{}', error, 2);
		expect(await typeCheck(failing)).toEqual({
			status: 'FAIL',
			text: 'type check (tsc --noEmit): 1 error',
			details: [error.trim(), '--noEmit --pretty false'],
		});
	});

	it('build each project that a config of project references names', async () => {
		const tsconfig = '{\n  "files": [],\n  "references": [{ "path": "./tsconfig.app.json" }]\n}';
		const root = projectWithTsc('tsc-references', tsconfig, '', 0);
		expect((await typeCheck(root)).text).toBe('type check (tsc --build --noEmit)');
	});

	it("run the project's lint script, and show what it printed when it fails", async () => {
		const root = newFolder('lint');
		const script = (code: number) =>
			writeFileSync(
				join(root, 'package.json'),
				JSON.stringify({
					scripts: { lint: `node -e "console.log('src/a.ts: unused x'); process.exit(${code})"` },
				}),
			);
		script(0);
		expect((await lint(root)).status).toBe('PASS');
		script(1);
		expect(await lint(root)).toEqual({
			status: 'FAIL',
			text: `lint (node -e "console.log('src/a.ts: unused x'); process.exit(1)"): it exited with 1`,
			details: ['src/a.ts: unused x'],
		});
	});
});
