# Repository Guidance

- Prefer the most robust scalable design over the shortest implementation path.
- Do not expose internal storage formats to the model when a typed domain interface can sit in front of them.
- If the current structure is brittle, refactor the boundary instead of adding another workaround on top.
- Treat compatibility shims as temporary migration aids, not the primary architecture.
- For assistant features, keep the model-facing tool surface high-level, typed, and validated before state is mutated.
