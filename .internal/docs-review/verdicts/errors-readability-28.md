# Verdict: errors-readability-28

## Finding as given

```json
{
 "page": "errors/E1505",
 "anchor": "page line 13",
 "category": "long-paragraph",
 "severity": "low",
 "claim": "The cause is 112 words in 6 sentences, and it lists target rules that read better as a list.",
 "evidence": "stats.json E1505: line 6 (112, 6). codes.ts line 606.",
 "proposedEdit": "Cause: 'A render pass draws into targets that one GPU render pass cannot hold together.' Then bullets: different size; different sample counts; two depth targets; a whole texture array; no target; more than four color targets; more than 32 bytes per sample. Then one sentence on resolve passes.",
 "generatedSource": "packages/engine/src/errors/codes.ts (E1505)",
 "id": "errors-readability-28",
 "slice": "errors",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- The claim holds. stats.json gives 112 words and 6 sentences at line 6 (the front matter summary). The same text is the "What happened" paragraph at page line 13. It is a run of seven separate target rules plus a resolve-pass rule, which is list-shaped.
- The cause text is at codes.ts line 606 (the `cause` field of E1505). No other error entry puts newlines or Markdown lists in its cause.
- The proposed edit cannot go into the `cause` string as written. tools/lib/docs.ts uses `entry.cause` in three places:
  - line 442: the front matter `summary` (a YAML string),
  - line 448: the "What happened" body,
  - line 466: one table row on docs/errors/index.md, passed through `tableCell`, which escapes only pipes (tools/lib/api-docs.ts line 476).
  A bullet list (newlines) in `cause` would break the E1505 row of the error index table (index.md line 92) and put a list into the page summary.
- So the fix needs a change to the generator as well as codes.ts, which the finding does not name.

## Corrected claim

The cause paragraph is long and list-shaped, but the `cause` string also feeds the page summary and a single-line table row on the error index, so a bullet list cannot go in that string.

## Corrected edit

- In codes.ts, cut the E1505 `cause` to its first sentence: "A render pass draws into targets that one GPU render pass cannot hold together." This also gives a short summary and a short index row.
- Add an optional list field to the error entry type (for example a list of rules), and have `errorPage` in tools/lib/docs.ts render it as bullets under "What happened". The index table and front matter keep using only `cause`.
- E1505 bullets: a target has another size than the pass; the targets have different sample counts; two depth targets; a whole texture array instead of one layer; no target; more than four color targets; color targets of more than 32 bytes per sample (some devices cannot hold this); a resolve pass whose target is not multisampled, not in the canvas's format and size, or read by another running pass.
- Optional: the bytes-per-sample and resolve rules are implementer detail and could sit in a `<details><summary>Technical details: ...</summary>` block, but the list alone is enough at low severity.
