# Micro benches and the regression gate

Low latency is the requirement, so a slowdown fails like a red test (plan, "Performance gates").

## Running

```
npm run bench:micro                       # every bench in bench/micro/*.bench.ts
npm run bench:micro -- --filter ManyToOne # benches whose name contains the text
npm run bench:micro -- --samples 500 --json
npm run bench:e2e                         # the end-to-end report (below): latency, throughput, allocation, first message after idle, fan-out
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
npm run bench:gate -- --base <ref> [--pairs n] [--filter s] [--file s] [--samples n] [--seed n] [--ignore-load] [--inject spec]
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

The verdict logic is `bench/lib/verdict.ts`, tested in `test/extra/bench/GateVerdict.test.ts` (every threshold, on both
sides, on made-up numbers). The whole gate is tested end to end in `test/extra/bench/GateEndToEndTest.test.ts`, with a real
bench (`TermReader read: 16 fragments of 64 B`) and real processes: a candidate with `--inject TermReader.read:+20%` must
fail it (exit 1, the ratios named), and the same commit as base and candidate must pass it (exit 0). The test works in a
scratch repository made of the sources of `HEAD` with the working tree's `bench/` and `test/support/` over them, so base
and candidate are the same commit whatever is uncommitted. The sizes are chosen for the verdict to be robust: 20% is four
times the 5% limit and the delay is 20% of the very call the bench times (calibrated in the bench process, so it is 20% on
any host); 9 pairs for the delay and 11 for the same commit, 1000 samples per run; and the gate's own rule for noise
applies: a first run that does not give the expected verdict is rerun once with 15 pairs, and the rerun counts. On the
4-core shared host of the baselines below, with the load average at 4 to 10, the 20% delay gave median ratios of 1.17 to
1.23 (p50 about 1.20), and the same commit gave median ratios of 0.96 to 1.05 in 7 of 8 runs of 11 pairs and 1.17 in one
(a busy host: the rerun with 15 pairs is for that). Each test takes about 40 s on a quiet host (the file 85 s), and more under the load of the
whole suite.

`--file s` runs only the bench files (`bench/micro/*.bench.ts`) whose name contains `s`. `--inject TermReader.read:+20%`
sets `AERON_BENCH_INJECT` for the **candidate** runs only (the base never inherits it); the bench process then wraps
`TermReader.read` with a busy loop of 20% of the median cost of one 16 fragment read, measured in that process
(`bench/lib/inject.ts`, spec D110). It exists to prove that the gate fails a slow candidate: the tests of the gate use it
(below), and nothing in `src/` has a hook.

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

### Sender (T15)

`bench/micro/sender.bench.ts`: `Sender.doWork` on a real `NetworkPublication` over an in-memory log (`SharedArrayBuffer`),
a `SendChannelEndpoint` whose socket does nothing and the position counters of the driver (64-bit atomics). The data bench
scans and sends one frame of 1024 B per cycle (term scan, copy to the send slot, socket hand-off, control poll, retransmit
timers) and moves the sender position back at the end of the 40 frames of the log. The heartbeat bench is two cycles: a data
frame at t=0 and the heartbeat at twice the timeout (so that the clock values stay small integers). The resend bench is
`NetworkPublication.resend` of two frames. None allocates (`expectNoAllocation` in `NetworkPublicationAllocationTest`).
Measured on a host with a load average of 6 on 4 cores (other tasks were running), so the figures are upper bounds; the
baseline for the gate is to be taken on the idle machine.

| Bench                                                                                           | ns/op   | p50     | p99     | p99.9   |
| ----------------------------------------------------------------------------------------------- | ------- | ------- | ------- | ------- |
| Sender doWork: one data frame of 1024 B (scan, copy to the send slot, socket)                   | 455.5   | 433.8   | 802.9   | 1,299.8 |
| Sender doWork: a data frame at t=0 then a heartbeat at t=2 x timeout (two cycles per operation) | 1,070.9 | 1,013.1 | 2,059.2 | 3,146.3 |
| NetworkPublication resend: 2 frames of 1024 B                                                   | 459.4   | 386.5   | 915.2   | 968.6   |

### Multicast flow control and MDC (phase 3 T4)

`bench/micro/multicastflowcontrol.bench.ts`: `onStatusMessage` from a receiver the strategy already tracks and `onIdle`,
for the `max`, `min` and `tagged` strategies with 1, 8 and 64 receivers (the receiver ids are `(0, n)`, the tagged
receivers carry the strategy's group tag, the positions and times stay below 2^30). `max` tracks no receivers, so its rows
show that the count does not matter. The sender rows are on a manual MDC publication (`control-mode=manual`) over an
in-memory log and a sink socket with 1, 4 and 16 destinations: the destination timeout and re-resolution check
(`ControlTransportPoller.checkForReResolutions`, which `Sender.doWork` runs once per `reResolutionCheckInterval`; all
destinations live) and `Sender.doWork` sending one data frame of 1024 B to every destination (`MultiSndDestination.send`
per frame, the socket hand-off for each). The `dynamic` rows (`control-mode=dynamic`) get their destinations from the status messages of 1, 4 and 16 receivers, so `Sender.doWork` runs `DynamicSndMultiDestination.send` with its destination timeout check. None allocates (`expectNoAllocation` in `MulticastFlowControlAllocationTest`).
Measured on 4 cores with a load average of 1.1 to 1.3 (`npm run bench:micro -- --file multicastflowcontrol`, 2,000
samples, median of the repeats, n=1 run of the harness), so the p99 and p99.9 columns are information, and an `onIdle`
of 5 to 13 ns is at the limit of what a batch of 1,000 calls resolves. The min and tagged figures grow with the receivers
because both loops walk the receiver array once per call (as Java's do); `tagged` adds the three reads of the group tag
(`asfLength`, the two halves) to `min`.

| Bench                                                                                          | ns/op   | p50     | p99     | p99.9   |
| ---------------------------------------------------------------------------------------------- | ------- | ------- | ------- | ------- |
| Flow control max: onStatusMessage from a known receiver, 1 receivers                           | 30.8    | 26.9    | 64.3    | 99.3    |
| Flow control max: onStatusMessage from a known receiver, 8 receivers                           | 28.1    | 26.1    | 54.4    | 92.3    |
| Flow control max: onStatusMessage from a known receiver, 64 receivers                          | 31.1    | 26.1    | 66.7    | 310.7   |
| Flow control min: onStatusMessage from a known receiver, 1 receivers                           | 67.5    | 60.2    | 140.0   | 675.0   |
| Flow control min: onStatusMessage from a known receiver, 8 receivers                           | 84.8    | 82.6    | 152.6   | 250.0   |
| Flow control min: onStatusMessage from a known receiver, 64 receivers                          | 304.9   | 292.5   | 483.4   | 643.0   |
| Flow control tagged: onStatusMessage from a known receiver, 1 receivers                        | 97.4    | 79.1    | 240.2   | 623.2   |
| Flow control tagged: onStatusMessage from a known receiver, 8 receivers                        | 130.3   | 110.1   | 283.1   | 445.6   |
| Flow control tagged: onStatusMessage from a known receiver, 64 receivers                       | 457.6   | 409.9   | 792.4   | 963.3   |
| Flow control max: onIdle, 1 receivers                                                          | 6.2     | 5.0     | 22.7    | 111.9   |
| Flow control max: onIdle, 8 receivers                                                          | 5.5     | 4.9     | 12.0    | 29.4    |
| Flow control max: onIdle, 64 receivers                                                         | 5.6     | 4.8     | 17.1    | 48.2    |
| Flow control min: onIdle, 1 receivers                                                          | 13.4    | 12.5    | 28.6    | 61.0    |
| Flow control min: onIdle, 8 receivers                                                          | 42.1    | 37.8    | 83.8    | 139.6   |
| Flow control min: onIdle, 64 receivers                                                         | 275.8   | 259.9   | 470.8   | 497.3   |
| Flow control tagged: onIdle, 1 receivers                                                       | 12.7    | 12.3    | 24.3    | 34.7    |
| Flow control tagged: onIdle, 8 receivers                                                       | 62.2    | 63.0    | 98.6    | 109.3   |
| Flow control tagged: onIdle, 64 receivers                                                      | 269.8   | 259.0   | 434.5   | 468.1   |
| Sender destination timeouts (checkForReResolutions): manual MDC publication of 1 destinations  | 13.0    | 11.4    | 26.7    | 49.2    |
| Sender destination timeouts (checkForReResolutions): manual MDC publication of 4 destinations  | 30.7    | 29.9    | 60.9    | 75.3    |
| Sender destination timeouts (checkForReResolutions): manual MDC publication of 16 destinations | 43.6    | 42.9    | 62.3    | 83.6    |
| Sender doWork: one data frame of 1024 B to a manual MDC publication of 1 destinations          | 555.8   | 497.8   | 1,061.6 | 1,673.7 |
| Sender doWork: one data frame of 1024 B to a manual MDC publication of 4 destinations          | 988.3   | 844.0   | 1,738.6 | 2,701.9 |
| Sender doWork: one data frame of 1024 B to a manual MDC publication of 16 destinations         | 2,244.5 | 1,993.9 | 3,898.2 | 4,990.9 |
| Sender doWork: one data frame of 1024 B to a dynamic MDC publication of 1 destinations         | 589.4   | 488.2   | 1,138.0 | 2,726.6 |
| Sender doWork: one data frame of 1024 B to a dynamic MDC publication of 4 destinations         | 893.5   | 807.2   | 1,734.5 | 3,691.4 |
| Sender doWork: one data frame of 1024 B to a dynamic MDC publication of 16 destinations        | 1,991.4 | 1,860.7 | 3,612.1 | 4,144.4 |

**The gate against the phase 2 tip (phase 3 T4).** `npm run bench:gate -- --base 2340b67` (the tip of phase 2 merged into the
phase 3 branch) on an idle host (load average 0.8 at the start, 5 pairs): the 24 new benches are `n/a in base` and pass,
and 5 benches of code that phase 3 does not touch failed on pairs that ranged from 0.8 to 1.4 (the receiver data frame
and heartbeat, `ManyToOneRingBuffer tryClaim+commit+read`, the sender heartbeat and `TermReader read: 1 fragment`). The
rerun of those files with 15 pairs, as above, passed all of them but two, by the margin of the noise: `Receiver doWork: an
idle cycle` (median 1.050 against a limit of 1.05, p50 1.007, pairs from 0.62 to 1.34) and `ManyToOneRingBuffer
write+read` (median 1.052, p50 1.033, pairs from 0.82 to 1.25). Neither runs a line that the branch changed (the diff to
`src/` is the flow control, its suppliers, the registry, `Configuration`, `MediaDriver.Context` and two flyweight accessors;
`FlowControl.calculateRetransmissionLength` is the only changed function that a running sender calls, once per NAK).
This is the noise of the shared VM described below, not a verdict.

**The gate after review A (d08decb against `origin/main`).** 5 pairs failed four benches: `Image poll` and
`Image controlledPoll` of 64 B, `NetworkPublication resend: 2 frames of 1024 B` and `UdpChannelTransport
onMessage+receive 128B, two senders alternating` (medians 1.059 to 1.209, pairs from 0.75 to 1.46). Rerun with 15 pairs,
three passed (0.982, 1.017, 0.999) and the resend bench failed (1.080). Because it runs
`FlowControl.calculateRetransmissionLength`, which the branch changed, it was bisected at 15 pairs each:

- the same commit against itself: 0.978;
- T2 (`13c379c`, the only commit that changes `FlowControl.ts`) against T1: 0.991;
- T3 (`d13b093`, the registry that builds `UnicastFlowControl`) against T2: 0.977;
- d08decb against the merge `7aaca68`: 0.934.

T1, T4 and the merge do not change the resend path. A second 15-pair run of d08decb against `origin/main` gave 0.972.
No step regresses, so the single 1.080 was noise.

### Receiver (T16)

`bench/micro/receiver.bench.ts`: `Receiver.doWork` on a real `PublicationImage` over an in-memory log (`SharedArrayBuffer`),
a `ReceiveChannelEndpoint` whose socket does nothing, the dispatcher and the position counters of the driver. The data bench
puts one datagram of 64 B in the transport ring and runs one cycle (poll, validate, route, `insertPacket`, `TermRebuilder.insert`,
the status message that follows the subscriber); every 64th operation also runs `trackRebuild` and moves the subscriber (the
conductor's part). The heartbeat bench is a frame of length 0, the idle bench is a cycle with nothing to do. None allocates
(`expectNoAllocation` in `PublicationImageAllocationTest`, `PublicationImageLossAllocationTest` and
`PublicationImageTimestampAllocationTest`). Measured on 4 cores with a load average of 0.4 to 0.6 (idle host), n=1 run of the
harness (2,000 samples, median of the repeats).

| Bench                                                                                                  | ns/op   | p50     | p99     | p99.9   |
| ------------------------------------------------------------------------------------------------------ | ------- | ------- | ------- | ------- |
| Receiver doWork: one data frame of 64 B (ring, validate, route, insertPacket, rebuild, status message) | 1,069.5 | 1,008.2 | 2,116.9 | 2,855.1 |
| Receiver doWork: one heartbeat (frame length 0)                                                        | 421.4   | 408.6   | 809.4   | 1,335.6 |
| Receiver doWork: an idle cycle (no command, no datagram, the image has nothing to send)                | 96.8    | 94.1    | 188.6   | 231.3   |

### Publications and images (T20)

`bench/micro/publication.bench.ts`: `offer` and `tryClaim` + `commit` of a `ConcurrentPublication` (one atomic add of the raw
tail, spec D84) and of an `ExclusivePublication` (a plain store of it, spec D82), and `Image.poll` and `controlledPoll` of one
fragment, over a log in memory (`SharedArrayBuffer`) with 64 B messages (frames of 96 B). The limit never back pressures, and one
`offer` in 680 is the rotation of a full term (`ADMIN_ACTION`), which is part of the figure. The poll benches read a term of 600
frames written by the setup and move the subscriber back to its start after the 600th (one operation in 600). None allocates
(`expectNoAllocation` in `PublicationAllocationTest` and `ImageAllocationTest`, also from a position of 2^40). Measured on 4
cores with a load average of about 5 (other tasks were running), n=1 run of the harness (2,000 samples, median of the repeats),
so the figures are upper bounds; the baseline for the gate is to be taken on the idle machine.

| Bench                                                                               | ns/op | p50   | p99   | p99.9   |
| ----------------------------------------------------------------------------------- | ----- | ----- | ----- | ------- |
| ConcurrentPublication offer 64 B (claim the tail, header, copy, publish the length) | 325.0 | 296.0 | 633.6 | 3,109.8 |
| ExclusivePublication offer 64 B (store the tail, header, copy, publish the length)  | 275.9 | 229.6 | 530.7 | 1,596.0 |
| ConcurrentPublication tryClaim + commit 64 B                                        | 254.2 | 231.4 | 514.5 | 1,248.9 |
| ExclusivePublication tryClaim + commit 64 B                                         | 204.1 | 158.9 | 397.4 | 1,189.1 |
| Image poll: one fragment of 64 B                                                    | 47.7  | 42.7  | 108.0 | 293.7   |
| Image controlledPoll: one fragment of 64 B                                          | 54.8  | 48.0  | 95.2  | 132.0   |

**What the shared 4-core VM of these baselines does to the gate (T24).** Two full runs of `npm run bench:gate` with the same
commit as base and candidate, 5 pairs, while other jobs ran on the host (load average 1.5 to 3.2 during the run, 0.7 at
the start of the first): the first failed 14 of 46 benches and the second 15, almost all of them benches that nothing
changed (per-pair ratios from 0.45 to 1.85), and both passed the `TermReader` benches and three of the four end-to-end
ones. The round trip of 1376 B failed in both (its p50 is 42 to 68 us from one process to the next; 15 pairs gave a
median of 1.07 over pair ratios of 0.62 to 1.66). That is noise, not a regression, and it is why the gate wants an idle
machine and 15 pairs before a verdict is believed; a clean 5 pair run needs a host with nothing else running.

### End-to-end benches (T24)

`bench/lib/e2e.ts` runs two `MediaDriver`s and two `Aeron` clients in one process on the real loopback (127.0.0.1),
default configuration (spec D100, D111): the drivers run themselves on the event loop and the bench polls the clients, one
turn of `setImmediate` between polls. After an `offer` the bench calls `MediaDriver.wake()` of the driver that has work
(D101); the report also shows the figures without it. Both nodes are one thread, so these figures are the port plus the
event loop plus the kernel, and the **raw `dgram` floor** (two plain sockets in the same process, same sizes, the echo in
the `'message'` handler; spec 5.3) is reported next to them and is not in the gate.

- **In the gate** (`bench/micro/e2e.bench.ts`, `npm run bench:micro -- --file e2e`): `Unicast round trip` of 32 B and
  1376 B (the largest message of one datagram; a sample is one round trip: `offer`, the echo of the other node, the read)
  and `Unicast stream` of 64 B and 1376 B (one way, continuously; a sample is the ns per message of a window of 100
  messages read). The round trips are judged as latency benches (5 pairs), the streams as throughput benches (3 pairs).
  They have the same noise rules as the micro benches and need an idle host more than they do; the p99 and p99.9 of the
  default 2000 samples are information.
- **The report** (`npm run bench:e2e [-- --runs n --stream-runs n --rtt n --windows n --idle n --json]`): round trips of
  32, 512 and 1376 B with the wake, without it and the `dgram` floor, **interleaved** (each run does every size, the order
  alternates between runs), 5 runs of 3000 round trips (the table is the median over the runs of each run's p50, p99 and
  p99.9); one-way streams of 64 B and 1376 B, 3 runs (msgs/s and MB/s of payload); allocation per message; the first
  message after the runners went idle. The CI job `bench-e2e` runs it once per PR and writes it to
  `$GITHUB_STEP_SUMMARY`; it never fails the build.
- **Allocation** is the sampling heap profiler (a sample every 256 bytes, objects already collected counted) split by the
  file of the allocating function, with the minor collections per 1000 messages from a `gc` observer (what
  `test/support/Allocation.ts` counts). The profiler estimates. `port` is `src/`, `node` is Node's own (the `Buffer` and
  `rinfo` of each `'message'`, the `SendWrap` of each `send`, timers: spec 5.3), `harness` is the promise and
  `setImmediate` of each turn of the bench.
- **First message after idle** (D101: `offer` does not wake a parked runner): 150 ms of nothing, then `offer`, and the time
  to the read by the subscriber, with and without `MediaDriver.wake()`, and the same for a plain `dgram` send to its
  `'message'`.

### Fan-out benches (phase 3 T14, D121)

`bench/lib/fanout.ts`: the same harness style for the phase 3 topologies, **one way** (offer to the read, not an echo).
Each receiver is a `MediaDriver` and an `Aeron` client of its own in the process (a receiver id of its own for the flow
control); the publisher is one more. The scenarios: a unicast reference; **multicast** (group 224.20.30.39,
`interface=localhost`) with 1 and 3 subscriptions; **MDC dynamic** (`control-mode=dynamic`, receivers join with
`control=`) and **MDC manual** (`control-mode=manual`, `addDestination`) with 2 and 4 destinations; **MDS** with 2
destinations (one `control-mode=manual` subscription, two publications on one driver, one for each destination, the offers
alternating between them). The multicast and MDC publications have `fc=min,g:/N` (as the interop rows of D116), so the
stream starts when all N receivers are counted and the slowest paces it.

- **Latency**: one 32 B message at a time, the ns from `offer` until the LAST subscriber has read it.
- **Throughput**: a 64 B stream; the ns per message of a window of 100 read by the SLOWEST subscriber. msgs/s counts
  messages offered (each reaches every receiver); MB/s is payload of one receiver.
- **In the report** (`npm run bench:e2e`): 5 latency runs (3000 messages each) and 3 stream runs (50,000 messages),
  every scenario taken in turn within each run (the order alternates), a fresh set of drivers for each scenario and run,
  so they are interleaved with each other and run in the same process after the unicast sections above; allocation
  per message as D112 measures it (sampling heap profiler, split by file) for the 64 B stream, with the top
  allocation sites of `src/`.
- **In the gate** (`bench/micro/fanout.bench.ts`, `npm run bench:micro -- --file fanout`): the 7 non-unicast
  scenarios as latency benches (5 pairs) and as throughput benches (3 pairs). The unicast reference is the
  `Unicast` benches of `e2e.bench.ts`. The file imports a phase 3 module, so a base without phase 3 reports it
  `n/a in base`. The non-gating CI job `bench-e2e` posts the report and `--file fanout` to the run summary.
- **Allocation reading.** The `port` column is the whole process: N+1 drivers. The remaining `src/` sites are the
  D13 heap numbers (`nowNs` of `Sender`, `Receiver`, `DriverConductor`, `AgentRunner.dutyCycle`, about 4 B per message and
  driver each, so they grow with the number of drivers), `ClientConductor.service`, and in the multicast and MDC runs
  `DataTransportPoller.receive` and `PublicationImage.insertPacket` (1 to 2 B per message and receiver, the same class).
  The send loops that phase 3 added (`MultiSndDestination.send`, `DynamicSndMultiDestination.send`), the multicast status
  message and NAK path and the MDS receive path (`MultiRcvDestination`, 0.1 B) show no site of their own; their
  `expectNoAllocation` tests are `MulticastFlowControlAllocationTest` and the allocation tests of the publication image.
  No fix was needed in T14.

### Baselines of the end-to-end benches

`npm run bench:e2e`, one invocation, 2026-10-26, Node v22.22.0, Intel(R) Xeon(R) Processor @ 2.10GHz, 4 cores, a shared
host (load average 3.5 at the start and 2.2 at the end, another job was finishing: indicative only; the baseline of the
gate is to be taken on the idle machine). 5 runs of 3000 round trips per row, 3 runs of 50,000 messages per stream row, 30
first messages.

Round trip, microseconds (one way is about half):

| bytes | path                            | p50  | p99   | p99.9 |
| ----- | ------------------------------- | ---- | ----- | ----- |
| 32    | Aeron TS, wake after each offer | 42.5 | 134.9 | 480.5 |
| 32    | Aeron TS, no wake               | 42.6 | 121.5 | 498.7 |
| 32    | raw dgram floor                 | 15.9 | 72.7  | 137.7 |
| 512   | Aeron TS, wake after each offer | 43.6 | 135.1 | 355.8 |
| 512   | Aeron TS, no wake               | 44.5 | 165.3 | 361.6 |
| 512   | raw dgram floor                 | 16.3 | 77.3  | 176.1 |
| 1376  | Aeron TS, wake after each offer | 54.8 | 222.1 | 440.4 |
| 1376  | Aeron TS, no wake               | 49.6 | 195.3 | 615.3 |
| 1376  | raw dgram floor                 | 22.9 | 94.0  | 167.0 |

The wake makes no difference to a round trip here; most likely because the bench polls in a tight loop of `setImmediate`, so the datagram of
the first leg and the offer of the echo find the runner of the other node running. The port costs about 27 us more than the
floor per round trip at 32 B.

Throughput, one way:

| bytes | path                                     | msgs/s  | MB/s  |
| ----- | ---------------------------------------- | ------- | ----- |
| 64    | Aeron TS                                 | 408,789 | 26.2  |
| 64    | raw dgram floor (credit of 64 datagrams) | 118,029 | 7.6   |
| 1376  | Aeron TS                                 | 43,771  | 60.2  |
| 1376  | raw dgram floor (credit of 64 datagrams) | 99,321  | 136.7 |

Aeron puts the small messages of one cycle in one datagram, so at 64 B it moves more messages than the floor moves
datagrams. At 1376 B every message is a datagram and the port reaches 44% of the floor in messages per second, 21 us per
message: the sender sends one frame per cycle and a cycle is a turn of the event loop (D11), the first place to look.

Allocation per message (estimates, bytes per message):

| run                                       | port   | node   | harness | other | minor GCs per 1000 msgs |
| ----------------------------------------- | ------ | ------ | ------- | ----- | ----------------------- |
| stream 64 B                               | 31.8   | 85.9   | 9.4     | 46.5  | 0.00                    |
| stream 1376 B                             | 814.0  | 949.1  | 601.6   | 580.1 | 0.20                    |
| round trip 32 B, per message (2 per trip) | 1274.4 | 1091.3 | 1211.4  | 622.1 | 0.17                    |

The `port` column is not zero, although spec 5.3 says the port's own code allocates nothing per datagram. Issue #52
measured it at 134 to 141 B/msg in the 64 B stream; it took out the `UnsafeBuffer` fields that were kept as doubles
(41 B/msg: `validatePacket`, `getInt`, `putInt`), the slice and the host of each `dgram` send (D113) and the `Immediate` of
each duty cycle (D114), and the column went to 31.8 (the 64 B stream row above was measured once with `--runs 1`, the
others are from before the change). What is left in `src/` is the heap numbers of D13: the `nowNs` that `Sender.doWork`,
`Receiver.doWork` and `DriverConductor.doWork` pass on (7 to 8 B/msg each) and `ClientConductor.service` (4). The
rest of a send is node's own (about 47 B per datagram, D113). Issue #52 then found that the times and positions
stored in the fields that were declared with no number (`PublicationImage.timeOfLastPacketNs`, `NetworkPublication.timeOfLastDataOrHeartbeatNs`,
`ClientConductor.timeOfLastServiceNs`, ... 291 fields, D122) allocated a heap number per store, and the column of a later run
went from 48.4 to 36.8 B/msg at 64 B and from 282.7 to 245.2 at 1376 B; what is left is the `nowNs` of each duty cycle (D112)
and node's own work attributed to the runner's functions. `EndToEndAllocationTest` runs the whole path over a loopback fake
of `dgram` and bounds the bytes per step. The figures are per message of a run, so they grow with the
datagrams per message (1376 B) and with the cycles per message (the round trip spins the loop many times for each
message). Recorded, not a gate. The minor
collections are rare (0.02 per 1000 messages at 64 B).

First message after the runners went idle, microseconds, 100 messages (one run of the report with `--idle 100`):

| path                                        | p50   | p99     | max     |
| ------------------------------------------- | ----- | ------- | ------- |
| Aeron TS, `offer` only (default)            | 260.5 | 1,159.3 | 1,195.3 |
| Aeron TS, `offer` then `MediaDriver.wake()` | 264.2 | 527.3   | 580.5   |
| raw dgram floor, send to read               | 184.7 | 339.2   | 342.0   |

The median is a quarter of a millisecond with or without the wake (the floor is 0.18 ms: an idle event loop, a cold
cache). Without the wake the tail goes up to the park of the idle strategy, 1 ms (D101), plus the same quarter
millisecond: 1.2 ms at the worst of 100. That is within the expectation of D101 (within 1 ms of the park, plus the path);
the wake takes the tail to 0.58 ms. An application that cannot wait 1 ms calls `MediaDriver.wake()`.

Fan-out (phase 3 T14, D121), `npm run bench:e2e`, one invocation, 2026-10-26, same Node and host (4 cores, load average 1.05
at the end; not perfectly idle: indicative only). One way, offer to the read by the last subscriber, 32 B, 5 runs of 3000
messages (median over the runs of each run's percentiles); throughput of a 64 B stream, 3 runs of 50,000 messages, per
message offered; bytes per message offered of the whole process (N+1 drivers), 64 B stream. The scenarios were taken in
turn within each run.

| scenario                            | p50 us | p99 us | p99.9 us | msgs/s  | MB/s | port B/msg | node B/msg | harness B/msg | other B/msg |
| ----------------------------------- | ------ | ------ | -------- | ------- | ---- | ---------- | ---------- | ------------- | ----------- |
| unicast, 1 subscription (reference) | 27.4   | 88.4   | 288.6    | 457,545 | 29.3 | 37.5       | 67.6       | 15.1          | 37.4        |
| multicast, 1 subscription           | 21.3   | 92.7   | 209.8    | 533,308 | 34.1 | 38.7       | 70.2       | 15.0          | 36.9        |
| multicast, 3 subscriptions          | 36.3   | 113.7  | 399.8    | 267,923 | 17.1 | 77.8       | 72.6       | 14.5          | 92.0        |
| MDC dynamic, 2 destinations         | 32.6   | 110.0  | 404.9    | 250,127 | 16.0 | 61.2       | 115.9      | 15.2          | 63.5        |
| MDC dynamic, 4 destinations         | 55.0   | 158.3  | 837.1    | 169,105 | 10.8 | 99.3       | 223.4      | 14.9          | 118.1       |
| MDC manual, 2 destinations          | 34.1   | 100.5  | 281.4    | 268,021 | 17.2 | 58.7       | 116.1      | 14.9          | 62.9        |
| MDC manual, 4 destinations          | 57.4   | 133.7  | 407.0    | 172,947 | 11.1 | 98.0       | 223.4      | 15.2          | 116.5       |
| MDS, 2 destinations                 | 22.2   | 84.7   | 169.4    | 439,803 | 28.1 | 34.1       | 86.7       | 15.1          | 45.6        |

Reading: each extra receiver costs about 7 us at the median for multicast (1 to 3 subscriptions: 21 to 36 us) and about
11 us for MDC (2 to 4 destinations: 33 to 56 us). It is one process with N+1 drivers on one thread, so every receiver adds
a driver's work to the same event loop, and MDC sends a datagram to each destination where multicast sends one to the
group. Dynamic and manual MDC are the same within the noise. MDS is at the unicast figure. The `port` column rises with the number of
drivers (the D13 heap numbers, about 4 B per message and driver per duty-cycle function), not with the destinations: no
`src/` site of the MDC send loop, the multicast status message and NAK path or the MDS receive path allocates per message
on its own (the top sites are listed by `npm run bench:e2e`).

The fan-out benches as the gate runs them (`npm run bench:micro -- --file fanout`, load average 1.1, 4 cores, ns per
operation; a latency operation is one message offered and read by every subscriber, a stream operation is one message at the
slowest subscriber). These are the baselines of the gate; the base of the first gate run (`origin/main`) has no phase 3, so
they are `n/a in base` there.

| Bench                                             | ns/op  | p50    | p99     | p99.9   | ops/s   |
| ------------------------------------------------- | ------ | ------ | ------- | ------- | ------- |
| Fan-out latency 32 B, multicast, 1 subscription   | 34,016 | 24,479 | 120,876 | 391,884 |         |
| Fan-out latency 32 B, multicast, 3 subscriptions  | 43,003 | 37,040 | 118,004 | 489,551 |         |
| Fan-out latency 32 B, MDC dynamic, 2 destinations | 36,673 | 31,486 | 104,552 | 468,622 |         |
| Fan-out latency 32 B, MDC dynamic, 4 destinations | 76,196 | 58,947 | 177,778 | 487,578 |         |
| Fan-out latency 32 B, MDC manual, 2 destinations  | 38,569 | 34,328 | 105,266 | 243,011 |         |
| Fan-out latency 32 B, MDC manual, 4 destinations  | 68,373 | 58,050 | 175,615 | 445,102 |         |
| Fan-out latency 32 B, MDS, 2 destinations         | 32,890 | 26,357 | 97,963  | 179,538 |         |
| Fan-out stream 64 B, multicast, 1 subscription    | 2,380  | 2,056  | 5,354   | 10,240  | 420,120 |
| Fan-out stream 64 B, multicast, 3 subscriptions   | 4,770  | 4,358  | 10,066  | 91,810  | 209,629 |
| Fan-out stream 64 B, MDC dynamic, 2 destinations  | 4,911  | 4,447  | 11,257  | 69,058  | 203,647 |
| Fan-out stream 64 B, MDC dynamic, 4 destinations  | 6,067  | 5,100  | 13,923  | 84,780  | 164,824 |
| Fan-out stream 64 B, MDC manual, 2 destinations   | 3,296  | 2,852  | 7,814   | 62,594  | 303,449 |
| Fan-out stream 64 B, MDC manual, 4 destinations   | 7,332  | 6,531  | 14,194  | 80,673  | 136,390 |
| Fan-out stream 64 B, MDS, 2 destinations          | 2,128  | 1,897  | 5,325   | 10,386  | 470,019 |

The mean (ns/op) of a latency bench sits above its p50 because of the tail (a collection or a timer in the one process).

**Gate against `origin/main` (a79825d, T14, phase 3 candidate).** A full `npm run bench:gate` (5 pairs) failed on 16
benches, all in code that phase 3 did not touch (`git diff origin/main..HEAD` is empty for the ring buffers, the
publications, `Image`, the term reader, `Receiver`, `SendChannelEndpoint`, `ReceiveChannelEndpoint` and
`ControlTransportPoller`), with pair ratios from 0.67 to 2.2 for the same code. Re-run per file with 11 pairs: the
congestion, e2e (all four Unicast benches: 0.93 to 1.00), loss and transport files passed; `endpoint`, `publication`,
`receiver` and `ringbuffer` still had benches over the limit with ratios that swing from 0.76 to 2.2 between pairs on
byte-identical code (the shared 4-core VM is not idle), so they are noise and not a regression. The 14 new fan-out
benches are `n/a in base`. The authoritative gate against `main` is on an idle host at T15.

The gate's own figures for the same benches (`npm run bench:micro -- --file e2e` and `--file termreader`, load average
0.8 to 0.9, 4 cores, ns per operation; a round trip is one operation, a stream operation is one message):

| Bench                                                                   | ns/op    | p50      | p99     | p99.9    | ops/s   |
| ----------------------------------------------------------------------- | -------- | -------- | ------- | -------- | ------- |
| Unicast round trip 32 B (TS to TS on the loopback: offer, echo, read)   | 58,208   | 54,850   | 151,297 | 875,804  |         |
| Unicast round trip 1376 B (TS to TS on the loopback: offer, echo, read) | 56,738.6 | 46,781   | 151,819 | 294,534  |         |
| Unicast stream 64 B (TS to TS on the loopback, ns per message)          | 2,386.6  | 2,195.4  | 4,922.3 | 13,161.4 | 419,005 |
| Unicast stream 1376 B (TS to TS on the loopback, ns per message)        | 21,309.8 | 18,400.6 | 49,499  | 65,164.2 | 46,927  |
| TermReader read: 1 fragment of 64 B                                     | 42.9     | 34.9     | 94.2    | 133.5    |         |
| TermReader read: 16 fragments of 64 B                                   | 320.6    | 310      | 551.3   | 865      |         |
