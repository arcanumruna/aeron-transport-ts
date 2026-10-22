# Phase 2 plan — unicast transport

**Spec:** [2026-10-21-aeron-transport-ts-design.md](../specs/2026-10-21-aeron-transport-ts-design.md) (§9, phase 2;
deviations D15 and D16 are new with this plan).
**Pinned sources:** Aeron Java `1.53.3`, Agrona `2.6.1`, Aeron C `1.53.3` (interop peer).
**Builds on:** phase 1 (`feature/phase-1-foundation`). This branch starts from its tip and merges `main` in once
phase 1 is merged.
**Exit:** every test mapped in this plan is green or a reviewed `it.skip`; the mapping check passes; TS ↔ TS and
TS ↔ C unicast interop are green with no loss and no duplicates, including under loss; the ring buffers pass their
cross-worker stress tests; the message path allocates nothing in the port's own code (bench); `bench:gate` passes against `main`.

## Decisions taken with this plan (owner, 2026-10-22)

1. **The client ↔ driver command protocol is ported, in memory (D15).** This reverses the spec's earlier cut (§3,
   §4.3). The client writes commands to the driver through a `ManyToOneRingBuffer` (`DriverProxy` →
   `ClientCommandAdapter`), and the driver answers through a broadcast buffer (`ClientProxy` →
   `BroadcastTransmitter` → `CopyBroadcastReceiver` → `ClientConductor`). There are no files: the CnC layout
   (`CncFileDescriptor`) is the same, but it sits in one `SharedArrayBuffer`, and log buffers live in memory (D4).
   While it waits for a reply, the client runs the driver's `AgentInvoker` itself, as in Aeron's embedded `INVOKER`
   mode (`ClientConductor.awaitResponse`). `Aeron.java`, `ClientConductor`, `DriverConductor` and their tests then
   port one to one.
2. **Shared memory is real (D16).** Every buffer that two agents share is a `SharedArrayBuffer`: the CnC (command
   ring, broadcast buffer, counters, error log), log buffers, and the stand-alone Agrona ring buffers.
   `OneToOneRingBuffer` and `ManyToOneRingBuffer` work across `worker_threads`, with Java's memory ordering, and are
   tested that way. Phase 2 still runs the driver on one thread (`INVOKER`, D3, D11).
3. **No core is ever spun.** Agents idle with Aeron's `BackoffIdleStrategy` (spin, then yield, then park), and on
   the event loop a park is a timer (D11) that a datagram, a send completion or a client call cuts short (D8).
   Measured (Node 22, 4 cores, scratch benches):

   | Hand-off with no busy spinning | p50 | p99 |
   |---|---|---|
   | Single thread, `setImmediate` wake (this phase) | 1.6 µs | 7.6 µs |
   | Worker with back-off, messages back to back | 1.1 µs | 19 µs |
   | Worker with back-off, a message every 100 µs | 23 µs | 83 µs |
   | Worker with back-off, a message every 2 ms | 112 µs | 543 µs |

   A worker driver (Aeron's `SHARED` mode, the whole driver in one worker) is therefore a later phase (§9,
   phase 4), offered next to `INVOKER` and chosen per deployment by benchmark. `DEDICATED` and `SHARED_NETWORK`
   are out of scope (D3).
4. **64-bit values in shared memory (D16).** The layout is Aeron's: a Java `long` is the 8 little-endian bytes at
   Java's offset, and ring positions, broadcast positions and counter values are full 64-bit values in their Java
   slots. Measured: an `Atomics` operation on a `BigInt64Array` allocates a `bigint` per call (a load caused 316
   scavenges per 20 million calls, a compare-and-set 1,891), so the port does not use it. Every `long` volatile,
   acquire, opaque, ordered, release, compare-and-set, compare-and-exchange, get-and-set and get-and-add method of
   `UnsafeBuffer` on a `SharedArrayBuffer` is a true 64-bit atomic on that word through a striped lock table outside
   the data (`LongStripes`, 1024 stripes, one `int` per cache line, shared with every worker through
   `worker_threads` environment data). A writer takes the stripe, stores the HIGH half and then the LOW half, and
   releases it; a reader retries while the stripe is odd or has changed. No allocation, never torn, any number of
   writers.
   - **Ring and broadcast positions** (head, tail, head cache, tail intent, latest) are straight Java 64-bit
     positions (D16 striped 64-bit atomics): the `long` accessors are used as Agrona uses them.
   - **64-bit counter values** (positions, publisher limits, stream and system counters) are straight Java 64-bit
     values at +0 of the counter record (D16 striped 64-bit atomics): `UnsafeBufferPosition`, `AtomicCounter` and
     `CountersReader` are Java's code unchanged (task T2b).
   - **Multi-writer 64-bit counters on the control plane** (`nextCorrelationId`) use the `long` `getAndAddLong`.
   - **Raw tails** use the port-only halves methods (`getLongVolatileHalves`, `putLongVolatileHalves`,
     `compareAndSetLongHalves`, `getAndAddLongHalves`): the full 64-bit range as an `int` pair, no `bigint` (D12).
   - **Plain ArrayBuffers** (single-thread data, for example a log buffer before phase 4) keep the plain accesses
     of phase 1: `UnsafeBuffer` picks the `Atomics` path only when it wraps a `SharedArrayBuffer`, chosen once at
     `wrap`.
5. **Settled phase 1 open items.**
   - D12: `ConcurrentPublication`'s per-message `getAndAddLong` on the raw tail becomes
     `LogBufferDescriptor.getAndAddRawTailOffset(metaData, partitionIndex, alignedLength)`, one atomic 64-bit add
     (`getAndAddLongHalves`, D16, made atomic by T2b) that carries from the low half into the high half exactly as the
     64-bit add does, returning the old term offset and leaving the old term id in a preallocated holder. No
     `bigint`.
   - `Long.MAX_VALUE` as a sentinel (`endOfStreamPosition` and the others) is `Long.MAX_VALUE` of `jdk.ts`,
     2^53 − 1. A position never reaches it (the cap below), so every comparison with the sentinel is unchanged.
   - D13: `LossDetector.pack(rebuildOffset, lossFound)` is `rebuildOffset * 2 + (lossFound ? 1 : 0)` (Java:
     `((long)rebuildOffset << 32) | (lossFound ? 1 : 0)`), a small integer for any term offset; the accessors
     `rebuildOffset(x)` and `lossFound(x)` invert it, and `PublicationImage` uses them.
   - Positions are capped at `min(termLength * 2^31, 2^53 − termLength)`, a term boundary. `Publication` reports `MAX_POSITION_EXCEEDED` at
     the cap, as Aeron does at its own limit.
   - D14: as specified, `(hi, lo)` keyed maps and `receiverIdHigh` / `receiverIdLow` on the flyweights.
6. **Name resolution (D7, refined).** The driver keeps Java's synchronous `NameResolver.resolve` call. The default
   resolver answers from a cache. The `Aeron` facade's `async*` add calls (`asyncAddPublication`, Java's own names)
   look up every host name in the channel with `dns.lookup` first and fill the cache, then send the command. The
   synchronous add calls accept IP literals and cached names and otherwise fail with Java's
   `UnknownHostException` message. Re-resolution (`DriverConductor.onReResolveEndpoint`) starts a lookup and the
   result reaches the conductor as a command on its next duty cycle.
7. **System properties.** `Configuration` reads its properties through `System.getProperty`, ported in `jdkLang.ts`
   over an in-memory property map that the application (and tests) set; nothing is read from the environment.
8. **Counters API is out of scope.** `Aeron.addCounter`, `Counter`, `CounterLink` and the static counter
   commands are not ported (Rune does not use them); their tests are `it.skip`. The driver's own counters
   (`SystemCounters`, stream positions) are ported.
9. **Built-in sets.** `ObjectHashSet` (the driver conductor's `activeSessionSet`) is a JS `Set`, control-plane only,
   recorded in `docs/mapping.md`. `IntHashSet` is ported (the dispatcher uses it per packet). `LongHashSet`
   (`ClientConductor.asyncCommandIdSet`, `DriverEventsAdapter`) is ported as Agrona's generator writes it from
   `IntHashSet` (amended in T5: one-to-one call sites at no cost).

## How every task is done (applies to all tasks)

Phase 1's six steps stand: port the test first and run it red, port the class, run it green with typecheck, lint
and the mapping check, update `docs/mapping.md`, one commit per task (`phase2(T<n>): <what>`). In addition:

- **Mockito.** `mock(X.class)` becomes a hand fake or `vi.fn()` fields typed as `X`; `spy(real)` becomes
  `vi.spyOn` on the real object; `ArgumentCaptor` becomes `mock.calls[i][j]`; `inOrder` becomes an order check on
  `mock.invocationCallOrder`. Each test keeps its `verify` count and order.
- **Real sockets in tests** (`ReceiverTest`, `SelectorAndTransportTest`, the transport tests). Java's
  `DatagramChannel` becomes the `test/support/Udp.ts` helper over `dgram` (IP literals, synchronous `lookup`).
  Waiting for a datagram is `await drainUntil(cond, maxTurns)`: it yields to the event loop with `setImmediate`,
  up to `maxTurns` times, and fails rather than hangs. No test waits on wall time.
- **Time.** Driver tests drive `CachedNanoClock` / `CachedEpochClock` and call `doWork` with the advanced time,
  as the Java tests do. Every drive loop has an iteration cap.
- **Workers.** A test that needs threads runs real `worker_threads` from `test/support/Workers.ts`, with a seeded
  workload, a hard iteration cap and a timeout well under the 3-minute suite budget.
- **Members for later phases.** A Java file is ported whole even when some members serve phase 3 (MDC, MDS,
  multicast) or later. Those members are ported but their tests are listed as "phase 3" in `docs/mapping.md`, not
  skipped silently.
- **Allocation checks.** Every per-message method a task ports gets an `expectNoAllocation` test
  (`test/support/Allocation.ts`) in `test/extra/`.
- **Performance gates.** Low latency is the requirement, so a slowdown fails like a red test.
  - *Allocation (hard, in CI).* The `expectNoAllocation` tests run in `npm test`; one allocation per message fails
    the build.
  - *Micro benches (from T3 on).* Every task that ports a per-message path adds a bench in `bench/micro/` (ns per
    operation, warmed up, fixed seed): T3 ring buffer `write` + `read` and `tryClaim` + `commit` (1 and 4 producers),
    T4 `transmit` + `receiveNext`, T15 `TermAppender` and the sender scan, T16 `TermRebuilder` and `TermReader`, T20
    `offer`, `tryClaim` and `poll`. The task records its baseline in `bench/README.md`.
  - *Regression gate (`npm run bench:gate -- --base <ref>`).* It builds `<ref>` (default `origin/main`) in a scratch
    directory outside the repo and runs base and candidate interleaved, A B A B, at least 5 pairs for latency and 3
    for throughput. It fails when the median of the per-pair ratios is over 1.10 for p99 or p99.9, over 1.05 for p50
    or ns per operation, or under 0.95 for throughput. A failure names the bench and the ratios. "Noise" is never a
    verdict: rerun with 15 pairs, then bisect.
  - *Where it runs.* Shared CI runners are too noisy for latency, so the gate runs on an idle machine: before
    every task's commit is merged into the branch when it touches a per-message path, and at the T25 checkpoint
    against `main`. CI runs the benches once per PR and only reports their numbers.

Paths below are relative to `aeron-{client,driver}/src/{main,test}/java/io/aeron/` (Aeron) and
`agrona/src/{main,test}/java/org/agrona/` (Agrona).

## Tasks

### Stage A — groundwork (no sockets)

#### T1 — Phase 1 open items: raw-tail add, position cap, `(hi, lo)` keys
- `LogBufferDescriptor.getAndAddRawTailOffset` (decision 5) with a holder for the old term id; the position cap
  helper `LogBufferDescriptor.maxPossiblePosition` stays Java's, plus `MAX_POSITION` (decision 5) in one place.
- D14: `src/agrona/collections/LongHalves2ObjectHashMap.ts` and `LongHalves2LongHashMap.ts` (additions, generated
  from the phase 1 `Long2*` ports with the key split into `(hi, lo)` `int`s stored in an `Int32Array`; same
  probing, same resize, `hash = Hashing.hash(hi, lo, mask)` from `Hashing.compoundKey`'s mix);
  `receiverIdHigh()` / `receiverIdLow()` and the matching setters on `StatusMessageFlyweight`,
  `RttMeasurementFlyweight` and `ErrorFlyweight`.
- Tests (`test/extra/`): the raw-tail add against a `bigint` model (offsets at 0, termLength − 32, termLength,
  `INT32_MAX` − 31 so the carry happens; term ids at `INT32_MIN`, −1, 0, `INT32_MAX`); the two maps against
  `Long2*` behaviour for random 64-bit keys (seeded, 10k ops, compared with a `Map<bigint>` model);
  `receiverIdHigh/Low` round trip at 0, −1, 2^63 − 1, −2^63; no allocation on `get`/`put`/`getAndAddRawTailOffset`.

#### T2 — Shared memory in `UnsafeBuffer` / `AtomicBuffer` (D16)
- `UnsafeBuffer` accepts a `SharedArrayBuffer` everywhere it accepts an `ArrayBuffer`. `BufferUtil
  .allocateDirectAligned` gains the addition `allocateShared(length, alignment)`.
- When the backing store is shared (decided at `wrap`), the `byte`, `short` and `int` `*Volatile`, `*Acquire`, `*Ordered`,
  `*Release`, `*Opaque`, `compareAndSet*`, `getAndAdd*`, `getAndSet*` use `Atomics` on `Int32Array` /
  `Int16Array` views (Agrona's alignment checks apply). The `long` forms on a shared buffer are 64-bit atomics on
  Java's word through `LongStripes` (T2b, decision 4). Plain buffers keep phase 1's code.
- Tests: the phase 1 buffer suites (`MutableDirectBufferTests`, `UnsafeBufferTest`, `AtomicBufferTest`) run a
  second time over a `SharedArrayBuffer` (a factory parameter, no copy of the tests). Cross-worker tests in
  `test/extra/agrona/concurrent/SharedAtomicsExtraTest.test.ts`: 4 workers × 100k `compareAndSetInt` increments
  end exact; 4 workers × 100k `getAndAddInt` end exact; a `putLongRelease` writer stepping across every 2^32
  boundary in [0, 2^40) while 3 readers check every value they read was written (never torn).

#### T2b — True 64-bit atomics on shared buffers, Aeron's layout (D16)
- Depends on T2. Replaces the rejected two-slot lock. New port-only `src/agrona/concurrent/LongStripes.ts` (1024
  stripes, one `int` per 64-byte line, created by the main thread at module load and handed to workers through
  `worker_threads` environment data; wrapping a `SharedArrayBuffer` in a worker with no table throws
  `IllegalStateException`). `UnsafeBuffer`'s shared `long` methods use it: writer lock by compare-and-set from even to
  odd by a test-and-set (`Atomics.or`), plain payload reads inside the lock, the two halves stored with
  `Atomics.store` (the D16 rule: HIGH half first and only when it changed, LOW half always last), release with stripe
  plus two, or the old value back when nothing was written; reader loads stripe, halves, stripe and retries while odd
  or changed, and never writes the stripe. Every striped body is one compact, inlined method (under V8's 460 byte
  limit) behind a tiny dispatcher. Dead-holder rule: a thread is never `worker.terminate()`d while it can be inside a
  buffer operation; after 2^28 spins on a held stripe an operation throws `IllegalStateException` (a failure detector,
  lowered in the kill test by the port-only `UnsafeBuffer.setStripeSpinCapForTests`). The `BigInt64Array` view, `toLong`
  and the `*Seq` methods are deleted. Port-only `getLongVolatileHalves`, `putLongVolatileHalves`,
  `compareAndSetLongHalves`, `getAndAddLongHalves` (on `AtomicBuffer` too) cover the full 64-bit range for the raw
  tails.
- `LogBufferDescriptor.getAndAddRawTailOffset`, `rawTailVolatile` and `casRawTail` use the halves methods, so every
  raw tail operation is one atomic 64-bit operation (closes issue #10).
- Counters (`AtomicCounter`, `UnsafeBufferPosition`, `UnsafeBufferStatusIndicator`, `CountersReader`,
  `CountersManager`) are straight Java and 64-bit atomic on a shared buffer for free.
- Tests (`test/extra/agrona/concurrent/`, `test/extra/client/logbuffer/`): `LongStripesExtraTest` (stripe range and
  spread, same table in a worker, wrap without a table throws); `SharedLongAtomicsExtraTest` (Java layout of every
  `long` atomic, carry, stripe released on every exit, halves methods over both backings, no allocation);
  `SharedLongAtomicsWorkersExtraTest` (readers never see a torn long; 4 workers × 200k `getAndAddLong` exact across
  2^32; 4 × 100k CAS increments exact; two words on one stripe; the low half is written last so an `int` reader sees
  the high half; `TermRebuilder` frames never read as padding, which guards its own int order); the stripe wraps from
  `INT32_MAX` to `INT32_MIN`; `RawTailAtomicityExtraTest` (carry into the term id, the (termId, offset) pair is never
  torn while another thread rotates, no allocation); `SharedCountersExtraTest` (value at Java's offset, torn-read tests
  with 3 readers across 2^32 and across many boundaries, reuse, the `AtomicCounter` / position / `forEach` gaps over
  both backings). `SharedAtomicsExtraTest` loses its `*Seq` tests and its two stalled-writer tests, which the
  dead-holder rule and the kill test supersede.
- Review fixes: `SharedLongAtomicsAllocationExtraTest` and `PlainLongAtomicsAllocationExtraTest` (no heap number for
  values around 2^40 on each backing, one backing per file); `StripeKillAdversarialRegression`
  (`aStripeLeftOddByATerminatedWriterFailsLoudlyInsteadOfHangingAdversarialRegression`: a terminated worker leaves a
  stripe odd and every operation on it throws `IllegalStateException` instead of hanging;
  `halvesWritesStoreTheLowHalfLastAdversarialRegression`).

#### T3 — Agrona ring buffers: `OneToOneRingBuffer`, `ManyToOneRingBuffer` (D16)
- Sources: `concurrent/{MessageHandler, ControlledMessageHandler}`, `concurrent/ringbuffer/{RingBuffer,
  RingBufferDescriptor, RecordDescriptor, OneToOneRingBuffer, ManyToOneRingBuffer}`.
- Every head / tail / head-cache access is straight Java 64-bit positions (D16 striped 64-bit atomics, decision 4);
  the consumer heartbeat is `getLongVolatile` / `putLongRelease`; `nextCorrelationId` uses the `long` `getAndAdd`.
  `tryClaim` / `commit` / `abort` write the record in place in the shared buffer (zero copy), as Java does.
- Tests: `OneToOneRingBufferTest` (37), `ManyToOneRingBufferTest` (44). Java's `long` accessors are
  used as they are (straight Java 64-bit positions); no test change is needed for them.
- Extra cross-worker tests (`test/extra/agrona/concurrent/ringbuffer/`):
  - many-to-one: 4 producer workers × 250k messages of seeded random lengths (0 to `maxMsgLength`), one consumer;
    every message arrives once, in per-producer order, with its bytes intact; repeated with the positions
    started 64 KiB below 2^32 so they cross it during the run; repeated with `tryClaim` / `commit` and `abort`;
  - one-to-one: the same with one producer;
  - `unblock` with a producer worker that exits itself right after `tryClaim`: the consumer gets past it (a worker is
    never `terminate()`d inside a buffer operation, T2b's dead-holder rule);
  - the consumer heartbeat read from another worker is never torn;
  - no allocation per `write`, `tryClaim`, `commit` and `read` (the consumer's handler excluded).
- Bench harness: `bench/micro/` runner (`npm run bench:micro`) and its first benches (see Testing, Performance
  gates); `npm run bench:gate` comes with it, comparing micro benches only until T24.

#### T4 — Agrona broadcast and buffers
- Sources: `concurrent/broadcast/{BroadcastBufferDescriptor, RecordDescriptor, BroadcastTransmitter,
  BroadcastReceiver, CopyBroadcastReceiver}`, `ExpandableArrayBuffer`.
- Broadcast counters (tail intent, tail, latest) are straight Java 64-bit positions (D16 striped 64-bit atomics,
  decision 4); `validate` is Java's.
- Tests: `BroadcastTransmitterTest` (8), `BroadcastReceiverTest` (9), `ExpandableArrayBufferTest` (12).
  Extra: one transmitter, 3 receiver workers, lapping on purpose; every receiver either reads a record intact or
  reports a lap, never a torn record.

#### T5 — Agrona: sets, errors, idle strategies, status indicators, clocks
- Sources: `collections/{IntHashSet, LongHashSet (generated), MutableInteger}`,
  `concurrent/{CountedErrorHandler, ManyToOneConcurrentLinkedQueue, BusySpinIdleStrategy,
  SleepingMillisIdleStrategy, ControllableIdleStrategy, NoOpLock, EpochNanoClock, SystemEpochNanoClock}`,
  `concurrent/errors/{DistinctErrorLog, ErrorLogReader, ErrorConsumer, LoggingErrorHandler}`,
  `concurrent/status/{StatusIndicator, StatusIndicatorReader, UnsafeBufferStatusIndicator,
  ConcurrentCountersManager}`, `SemanticVersion`.
- `ManyToOneConcurrentLinkedQueue` holds JS objects and is single-thread (it carries the conductor's own
  commands); `ConcurrentCountersManager` is `CountersManager` (one thread allocates counters) with Java's API.
- Tests: `IntHashSetTest` (99), `MutableIntegerTest` (1), `ManyToOneConcurrentLinkedQueueTest` (9),
  `DistinctErrorLogTest` (13), `ErrorLogReaderTest` (7).

#### T6 — Command flyweights, CnC layout, client status
- Sources: `command/*` except the counter and response-channel ones (`CounterMessageFlyweight`,
  `CounterUpdateFlyweight`, `RemoveCounterFlyweight`, `StaticCounter*`, `NextAvailableSessionId*`,
  `GetNextAvailableSessionId*` are not ported: decision 8 and §3), `CncFileDescriptor` (layout and the version
  check; the buffer is a `SharedArrayBuffer`, D4), `status/{ChannelEndpointStatus, LocalSocketAddressStatus,
  ReadableCounter, HeartbeatTimestamp, PublicationErrorFrame}`.
- Tests: `TerminateDriverFlyweightTest` (1); `CounterMessageFlyweightTest` (2) is `it.skip` (decision 8). Extra:
  every command flyweight encode → decode round trip with strings at length 0, 1 and the maximum, and `long`
  fields at the D5 bounds.

#### T7 — Driver status counters and configuration
- Sources: `driver/status/*` (including `ClientHeartbeatTimestamp` and `DutyCycleStallTracker`: the conductor,
  sender and receiver call their duty-cycle trackers every cycle, so §3's cut of `DutyCycleTracker` is dropped),
  `DutyCycleTracker`, `ThreadingMode`, `Configuration`, `MediaDriver.Context` (everything except directories, files, mark file and
  the out-of-scope features; `INVOKER` only, D3), `PublicationParams`, `SubscriptionParams`,
  `DriverManagedResource`, `SessionKey`.
- Tests: `ConfigurationTest` (2), `DutyCycleStallTrackerTest` (4), `MediaDriverContextTest` (36; the directory, file and mark-file tests are
  `it.skip`), `PublicationParamsTest` (37; response-channel rows are `it.skip`, §3).

#### T8 — Addresses, interfaces and name resolution
- Sources: `media/{SocketAddressParser, NetworkUtil, InterfaceSearchAddress, NamedInterface, NetworkInterfaceShim,
  ResolvedInterface, UnresolvedInterface}`, `NameResolver`, `DefaultNameResolver` (cache-backed, decision 6),
  `TimeTrackingNameResolver`.
- `NetworkInterfaceShim` reads `os.networkInterfaces()`; tests inject a fake shim as the Java tests do.
- Tests: `SocketAddressParserTest` (16), `NetworkUtilTest` (13), `NamedInterfaceTest` (2),
  `UnresolvedInterfaceTest` (2), `DefaultNameResolverTest` (2), `TimeTrackingNameResolverTest` (11).

#### T9 — `UdpChannel`
- Source: `media/UdpChannel` (every parameter, including the multicast, MDC and tag parts phase 3 uses).
- Tests: `UdpChannelTest` (47).

#### T10 — Delay generators, congestion control, unicast flow control
- Sources: `FeedbackDelayGenerator`, `StaticDelayGenerator`, `OptimalMulticastDelayGenerator`, `CongestionControl`,
  `CongestionControlSupplier`, `DefaultCongestionControlSupplier`, `StaticWindowCongestionControl`, `FlowControl`,
  `FlowControlSupplier`, `DefaultUnicastFlowControlSupplier`, `UnicastFlowControl`.
- Tests: `OptimalMulticastDelayGeneratorTest` (1), `StaticWindowCongestionControlTest` (3), `FlowControlTest` (9;
  the rows built on the multicast strategies are phase 3).

#### T11 — `LossDetector`, `RetransmitHandler`
- Sources: `LossDetector` (D13 packing, decision 5), `LossHandler`, `RetransmitHandler`, `RetransmitSender`.
- Tests: `LossDetectorTest` (13), `RetransmitHandlerTest` (17).

### Stage B — sockets and the driver

#### T12 — `dgram` contract, transport, pollers (D1, D2)
- `test/system/dgramContract.test.ts` first: N1–N8 of spec §4.2 (N3 skipped, with the reason logged, when there
  is no route off the host).
- Sources: Agrona `nio/TransportPoller` (the selector parts become the transport list), `media/{UdpTransportPoller,
  UdpChannelTransport, PortManager, WildcardPortManager}`, plus the additions `ReceiveRing` and the send slot of
  spec §4.2, and `test/support/Udp.ts`.
- Tests: `UdpChannelTransportTest` (9), `WildcardPortManagerTest` (10), and every `UdpChannelTransport` test listed
  in spec §4.2 (`test/extra/driver/media/UdpChannelTransportExtraTest.test.ts`).

#### T13 — Endpoints and pollers
- Sources: `media/{ControlTransportPoller, DataTransportPoller, SendChannelEndpoint, ReceiveChannelEndpoint,
  ReceiveChannelEndpointThreadLocals, ImageConnection, ControlMode}`, `SendChannelEndpointSupplier`,
  `ReceiveChannelEndpointSupplier`, `DefaultSendChannelEndpointSupplier`, `DefaultReceiveChannelEndpointSupplier`.
  `MultiSndDestination` (inside `SendChannelEndpoint`), `MultiRcvDestination` and `ReceiveDestinationTransport`
  are ported here because the endpoints reference them; their behaviour is tested in phase 3.
- Tests: `SendChannelEndpointTest` (11), `ReceiveChannelEndpointTest` (2), `SelectorAndTransportTest` (6).
- Channel timestamps via `EpochNanoClock.nanoTimeHalves` (D17).

#### T14 — `DataPacketDispatcher` and setup handling
- Sources: `DataPacketDispatcher`, `PendingSetupMessageFromSource`.
- Tests: `DataPacketDispatcherTest` (16).

#### T15 — Log buffers in memory, `NetworkPublication`, `Sender`
- Sources: `buffer/{RawLog, LogFactory}` plus the addition `buffer/MemoryLogFactory` (log buffers on a
  `SharedArrayBuffer`, registered by log name so the client's `LogBuffers` finds them; Aeron's test
  `TestLogFactory` is the model), `NetworkPublication`, `NetworkPublicationThreadLocals`, `SenderProxy`, `Sender`.
- Tests: `NetworkPublicationTest` (3), `SenderTest` (11), and the short-send test of spec §4.2 (socket short-sends
  for N cycles: `senderPosition` holds, `SHORT_SENDS` counts N, the receiver sees every byte once).

#### T16 — `PublicationImage`, `Receiver`
- Sources: `PublicationImage`, `ReceiverProxy`, `Receiver`, `SubscriberPosition`.
- Tests: `PublicationImageTest` (16), `ReceiverTest` (8).
- Channel timestamps via `EpochNanoClock.nanoTimeHalves` (D17).

#### T17 — Client-facing driver side: `ClientProxy`, `ClientCommandAdapter`, links, proxies
- Sources: `ClientProxy`, `ClientCommandAdapter`, `CommandProxy`, `DriverConductorProxy`, `AeronClient`,
  `PublicationLink`, `SubscriptionLink`, `NetworkSubscriptionLink`, `UntetheredSubscription`, `Subscribable`.
- Tests: `ClientCommandAdapterTest` (4).

#### T18 — `DriverConductor` and `MediaDriver` launch
- Sources: `DriverConductor` (the network commands; the IPC, spy, counter and response-channel members are left
  out and listed), `MediaDriver` (launch with `INVOKER`: `sharedAgentInvoker()`; the CnC is created in memory).
- Tests: `DriverConductorTest` (105: the 29 IPC and spy tests, the counter tests and the response-channel tests
  are `it.skip` with their reasons; every other test is ported and green), `UntetheredSubscriptionTest` (1),
  `MediaDriverTest` (4; the config-print and file tests are `it.skip`).

### Stage C — client, end to end, interop

#### T19 — Client conductor and the `Aeron` facade
- Sources: `LogBuffers` (looks up the in-memory raw log by name, D4), `DriverProxy`, `ClientConductor`, `Aeron`
  and `Aeron.Context` (embedded: `driverAgentInvoker`, CnC taken from the `MediaDriver` instance instead of a
  directory), the rest of `CommonContext`, `AvailableImageHandler`, `UnavailableImageHandler`.
- Tests: `ClientConductorTest` (37), `DriverProxyTest` (3), `LogBuffersTest` (3), `CommonContextTest` (13),
  `AeronContextTest` (4).

#### T20 — Publications, images, subscriptions
- Sources: `Publication`, `ConcurrentPublication` (raw tail via decision 5), `ExclusivePublication`, `Image`,
  `Subscription`, `DirectBufferVector`, `ReservedValueSupplier`.
- Tests: `PublicationTest` (18), `ImageTest` (27), `SubscriptionTest` (16). Extra: no allocation per `offer`,
  `tryClaim` + `commit`, `poll`, `controlledPoll`, `blockPoll`.

#### T21 — Loss generators and debug endpoints
- Sources: `ext/{LossGenerator, FixedLossGenerator, RandomLossGenerator, MultiGapLossGenerator,
  DebugChannelEndpointConfiguration, DebugSendChannelEndpoint, DebugReceiveChannelEndpoint, and their
  suppliers}`. (Moved from phase 3: the phase 2 exit needs loss.)
- Tests: `FixedLossGeneratorTest` (4), `MultiGapLossGeneratorTest` (3).

#### T22 — Event-loop runner and TS ↔ TS end to end
- The `AgentRunner` for the embedded driver plus client (one `CompositeAgent`, `BackoffIdleStrategy`, D11), and
  the D8 wake hooks (datagram arrival, send completion, facade calls).
- `test/system/`: real UDP on loopback, two `MediaDriver`s in one process, default configuration:
  publication-first and subscription-first; unfragmented, fragmented and max-size messages; term rotation with a
  non-zero `init-term-id` and a wrapping `term-id`; close mid-fragmented-message; subscriber gone (connection
  timeout → `NOT_CONNECTED`) and back (new image); loss with the debug endpoints (fixed and seeded random);
  produced = consumed, in order, with no duplicates, in every case.
- `test/system/netsim/`: the deterministic network simulation of spec §8.2 (in-memory transport, seeded loss,
  reorder, duplicate and delay, advanced clock, capped drive loop), 200 seeds per scenario.

#### T23 — Interop with the C driver
- `test/interop/`: builds (CI, cached by tag) the C 1.53.3 `aeronmd` and samples. The unicast rows of spec §8.3:
  TS publication → C subscriber and C publisher → TS subscription; both directions under C-driver loss
  (`AERON_UDP_CHANNEL_*_INTERCEPTORS`); fragmentation sizes (1 B, MTU − 32, MTU − 31, 2 × MTU, term length / 8);
  term rotation; subscriber leaves and rejoins (EOS, image re-creation). Produced = consumed in every case.
- A CI job runs it on Linux; locally it is skipped, with a message, when the C build is missing.

#### T24 — Benches, baselines and the gate
- `bench/`: TS ↔ TS loopback latency (offer → poll, p50 / p99 / p99.9, ≥ 5 runs interleaved) and throughput
  (≥ 3 runs), allocations per message (`--trace-gc` and the allocation sampler), with the `dgram` floor reported
  apart (spec §5.3). Baselines recorded in `bench/README.md`.
- These end-to-end benches join the micro benches under `npm run bench:gate` (see Testing, Performance gates),
  and a non-gating CI job runs them and posts the numbers.
- Tests for the gate itself: a candidate with an injected 20% delay in `TermReader.read` fails it; the same commit
  as base and candidate passes it.

#### T25 — Phase checkpoint
- Full suite, typecheck, lint, format, mapping check, interop. Whole-branch review against the Java sources (most
  capable model), then one fix round for urgent items; the rest become issues.

## Interaction matrix

| Area | Operations | Entities / values | Orderings / timings |
|---|---|---|---|
| Ring buffers (T3) | `write`, `tryClaim` + `commit` / `abort`, `read`, `controlledRead`, `unblock`, `nextCorrelationId`, heartbeat | message length 0, 1, `maxMsgLength`, `maxMsgLength` + 1; record that needs padding at the buffer end; capacity 64 B (min) to 2^30 | 1 and 4 producer workers; positions crossing 2^32 mid-run; producer dies between claim and commit; consumer slower than producers (full buffer) |
| Broadcast (T4) | `transmit`, `receiveNext`, copy receive | record exactly at the end; lengths 0 to max | 3 receivers; a receiver lapped once and many times |
| Commands (T17–T19) | add / remove publication (shared, exclusive), add / remove subscription, client close, client timeout | same channel and stream twice; invalid URI; unknown registration id | command while the conductor is mid-cycle; remove before the add reply; client times out with resources live |
| Data path (T15, T16, T20) | `offer`, `tryClaim`, sender scan, `onDataPacket` → rebuild, `poll` | 0-length, 1 B, MTU − 32, fragmented, max message; padding at term end | term rotation during a retransmit; `init-term-id` near `INT32_MAX`; position near the cap |
| Loss and flow (T11, T15, T16, T21) | NAK, retransmit, SM, window, heartbeat | single gap, many gaps, gap at term end; lost SM; lost SETUP | NAK in flight when the publication closes; SM lost while the window is full; loss during rotation |
| Lifecycle (T18, T22) | publication `ACTIVE → DRAINING → LINGER → DONE`, image `INIT → ACTIVE → DRAINING → LINGER → DONE` | publisher first / subscriber first; two images on one subscription | subscriber leaves and returns; publisher closes mid-message; receiver restarts mid-term; linger expiry |
| Sockets (T12, T13) | send, receive, close, bind | port 0, port in use, wildcard ports; IPv4 and IPv6 loopback | short sends for N cycles; send error later (D2); ring overflow (D1); close with queued sends |

## Review focus

- **Shared memory:** every cross-agent field goes through the T2 / T2b atomics (D16 striped 64-bit atomics); every
  position is a straight Java 64-bit value; no `bigint` on a per-message path. x86 hides most missing release /
  acquire orderings, so a stress test cannot prove them: the reviewer checks every shared access in T3 and T4 against
  the Java call (`putIntRelease` stays `putIntRelease`, and so on), and a test lists the ring and broadcast sources'
  buffer calls and fails on any plain access to a header, length or position field. Mutation checks that a
  stress test does catch: drop the tail compare-and-set (two producers claim the same slot) and start the
  positions 64 KiB below 2^32 (the crossing run fails if a half is lost). The striped writes store the HIGH half
  first and the LOW half last; a new reader of only the low `int` of a long relies on that.
- **Line-by-line fidelity:** member order, branches, constants and timeouts match the Java files; every skip and
  rename is in `docs/mapping.md` with a reason.
- **Protocol on the wire:** frames and timings checked against the C driver (T23), not by reading the code.
- **Allocation:** the port's own code allocates nothing per message (T24 bench and the `expectNoAllocation` tests).
- **Latency:** `bench:gate` passed against the base for every merged task that touched a per-message path, and
  against `main` at T25; the ratios are in the review report.
- **Tests:** none waits on wall time or runs an uncapped loop; no assertion weakened; Mockito verifications kept
  with counts and order.
