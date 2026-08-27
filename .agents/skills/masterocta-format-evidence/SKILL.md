---
name: masterocta-format-evidence
description: Use when researching or changing Octatrack file-format semantics, including .work or .strd files, Project, Bank, Part, Pattern, Track, Scene, Slot, sample settings, parsers, or inferred binary/text meanings. Do not use for general audio processing or unrelated UI work.
---

# MasterOCTa Format Evidence

Do not promote a plausible interpretation into an Octatrack format fact without
traceable evidence.

1. Identify the domain concept being changed and the exact facts the change
   requires.
2. Read [references/source-policy.md](references/source-policy.md) before
   evaluating evidence.
3. For each source, separate documented facts, reproduced observations,
   inferences, and unresolved unknowns.
4. If credible sources conflict, do not combine them by guesswork. Stop and
   report the conflict, affected behavior, and evidence needed to resolve it.
5. Do not assign meaning to an unverified field from its name, position,
   appearance, or a single coincidental value.
6. Prefer parsers and codecs that preserve unknown fields and bytes rather than
   normalizing or discarding them.
7. Treat behavior observed in a fixture as evidence only for the recorded
   version and fixture scope, not as a universal Octatrack specification.
8. When evidence changes a design, make its source and uncertainty traceable in
   documentation or in a specifically named test.

Keep unknown and unsupported states explicit and read-only. This evidence
workflow does not authorize access to original media or destructive testing.
