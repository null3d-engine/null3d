#!/bin/sh
# Merges origin/main into the current branch, and resolves the clashes on generated files that git
# does not keep (D-105, .dev/pull-requests.md). A branch from before git stopped keeping them runs
# it straight from main, so it needs no copy of its own:
#   git fetch origin main && sh -c "$(git show origin/main:tools/merge-main.sh)"
# An argument names another commit to merge instead of origin/main.
# A generated file that main deleted stays deleted. A conflict whose branch side holds an old
# generated part of a written page, between null3d marker comments, takes main's side. Every other
# conflict is left for you to resolve; then run bun install and commit.
set -e

if git merge --no-edit "${1:-origin/main}"; then
	bun install
	exit 0
fi

# Conflicts on files that main deleted and now ignores: take the deletion and keep the file on disk.
git status --porcelain | sed -n 's/^UD //p' | git check-ignore --no-index --stdin |
	while IFS= read -r path; do git rm -q --cached -- "$path"; done

# Conflicts inside an old generated part of a written page: keep main's side.
for path in $(git diff --name-only --diff-filter=U); do
	perl -0pi -e 's/<<<<<<< [^\n]*\n((?:(?!=======\n).)*?<!-- null3d:[a-z-]+:(?:start|end) -->.*?)=======\n(.*?)>>>>>>> [^\n]*\n/$2/gs' "$path"
	grep -q '^<<<<<<< ' "$path" || git add -- "$path"
done

bun install
left=$(git diff --name-only --diff-filter=U)
if [ -n "$left" ]; then
	echo "Resolve these conflicts by hand, then run git commit --no-edit:"
	echo "$left"
	exit 1
fi
git commit --no-edit
