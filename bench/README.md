# Micro benches and the regression gate

Low latency is the requirement, so a slowdown fails like a red test (plan, "Performance gates").

## Running

```
npm run bench:micro                       # every bench in bench/micro/*.bench.ts
npm run bench:micro -- --filter ManyToOne # benches whose name contains the text
npm run bench:micro -- --samples 500 --json
```

One JSON line per bench goes to stdout, `{name, nsPerOp, p50, p99, p999, samples, opsPerSec?}`, and a table goes to stderr
(not with `--json`). A bench that fails prints `{name, error}` instead. `bench:micro` starts node with `--expose-gc`.

A bench file exports `benches: Bench[]` (`bench/lib/types.ts`): either `{name, setup, op, opsPerSample, teardown?}`, whose
`op` the runner times in batches of `opsPerSample` with `performance.now()` around the batch (never around one
operation), or `{name, run}` for a bench with workers, which returns its own samples.

**What a number is.** The runner warms up once (200k operations or 1 s, whichever comes first), then runs the bench
`R = 3` times in the process; before each timed run it calls `gc()` and yields one turn of the event loop
(`setImmediate`), so that a collection does not land in the timed region. Each run takes `--samples` samples (default 2000) and reports ns/op (total time / total operations) and the p50, p99 and p99.9 of the per-sample ns/op. The result
is the **median of the three runs per metric**. A worker bench also reports ops/s. **The percentiles are of batch
means**: a sample is the mean ns/op of a batch of `opsPerSample` operations (a window of messages for the worker
bench), never of one operation, so p99 and p99.9 are tail figures of batch means and understate single-operation tails.
Everything is seeded or fixed apart from the A/B order of the gate.

`bench.op` goes through one shared call site on both sides: the runner calls it the same way for every bench, so the
call is megamorphic in both base and candidate and its cost is part of both numbers alike; the ratio is meaningful, the
absolute ns/op also includes that call.

The worker bench uses `PRODUCERS = min(4, availableParallelism() - 2)` producer workers and the main thread as the
consumer. With fewer than three cores there is no producer: it prints an error line (`no-verdict: ...`) and the gate
reports NO_VERDICT for it.

## The gate

```
npm run bench:gate -- --base <ref> [--pairs n] [--filter s] [--samples n] [--seed n] [--ignore-load]
```

It extracts `<ref>` (default `origin/main`) with `git archive` into a scratch directory under the temp directory,
outside the repository, copies the candidate's `bench/` and worker loader into it, and runs each bench file as a
separate process on both sides, `--pairs` times (default 5; latency benches need 5, throughput benches 3). The candidate
is the working tree. **The order within a pair is random**: a seeded PRNG (mulberry32) decides per pair and file whether
the base or the candidate runs first, so that neither always runs first. The seed is printed (`seed ...`) and settable
with `--seed`, which repeats the order. Bench processes start with `--expose-gc`. The scratch directory is deleted at
the end, also on a failure.

**Load.** The gate prints `os.loadavg()` first. If the 1-minute load average is over 0.5 x `os.availableParallelism()`
it prints a warning and exits 3 (NO_VERDICT) without running. `--ignore-load` overrides this for local experiments and
the gate prints that it was used.

**It never passes without a verdict.** The benches expected are the ones the candidate's bench modules export, not the
ones a run printed (`summarize` in `bench/lib/verdict.ts`):

- a bench missing from any candidate run, or an error of the candidate, is a FAIL;
- a bench file that fails to import in the base (`import:`) is `n/a in base` and passes; any other failure of the base
  (a bench new in the candidate whose setup fails, a base process that died, no result printed) is NO_VERDICT;
- a metric with no valid ratio (NaN, zero or missing values) is NO_VERDICT, not a pass;
- a bench with fewer pairs than required (5 latency, 3 throughput) is NO_VERDICT.

For each bench and metric the verdict is on the **median of the per-pair ratios candidate / base** (for an even number
of pairs, the mean of the two middle ratios). It fails when the median is

| metric     | limit      | when                                      |
| ---------- | ---------- | ----------------------------------------- |
| ns/op, p50 | over 1.05  | always                                    |
| p99, p99.9 | over 1.10  | only with at least 20,000 samples per run |
| ops/s      | under 0.95 | always (throughput benches)               |

Below 20,000 samples (the default of 2000 is below) p99 and p99.9 are information: the table shows their ratio with a
`~`, and they decide nothing. A median exactly on a limit passes. A failure names the bench, the metric, the median
ratio and every pair's ratio.

| exit code | meaning                                                  |
| --------- | -------------------------------------------------------- |
| 0         | everything passes                                        |
| 1         | a FAIL                                                   |
| 2         | a usage error                                            |
| 3         | a NO_VERDICT without a FAIL (also: the host is too busy) |

The verdict logic is `bench/lib/verdict.ts`, tested in `test/extra/bench/GateVerdict.test.ts`.

**Noise is never a verdict: rerun with `--pairs 15`, then bisect.** Run it on an idle machine; shared CI runners are
too noisy for latency, so CI only runs the benches once per PR and reports the numbers.

## Baselines

`npm run bench:micro`, one run, 2026-10-22, Node v22.22.0, Intel(R) Xeon(R) Processor @ 2.10GHz (4 cores, a shared
host that was not idle: indicative only). All over a `SharedArrayBuffer` of 64 KiB, 64 byte messages, ns per operation.

| Bench                                                        | ns/op | p50   | p99     | p99.9   | ops/s     |
| ------------------------------------------------------------ | ----- | ----- | ------- | ------- | --------- |
| OneToOneRingBuffer write+read 64B                            | 307.8 | 277.7 | 614.5   | 1,551.1 |           |
| OneToOneRingBuffer tryClaim+commit+read 64B                  | 393.3 | 376.0 | 1,031.7 | 2,530.1 |           |
| ManyToOneRingBuffer write+read 64B (1 producer)              | 429.1 | 397.9 | 842.4   | 2,509.7 |           |
| ManyToOneRingBuffer tryClaim+commit+read 64B (1 producer)    | 330.8 | 305.8 | 596.7   | 1,331.2 |           |
| ManyToOneRingBuffer write 64B (producer workers, 1 consumer) | 316.2 | 284.9 | 776.2   | 2,067.5 | 3,162,956 |

The position and heartbeat operations of these rings are `long` operations on a shared buffer, which allocate a
`bigint` per call until UnsafeBuffer gets an allocation-free 64-bit atomic; the baselines will move when it lands.

`npm run bench:micro -- --file broadcast`, one run, 2026-10-26, same Node and host (load average 1.6 at the start, so indicative
only). Over a `SharedArrayBuffer` of 64 KiB, 64 byte messages, one thread, ns per operation. `receiveNext` includes `typeId`,
`offset`, `length` and `validate`.

| Bench                                                             | ns/op | p50   | p99     | p99.9   |
| ----------------------------------------------------------------- | ----- | ----- | ------- | ------- |
| BroadcastTransmitter transmit + BroadcastReceiver receiveNext 64B | 400.9 | 377.7 | 753.1   | 1,184.9 |
| BroadcastTransmitter transmit + CopyBroadcastReceiver receive 64B | 497.5 | 468.2 | 1,046.3 | 2,040.4 |

`npm run bench:micro -- --file loss` and `--file congestion`, one run, 2026-10-26, same Node and host (load average 0.1 at the
start, 4 cores), ns per operation. `scan` is `LossDetector.scan` over a full 64 KiB term (1024 frames of 64 bytes; the gap
bench misses one frame in the middle). A cycle is `onNak` (delay 1 ns), `processTimeouts` (resend), `processTimeouts` (linger
expired, the action is free again); "near 2^40" uses clock values from 2^40 and term id 2^24 (heap numbers, spec 5.3).
`onTrackRebuild` of Cubic reports a loss on every 64th call. The benches import the whole client, so the scripts start
node with `--experimental-transform-types` (the sources use parameter properties).

| Bench                                                                | ns/op   | p50     | p99     | p99.9    |
| -------------------------------------------------------------------- | ------- | ------- | ------- | -------- |
| LossDetector scan 64KiB term, no gap                                 | 5,734.8 | 5,676.0 | 7,810.5 | 17,922.9 |
| LossDetector scan 64KiB term, one gap                                | 2,286.5 | 2,012.4 | 4,248.3 | 4,705.8  |
| RetransmitHandler onNak+processTimeouts+linger, unicast              | 25.7    | 23.4    | 46.2    | 67.7     |
| RetransmitHandler onNak+processTimeouts+linger, group(16)            | 80.0    | 73.4    | 146.0   | 240.8    |
| RetransmitHandler onNak+processTimeouts+linger, unicast, near 2^40   | 34.0    | 29.7    | 71.5    | 349.2    |
| RetransmitHandler onNak+processTimeouts+linger, group(16), near 2^40 | 86.5    | 82.9    | 178.0   | 345.7    |
| CubicCongestionControl onTrackRebuild                                | 29.7    | 24.4    | 78.7    | 273.8    |
| StaticWindowCongestionControl onTrackRebuild                         | 9.6     | 9.2     | 26.6    | 51.6     |
| UnicastFlowControl onStatusMessage                                   | 26.8    | 25.3    | 42.9    | 54.4     |

`npm run bench:micro -- --file transport`, one run, 2026-10-26 (re-run after review batch 2; load average 0.49 at the start, 4 cores), ns
per operation. These are the per-datagram paths of `UdpChannelTransport` (spec 4.2): `onMessage` is the `'message'` handler
(ring offer, source address, wake-up) and `receive` copies the datagram into the poller's buffer; "two senders alternating"
looks up the second sender in the bounded source address intern table (16 entries, review batch 2; before it, the
address was rebuilt on every datagram: 242.9 ns/op, p99 441.7); `sendTo` / `send` copy 1408
bytes to the send slot and hand them to a socket that does nothing, so these numbers are this port's own cost and not the
kernel's. None of them allocates once the senders are in the intern table, which holds 16 (`expectNoAllocation` in `UdpChannelTransportExtraTest`, with 1, 2 and 16 senders); a sender that is not in the table, or was evicted round-robin from a full one, allocates one address.

| Bench                                                               | ns/op | p50  | p99   | p99.9 |
| ------------------------------------------------------------------- | ----- | ---- | ----- | ----- |
| UdpChannelTransport onMessage+receive 128B, repeated sender         | 56.5  | 55.3 | 99.4  | 234.2 |
| UdpChannelTransport onMessage+receive 128B, two senders alternating | 52.3  | 47.3 | 107.9 | 205.3 |
| UdpChannelTransport sendTo 1408B (slot copy + socket.send)          | 43.3  | 40.0 | 76.0  | 99.0  |
| UdpChannelTransport send 1408B, connected (slot copy + socket.send) | 39.7  | 39.1 | 68.3  | 125.7 |

`npm run bench:micro -- --file endpoint`, one run, 2026-10-26, same Node and host (load average 0.94 at the start, 4 cores, so
indicative only: a run before it measured the first row at 72 ns and the last two status message rows 25% lower), ns per
operation. These are the per-datagram paths of the channel endpoints (T13) and of the dispatcher (T14): a poll is `onMessage`
(a datagram into the ring) and one `pollTransports()` (ring pop and copy, frame validation, routing by type, the endpoint
callback, and then a dispatcher or publication that counts, or the real `DataPacketDispatcher` that finds the stream and the
session and calls an image that counts); `send` and `sendStatusMessage` end at a socket that does nothing, so these numbers
are this port's own cost and not the kernel's. The status message poll includes the three counter updates of a status
message on real counters (`incrementRelease` of a shared counter); the timestamp bench stamps four begin frames of one packet.
None of them allocates (`expectNoAllocation` in `EndpointsHotPathAllocationTest` and `DataPacketDispatcherAllocationTest`).

| Bench                                                                                                | ns/op | p50   | p99   | p99.9 |
| ---------------------------------------------------------------------------------------------------- | ----- | ----- | ----- | ----- |
| DataTransportPoller poll: ReceiveChannelEndpoint data frame 128B (ring, validate, route, dispatcher) | 69.6  | 64.4  | 133.5 | 551.3 |
| DataTransportPoller poll: data frame 128B to DataPacketDispatcher to PublicationImage.insertPacket   | 119.5 | 106.7 | 256.6 | 487.6 |
| ControlTransportPoller poll: SendChannelEndpoint status message (ring, validate, route, publication) | 269.1 | 247.3 | 515.3 | 852.6 |
| SendChannelEndpoint send 1408B, connected (slot copy + socket.send)                                  | 33.4  | 31.4  | 76.7  | 122.7 |
| SendChannelEndpoint send 1408B, connected, channel send timestamp on 4 begin frames                  | 319.5 | 313.0 | 645.0 | 710.0 |
| ReceiveChannelEndpoint sendStatusMessage (frame, slot copy + socket.send)                            | 220.3 | 206.0 | 436.2 | 606.7 |
| ReceiveChannelEndpoint sendStatusMessage with a group tag                                            | 285.0 | 268.1 | 547.6 | 1,216 |
