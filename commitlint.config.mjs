export default {
	extends: ['@commitlint/config-conventional'],
	// A merge commit is judged by what it merges, not by a conventional type; the default ignores
	// name the branch and pull-request wordings, and a merge that names its subject is a merge too.
	ignores: [(message) => /^Merge /m.test(message)],
	rules: {
		// Trailers such as Docs-Checked: name the pages that were re-read, which can run long.
		'footer-max-line-length': [0],
	},
};
