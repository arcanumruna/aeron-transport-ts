# aeron-transport-ts — working rules

A one-to-one TypeScript port of the Aeron 1.53.3 Java UDP transport (and the Agrona 2.6.1 subset it needs).
Design: [docs/specs/2026-10-21-aeron-transport-ts-design.md](docs/specs/2026-10-21-aeron-transport-ts-design.md).
Plans: `docs/plans/`. Mapping: [docs/mapping.md](docs/mapping.md).

## Porting rules

- **Test first.** Port the Java `*Test.java` to `test/<path>/<Name>.test.ts` before the class: same test names,
  same order, same steps and values. Run it red, then port the class until green.
- **One file per Java file**, `io/aeron/<pkg>/X.java` → `src/client|driver/<pkg>/X.ts`,
  `org/agrona/<pkg>/X.java` → `src/agrona/<pkg>/X.ts`. Same names, same member order, same branches.
- File header: `// Port of <java path> @ <version>` plus Aeron's Apache-2.0 copyright block.
- A Java test that cannot apply is `it.skip` with a reason, listed in `docs/mapping.md`. Never weaken an
  assertion silently.
- Every deviation from Aeron is in spec §6, every rename and skip in `docs/mapping.md`.
- Hot paths allocate nothing per message.

## Commands

`npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run fetch:refs`,
`npm run check:mapping`.

## Git

Branches `feature/<topic>` / `bugfix/<topic>` off `main`, merged through pull requests. Commit messages end with the
session's `Co-Authored-By:` trailer. No secrets, emails, IPs or local paths in the repo.
