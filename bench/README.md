# Micro benches and the regression gate

Low latency is the requirement, so a slowdown fails like a red test (plan, "Performance gates").

## Running

```
npm run bench:micro                       # every bench in bench/micro/*.bench.ts
npm run bench:micro -- --filter ManyToOne # benches whose name contains the text
npm run bench:micro -- --samples 500 --json
```

One JSON line per bench goes to stdout, `{name, nsPerOp, p50, p99, p999, opsPerSec?}`, and a table goes to stderr (not
with `--json`). A bench that fails prints `{name, error}` instead.

A bench file exports `benches: Bench[]` (`bench/lib/types.ts`): either `{name, setup, op, opsPerSample, teardown?}`, whose
`op` the runner times in batches of `opsPerSample` with `performance.now()` around the batch (never around one
operation), or `{name, run}` for a bench with workers, which returns its own samples. The runner warms up (200k
operations or 1 s, whichever comes first), takes `--samples` samples (default 2000), and reports ns/op (total time /
total operations) and the p50, p99 and p99.9 of the per-sample ns/op. A worker bench also reports ops/s. Everything is
seeded or fixed: there is no randomness.

## The gate

```
npm run bench:gate -- --base <ref> [--pairs n] [--filter s] [--samples n]
```

It extracts `<ref>` (default `origin/main`) with `git archive` into a scratch directory under the temp directory,
outside the repository, copies the candidate's `bench/` and worker loader into it, and runs each bench file as a
separate process, base then candidate, base then candidate (A B A B), `--pairs` times (default 5; latency benches need
5, throughput benches 3). The candidate is the working tree. A bench whose import or setup fails in the base is
reported `n/a in base` and skipped. The scratch directory is deleted at the end, also on a failure.

For each bench and metric the verdict is on the **median of the per-pair ratios candidate / base** (for an even number
of pairs, the mean of the two middle ratios). It fails when the median is

| metric     | limit      |
| ---------- | ---------- |
| p99, p99.9 | over 1.10  |
| p50, ns/op | over 1.05  |
| ops/s      | under 0.95 |

A median exactly on a limit passes. A failure names the bench, the metric, the median ratio and every pair's ratio. The
exit code is 1 on any failure. The verdict logic is `bench/lib/verdict.ts`, tested in
`test/extra/bench/GateVerdict.test.ts`.

**Noise is never a verdict: rerun with `--pairs 15`, then bisect.** Run it on an idle machine; shared CI runners are
too noisy for latency, so CI only runs the benches once per PR and reports the numbers.

## Baselines

`npm run bench:micro`, one run, 2026-10-22, Node v22.22.0, Intel(R) Xeon(R) Processor @ 2.10GHz (4 cores, a shared
host that was not idle: indicative only). All over a `SharedArrayBuffer` of 64 KiB, 64 byte messages, ns per operation.

| Bench                                                          | ns/op | p50   | p99     | p99.9   | ops/s     |
| -------------------------------------------------------------- | ----- | ----- | ------- | ------- | --------- |
| OneToOneRingBuffer write+read 64B                              | 307.8 | 277.7 | 614.5   | 1,551.1 |           |
| OneToOneRingBuffer tryClaim+commit+read 64B                    | 393.3 | 376.0 | 1,031.7 | 2,530.1 |           |
| ManyToOneRingBuffer write+read 64B (1 producer)                | 429.1 | 397.9 | 842.4   | 2,509.7 |           |
| ManyToOneRingBuffer tryClaim+commit+read 64B (1 producer)      | 330.8 | 305.8 | 596.7   | 1,331.2 |           |
| ManyToOneRingBuffer write 64B (4 producer workers, 1 consumer) | 316.2 | 284.9 | 776.2   | 2,067.5 | 3,162,956 |

The position and heartbeat operations of these rings are `long` operations on a shared buffer, which allocate a
`bigint` per call until UnsafeBuffer gets an allocation-free 64-bit atomic; the baselines will move when it lands.
