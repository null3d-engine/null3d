# Claude Code instructions

Read `AGENTS.md` first: it holds the repository rules, and it links to the maintainer guides in `.dev/` that hold the detail.

Decision records live in `.dev/decisions/`, tracked in git beside the maintainer guides. Maintainers keep the build plan, research reports and experiments in `.internal/`, which git ignores. When `.internal/plan/null3d-plan.md` exists, it is the design reference for engine work. Published files, the maintainer guides and decision records among them, never point into `.internal/`, and the docs style check blocks them if they do.

The null3D agent skills load from `.claude/skills/`. `bun run skills` generates that folder from `skills/`, so edit `skills/`, never the copy.
