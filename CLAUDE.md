# Claude Code instructions

Read `AGENTS.md` first: it holds the repository rules.

Maintainers keep the build plan, research reports and decision records in `.dev/`, which git ignores. When `.dev/plan/null3d-plan.md` exists, it is the design reference for engine work. Public files never point at it.

The null3D agent skills load from `.claude/skills/`. `bun run skills` generates that folder from `skills/`, so edit `skills/`, never the copy.
