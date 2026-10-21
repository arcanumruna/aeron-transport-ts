# Source and test mapping

One row per ported file (spec §5, §8.1). `aeron:` paths are relative to the Aeron `1.53.3` checkout and `agrona:`
paths to the Agrona `2.6.1` checkout (`npm run fetch:refs`). `npm run check:mapping` checks the **Tests** and
**Skipped tests** tables against both sides: every Java test name has a TS test of the same name and the reverse,
the counts are current, and every `it.skip` is listed with its reason.

## Sources

| Java source | TypeScript source | Notes |
|---|---|---|

## Tests

| Java test | TypeScript test | Java | TS | Notes |
|---|---|---|---|---|

## Skipped tests

| TypeScript test | Test | Reason |
|---|---|---|

## Renames

| Java | TypeScript | Reason |
|---|---|---|

## Not ported

Members of ported files left out because they serve only out-of-scope features (spec §3).

| Java member | Reason |
|---|---|
