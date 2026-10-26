# Phases 4 and 5 plan — worker driver, native transport, low-latency profile

**Spec:** [2026-10-21-aeron-transport-ts-design.md](../specs/2026-10-21-aeron-transport-ts-design.md) (§9, phase 4;
phase 5 is new with this plan). Deviations D120 to D124 are reserved for this plan and arrive with their tasks.
**Pinned sources:** Aeron Java `1.53.3`, Agrona `2.6.1`, Aeron C `1.53.3` (interop peer, and the reference for the
native socket code: `aeron_udp_channel_transport.c`, `aeron_udp_transport_poller.c`).
**Builds on:** phase 3 (`feature/phase-3-multicast-mdc`). Phase 4 starts once phase 3 is merged.
**Goal (owner, 2026-10-26):** a round trip at **p50 ≤ 10 µs**, a p99 no worse than WebSocket's, and throughput
above WebSocket's at 64 B and 1376 B, measured on one loopback host by `bench:e2e`.

## Where the time goes today (measured 2026-10-26, 4-core host, loopback)

| Path | Round trip p50 | p99 | Throughput 64 B | Throughput 1376 B |
|---|---|---|---|---|
| C, two threads, busy-poll UDP | 4.0 µs | 9.2 µs | — | — |
| Node, N-API `recv(MSG_DONTWAIT)`, busy-poll worker (prototype) | 4.2 µs (32 B), 5.0 µs (1376 B) | ≈ 16 µs | 447 k/s | 400 k/s (551 MB/s) |
| Node `dgram` (libuv), no Aeron | ≈ 16 µs | 86 µs | — | — |
| WebSocket (`ws` 8.18.0, TCP, no deflate) | 19.7 µs | 58 µs | 411 k/s | 118 k/s (162 MB/s) |
| This port today (`INVOKER`, `dgram`, `setImmediate` cycles) | ≈ 49 µs | 179 µs | ≈ 382 k/s | 53–67 k/s |

Conclusions that shape the plan:

1. The ported Aeron logic is not the cost. `dgram` adds about 11 µs per hop (a libuv poll, a JS callback, a `Buffer`
   per datagram) and the `setImmediate` duty cycle (D11, D100) adds a loop turn per hop on each side.
2. p50 ≤ 10 µs needs both: a socket read that does not go through libuv, and a duty cycle that polls without
   returning to the event loop. A busy loop cannot run on the application's thread, so it runs in a worker: that is
   the phase 4 worker driver.
3. Throughput at 1376 B is bound by one `send` syscall and one callback per datagram. `sendmmsg` / `recvmmsg` with a
   batch per duty cycle (Aeron C's transport poller does the same) lifts it above WebSocket's.

## Decisions taken with this plan (2026-10-26)

1. **Phase 4 is spec §9.4 as written** (Aeron's `SHARED` mode: the driver's `CompositeAgent` in one `worker_thread`
   over the `SharedArrayBuffer` CnC and log buffers, D16), with the worker's idle strategy taken from the context.
   The default stays `BackoffIdleStrategy` parking on the worker's event loop, as the spec says.
2. **Low latency is an opt-in profile, not the default (D120).** `MediaDriver.Context.threadingMode(SHARED)` with
   `sharedIdleStrategy(BusySpinIdleStrategy)` (or `NoOp`) and the native transport runs the worker's duty cycle in a
   plain loop that never yields to the worker's event loop, as Java's `AgentRunner` does. It burns one core. The
   worker leaves the loop on close (a flag in the shared CnC), and every `n` cycles (default 1024) it gives its event
   loop one turn so timers and `dns.lookup` still complete. The default profile keeps today's behaviour.
3. **A native UDP transport, with `dgram` as the fallback (D121).** A small N-API addon (`native/udp/`, C, no C++,
   no third-party code) gives non-blocking sockets: `open`, `bind`, `connect`, multicast membership and options,
   `sendmmsg` / `recvmmsg` on Linux, `sendmsg` / `recvmsg` loops on macOS, `MSG_DONTWAIT` everywhere. It reads into
   the transport's existing `ReceiveRing` slots and sends from the existing send slots, so nothing is allocated per
   datagram. It is loaded when present (prebuilt for linux-x64, linux-arm64, darwin-x64, darwin-arm64, built in CI)
   and `UdpChannelTransport` falls back to `dgram` otherwise, or when `aeron.transport.native=false`. The spec's
   "no native add-ons" line (§1) becomes "no native add-on required". The `dgram` path stays the tested default
   for the suites; every suite also runs on the native path.
4. **The native socket owns its readiness the Aeron C way.** In the busy profile the duty cycle polls the socket
   (`recvmmsg` returning `EAGAIN` is a zero-work cycle). In the default profile the addon registers the fd with a
   `uv_poll_t` and wakes the runner (D101), so the event-loop-friendly mode keeps working with the native path.
5. **Gates, owned by `bench:e2e` (D122).** In the low-latency profile, on an idle host: round trip p50 ≤ 10 µs at
   32 B and 1376 B; p99 ≤ the WebSocket row's p99 of the same run; throughput > the WebSocket row's at 64 B and
   1376 B. The default profile has its own recorded baselines and must not regress (`bench:gate`). A missed gate is
   a failing gate, not a note.
6. **A permanent WebSocket row in `bench:e2e` (D123).** `ws` (pinned devDependency, `perMessageDeflate: false`) in
   the same process, the same sizes, runs and counts as the Aeron rows, interleaved with them, so every report
   carries its own comparison. It is a reference only; nothing in `src/` depends on it.
7. **Client-side polling for the profile (D124).** The application's `Subscription.poll` and `Publication.offer`
   stay on the application thread over the shared log buffers. The bench's echo side runs its poll loop in its own
   spinning worker, as the prototype did; the docs show the same pattern for applications that want the profile.

## How every task is done (applies to all tasks)

- Phase 2 and 3 rules stand: test first and red; one file per Java file for ported code; green with typecheck,
  lint, format, the mapping check and `npx vitest run`, plus `npm run test:interop` when `src/` changes; one commit
  per task (`phase4(T<n>): …`, `phase5(T<n>): …`); pushed as it lands.
- `expectNoAllocation` for every per-message path, including the native read and send calls seen from JS.
- Every loop in a test has a turn cap; nothing waits on wall time except the latency benches.
- Implementers: one Sonnet implementer per task. Reviews: ONE Opus reviewer per stage, combined over the stage's
  tasks; one fix round each.
- Benchmarks: interleaved A/B (ABAB), ≥ 5 runs for latency, ≥ 3 for throughput, n ≥ 15 before claiming a small p99
  shift; the profile gates need an idle host.

## Tasks

### Phase 4 — Stage A: worker driver (spec §9.4)

#### T1 — Shared buffers across threads
- The CnC file, the log buffers and the counters move onto `SharedArrayBuffer` where they are not already (D16);
  positions, the concurrent publication's raw tail and the ring buffers use `Atomics` / LongStripes as D16 lays out.
- Tests: the existing Agrona ring-buffer and broadcast tests run a second time with producer and consumer in two
  workers (seeded, 10 000 messages, produced = consumed, order kept per producer).

#### T2 — `SHARED` threading mode in a worker
- `MediaDriver.launch` with `SHARED` starts a `worker_thread` that builds the driver over the shared buffers and runs
  the `CompositeAgent` under its `AgentRunner`; the worker owns the sockets. The D42 loop back of `CommandProxy`
  returns to Java's form in this mode.
- Idle: `BackoffIdleStrategy` parks by returning to the worker's event loop, woken by a socket, by
  `Atomics.waitAsync` on the command ring, or by a timer — never by a blocking `Atomics.wait`.
- Tests: the phase 2 and phase 3 system suites run in `INVOKER` and `SHARED` (a `describe.each` over the mode);
  driver close with clients live; a crash of the worker is reported to the client as a driver timeout.

#### T3 — Benches for the worker driver
- `bench:e2e` rows for `SHARED` next to `INVOKER`, A/B; baselines in `bench/README.md`; `bench:gate` against
  `main`.

**Stage A review:** one Opus review of T1–T3.

### Phase 5 — Stage B: native transport

#### T4 — The addon and its build
- `native/udp/udp.c` (N-API v8), `binding.gyp`, `scripts/build-native.mjs`; prebuilds in CI for the four targets;
  the loader picks the prebuild, then a local build, then reports `dgram`.
- Calls: `open(family)`, `bind`, `connect`, `setOption` (reuse, buffer sizes, multicast interface / TTL / loop,
  membership add and drop), `sendBatch(fd, slots, lengths, addrs, count)`, `recvBatch(fd, ring, max) → count`,
  `close`. Errors come back as negative errno values, never as thrown objects on the hot path.
- Tests: unit tests of each call on loopback, unicast and multicast; `EAGAIN` returns 0; a closed fd reports
  `EBADF`; `expectNoAllocation` on `sendBatch` and `recvBatch`.

#### T5 — `UdpChannelTransport` over the native socket
- A second branch in `UdpChannelTransport` (concrete, no virtual dispatch on the hot path): `send` and `receive`
  call the addon when it is loaded; multicast setup follows the same Java order. The default profile registers a
  `uv_poll_t` and calls the D101 wake up; the busy profile polls.
- Tests: the transport and endpoint unit tests run on both paths (`describe.each`); the netsim (D104) stays on the
  `dgram` fake; the system suites run on both paths; interop rows run with the TS side on the native path.

#### T6 — Batched send and receive per duty cycle
- The receiver reads up to `n` datagrams per poll (Aeron C's `AERON_NETWORK_PUBLICATION_MAX_MESSAGES_PER_SEND` and
  the poller's batch); the sender sends the frames of one cycle in one `sendBatch`.
- Tests: the order of frames on the wire is unchanged (a capture through `LossyRelay`), retransmits and status
  messages interleave as before; loss suites green on the native path.

**Stage B review:** one Opus review of T4–T6.

### Phase 5 — Stage C: low-latency profile and gates

#### T7 — The busy profile (D120)
- In a worker with `BusySpinIdleStrategy` or `NoOpIdleStrategy` and the native transport, the `AgentRunner` runs its
  duty cycle in a loop, with one event-loop turn every `n` cycles and an exit on the shared close flag.
- Tests: close is seen within one cycle batch; timers (`dns.lookup`, the driver's timeouts) still fire; the profile
  with the `dgram` fallback is refused at launch with a clear error (it would starve the socket).

#### T8 — `bench:e2e`: WebSocket row and profile rows (D122, D123)
- Rows: WebSocket; this port in the default profile (`INVOKER` and `SHARED`, `dgram` and native); this port in the
  busy profile. Round trips at 32, 512 and 1376 B (≥ 5 runs × 3000 trips after 200 warm-up trips, interleaved);
  streams at 64 and 1376 B (≥ 3 runs × 50 000 messages, the publication's back pressure as the limiter).
- The gates of decision 5, with a `--gate-profile` switch that fails the run when a gate is missed.

#### T9 — Tuning to the gates
- Profile the busy-profile round trip (`--cpu-prof`, `perf` with `--perf-basic-prof`) hop by hop and remove what
  stands between the prototype's 4–5 µs and the port: the expected candidates are the per-cycle work of idle agents,
  the conductor's period, the term scan for small messages and the send slot copy. Each change is A/B benched and
  keeps the port's code Java's where it is ported (a deviation otherwise, in §6).

#### T10 — Checkpoint
- Full suite in every mode (`INVOKER` / `SHARED` × `dgram` / native), interop, `bench:gate` against `main`, the
  profile gates on an idle host; one whole-branch Opus review; one fix round; checkpoint doc
  `docs/plans/<date>-phase-5-checkpoint.md`; README section "Low latency" with the measured table.

## Interaction matrix

| Area | Operations | Entities / values | Orderings / timings |
|---|---|---|---|
| Worker driver (T1–T3) | add / remove publication, subscription, destination; offer; poll; close | 1 and 3 clients; `INVOKER` / `SHARED`; unicast, multicast, MDC, MDS | client connects before and after the worker starts; command sent while the worker is parked; driver closed with clients live; worker crash mid-stream |
| Native transport (T4–T6) | open, bind, connect, membership, send batch, receive batch, close | IPv4 / IPv6; 0, 1, `n`, `n + 1` datagrams waiting; 1 B, MTU, max datagram; Linux and macOS | socket closed during a batch; `EAGAIN` mid-batch; short send (send queue full); addon missing → `dgram` |
| Busy profile (T7) | duty cycle, close, timers, DNS | `BusySpin`, `NoOp`; 1 and 2 drivers on one host | close during a spin batch; timer due during the spin; host with fewer cores than spinning threads |
| Benches (T8, T9) | round trip, stream | 32, 512, 1376 B; 64 and 1376 B streams | interleaved with the WebSocket row; idle host only for the gates |
| Interop | as §8.3 | TS on the native path against the C driver | C loss interceptor and `LossyRelay` as before |

## Review focus

- **Fidelity:** the ported classes are unchanged by the worker and the native path; the native socket options and
  their order match `aeron_udp_channel_transport.c`; every deviation is in §6 and `docs/mapping.md`.
- **Memory ordering:** every word shared between the worker and the application is written with a release and read
  with an acquire (`Atomics`), with no torn 64-bit reads (D16).
- **Allocation:** nothing per datagram on the native path in JS or in C (no `napi_create_*` per call; buffers are
  the transport's own, passed once).
- **Fallback:** with the addon missing every suite is green on `dgram`; the busy profile refuses `dgram`.
- **Gates:** the report shows p50 ≤ 10 µs, p99 ≤ WebSocket and throughput > WebSocket in the busy profile, and no
  regression of the default profile, with the run counts and interleaving of BENCHMARKING rules.
