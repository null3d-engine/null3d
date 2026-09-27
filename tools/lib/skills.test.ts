import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { fixture } from './fixture';
import { checkSkills, docIdsIn, skillCopyProblems, syncSkills } from './skills';

const repoRoot = join(import.meta.dir, '../..');

const skill = (body: string) =>
	`---\nname: demo-skill\ndescription: Demonstrates the skills check.\n---\n\n# Demo\n\n${body}\n`;
const EVALS = JSON.stringify({ skill_name: 'demo-skill', evals: [] });
const PAGE =
	'---\nid: concepts/handles\ntitle: Handles\nstatus: planned\nsince: "0.1"\nsummary: S\n---\n';

describe('docIdsIn', () => {
	it('finds doc IDs in backticks, only in real docs areas', () => {
		expect(
			docIdsIn('see `concepts/handles` and `api/scene`, not `foo/bar` or `references/x.md`'),
		).toEqual(['concepts/handles', 'api/scene']);
	});
});

describe('checkSkills', () => {
	it('fails when a skill names a docs page that does not exist', () => {
		const root = fixture({
			'skills/demo-skill/SKILL.md': skill('Read `concepts/missing-page` first.'),
			'skills/demo-skill/evals/evals.json': EVALS,
		});
		syncSkills(root);
		const { problems } = checkSkills(root);
		expect(problems).toEqual([
			'docs page "concepts/missing-page" does not exist (named in skills/demo-skill/SKILL.md)',
		]);
	});

	it('fails when the mapping copy differs from its source', () => {
		const root = fixture({
			'docs/concepts/handles.md': PAGE,
			'docs/data/threejs-mapping.json': JSON.stringify({ entries: [] }),
			'skills/sokko3d-port-threejs/SKILL.md': skill('See `concepts/handles`.').replace(
				'demo-skill',
				'sokko3d-port-threejs',
			),
			'skills/sokko3d-port-threejs/evals/evals.json': EVALS.replace(
				'demo-skill',
				'sokko3d-port-threejs',
			),
			'skills/sokko3d-port-threejs/references/threejs-mapping.json': JSON.stringify({
				entries: [{ docs: 'concepts/handles' }],
			}),
		});
		syncSkills(root);
		expect(checkSkills(root).problems).toEqual([
			'skills/sokko3d-port-threejs/references/threejs-mapping.json differs from docs/data/threejs-mapping.json: run bun run docs',
		]);
	});

	it('fails when a skill copy is stale, missing or has no source', () => {
		const root = fixture({
			'docs/concepts/handles.md': PAGE,
			'skills/demo-skill/SKILL.md': skill('See `concepts/handles`.'),
			'skills/demo-skill/references/notes.md': 'notes',
			'skills/demo-skill/evals/evals.json': EVALS,
			'.claude/skills/demo-skill/SKILL.md': 'old',
			'.claude/skills/demo-skill/extra.md': 'extra',
		});
		expect(skillCopyProblems(root)).toEqual([
			'.claude/skills/demo-skill/SKILL.md is out of date: run bun run skills',
			'.claude/skills/demo-skill/references/notes.md is missing: run bun run skills',
			'.claude/skills/demo-skill/extra.md has no source in skills/: run bun run skills',
		]);
		syncSkills(root);
		expect(checkSkills(root).problems).toEqual([]);
	});

	it('fails when a skill points at the private build plan', () => {
		const root = fixture({
			'skills/demo-skill/SKILL.md': skill('The rules are in the build plan, section 4.'),
			'skills/demo-skill/evals/evals.json': EVALS,
		});
		syncSkills(root);
		expect(checkSkills(root).problems).toEqual([
			"skills/demo-skill/SKILL.md points at the maintainers' private build plan",
		]);
	});

	it('passes on the repository', () => {
		expect(checkSkills(repoRoot).problems).toEqual([]);
	});
});
