# concepts-2-substance-17

Finding as given:

- page: concepts/particle-buffer
- anchor: Note under the title, line 11 ("Coding agents must not use these calls"); "the core", lines 15, 24, 33, 138-169
- category: unclear; severity: medium
- claim: The note gives an order to AI agents on a page for people, with no reason, while the rest of the page teaches the calls. A human reader cannot tell if the calls are safe to use. "The core" is used as a name but never explained or linked.
- evidence: docs/concepts/particle-buffer.md:11, 15, 24, 140.
- proposedEdit: "This is a low-level API. The particles add-on fills the buffer for you, and the null3D agent skills always use the add-on. Write records yourself only for an emitter that the add-on does not fit." At first use: "the engine's core ([Architecture](architecture.md))".

Verdict: partly

Evidence:

- Line 11 is the only page in docs/ with "Coding agents must not use these calls". The sentence gives no reason, and it is an order to a different reader. That part holds.
- The claim that a human "cannot tell if the calls are safe to use" is overstated. Line 11 itself says the API is experimental and tells the reader to use the particles add-on "unless you write your own emitter". Line 24 repeats it: "Use the add-on for most work. This page covers the buffer itself, for an emitter that the add-on does not fit." So a human gets clear guidance.
- "The core" (lines 15, 24, 33, 34, 138, 140, 165, 169) is never explained or linked on this page. docs/concepts/architecture.md:20 and :40 name it as "Engine core (Rust, WebAssembly)", so the proposed link target is right.
- skills/null3d-develop/SKILL.md:137 sends particle work to `@null3d/particles` and `api/particles`. So "the agent skills use the add-on" is true, but "always" is more than the skill says.
- The proposed note drops the useful warning that the API is experimental and can change. It should stay. The note also opens with "Roadmap step 0.2", an internal process word that AGENTS.md bars from docs/; the edit should remove it on purpose, not by accident.

Corrected claim: The note's last sentence gives an unexplained order to coding agents on a page for people, and "the core" is used on many lines with no explanation or link. Human readers do get guidance (line 11 and line 24 say to use the add-on unless the add-on does not fit), so the safety question is less severe than claimed.

Corrected edit (line 11):

> First released in null3D 0.1.0. The API is experimental, so it can still change between versions. This is a low-level API. The [particles add-on](../api/particles.md) fills this buffer for you, and the null3D agent skills use the add-on. Write records yourself only for an emitter that the add-on does not fit.

Line 24, at first use in prose: "then write the records in the engine's core (the Rust and WebAssembly part of the engine; see [Architecture](architecture.md))."
