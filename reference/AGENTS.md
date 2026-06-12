## Working agreements
- Example placeholder rule — replace per project.

## AGENTS.md structure policy
- Prefer directory-scoped `AGENTS.md` files over centralized implementation docs.
- Place guidance in the nearest directory that owns the code.
- Keep root `AGENTS.md` focused on cross-cutting repository rules.
- Inheritance: root applies by default; the nearest `AGENTS.md` may add or
  override local rules.
