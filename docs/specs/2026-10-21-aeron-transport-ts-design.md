# aeron-transport-ts — design spec

**Status:** approved · **Date:** 2026-10-21 · **Repo:** `github.com/arcanumruna/aeron-transport-ts`

## 1. Goal

A faithful TypeScript port of the **Aeron UDP transport** (the "rUDP" protocol) for Node.js. A Node process can then
publish to and subscribe from any Aeron peer over UDP: a real Aeron media driver (C or Java), or a Rune broker,
which embeds one. It runs without a media driver process, shared memory or native add-ons.

Two hard requirements shape everything below:

1. **Wire compatibility.** Every frame that goes on the wire is byte-identical to Aeron's, and the transport follows
   the same protocol rules: setup and elicitation, status messages, NAKs, retransmit, flow control, heartbeats, EOS
   and RTT measurement. A real Aeron driver must not be able to tell it apart.
2. **One-to-one mapping.** Each in-scope Aeron source file has exactly one TypeScript file, with the same class,
   method, field and constant names and the same control flow. Each in-scope Aeron test file has exactly one
   TypeScript test file, with one test per Aeron test method and the same name. A reviewer can put the two side by
   side and diff them by eye.

**Not a goal:** a Rune client. `rune-client-nodejs` will be built on top of this later, as a separate project.

## 2. Reference implementation (pinned)

| What | Version | Use |
|---|---|---|
| Aeron Java: `aeron-client`, `aeron-driver` | **1.53.3** (tag `1.53.3`) | The source of the one-to-one port: code and tests |
| Agrona | **2.6.1** (the version Aeron 1.53.3 pins) | Source of the small Agrona subset we port (§5.1) |
| Aeron C media driver + C samples | **1.53.3** | Interop peer in the integration tests (§8.3) |

**Why Java and not C as the source:** Java's class structure (`NetworkPublication`, `PublicationImage`,
`LossDetector`, `ReceiveChannelEndpoint`, ...) maps onto TypeScript classes directly. The JUnit suites are also the
canonical, most complete test suite for the transport, and they map onto a TypeScript test runner method for
method. The C driver is the same protocol, so it serves as the independent interop check.

Upgrading the pinned version is a deliberate task: diff Aeron `1.53.3..new` over the mapped files and port the diff
file by file.

## 3. Scope

### In scope
- **Protocol flyweights** (`io.aeron.protocol`): `HeaderFlyweight`, `DataHeaderFlyweight`, `SetupFlyweight`,
  `StatusMessageFlyweight`, `NakFlyweight`, `RttMeasurementFlyweight`, `ErrorFlyweight`, `ResponseSetupFlyweight`.
- **Log buffers** (`io.aeron.logbuffer`): `FrameDescriptor`, `LogBufferDescriptor`, `HeaderWriter`, `Header`,
  `TermReader`, `TermScanner`, `TermBlockScanner`, `TermGapScanner`, `TermRebuilder`, `TermGapFiller`,
  `TermUnblocker`, `LogBufferUnblocker`, `BufferClaim`, and the handler interfaces.
- **Client data path** (`io.aeron`): `ChannelUri`, `ChannelUriStringBuilder`, `Publication`, `ExclusivePublication`,
  `ConcurrentPublication`, `Subscription`, `Image`, `FragmentAssembler`, `ImageFragmentAssembler`,
  `ControlledFragmentAssembler`, `ImageControlledFragmentAssembler`, `BufferBuilder`, `ErrorCode`, `LogBuffers`,
  `CommonContext` (the channel and parameter constants only), and `Aeron` as the in-process facade (§4.3).
- **Driver UDP data path** (`io.aeron.driver`): `MediaDriver` (context and launch), `Configuration`,
  `DriverConductor` (the network commands only), `Sender`, `Receiver`, `NetworkPublication`, `PublicationImage`,
  `DataPacketDispatcher`, `LossDetector`, `RetransmitHandler`, `StaticDelayGenerator`,
  `OptimalMulticastDelayGenerator`, `FeedbackDelayGenerator`, `CongestionControl`, `StaticWindowCongestionControl`,
  `FlowControl`, `UnicastFlowControl`, `MaxMulticastFlowControl`, `MinMulticastFlowControl`,
  `TaggedMulticastFlowControl`, `PreferredMulticastFlowControl`, `AbstractMinMulticastFlowControl`, the
  `*Supplier`s, `ReceiverLivenessTracker`, `PublicationParams`, `SubscriptionParams`, `PublicationLink`,
  `SubscriptionLink`, `NetworkSubscriptionLink`, `SubscriberPosition`, `SessionKey`, `PendingSetupMessageFromSource`,
  `SenderProxy`, `ReceiverProxy`, `DriverConductorProxy`, `CommandProxy`, `ThreadingMode`, `DriverManagedResource`,
  `RetransmitSender`, `LossHandler`.
- **Driver media** (`io.aeron.driver.media`): `UdpChannel`, `UdpChannelTransport`, `SendChannelEndpoint`,
  `ReceiveChannelEndpoint`, `ReceiveDestinationTransport`, `MultiRcvDestination`, `ImageConnection`,
  `ControlTransportPoller`, `DataTransportPoller`, `UdpTransportPoller`, `ControlMode`, `SocketAddressParser`,
  `NetworkUtil`, `InterfaceSearchAddress`, `PortManager`, `WildcardPortManager`.
- **Channel features:** unicast; multicast; **multi-destination-cast** (MDC) with dynamic and manual control modes,
  on both the publication and the subscription side; multi-destination subscriptions (MDS); `session-id`,
  `init-term-id`/`term-id`/`term-offset`, `mtu`, `term-length`, `rcv-wnd`, `so-sndbuf`/`so-rcvbuf`, `linger`,
  `reliable`, `sparse`, `tether`, `group`, `gtag`, `fc`, `cc` (static only), `ttl`, `interface`, `nak-delay`,
  `untethered-*`, `eos`, `rejoin`.
- **Status counters** (`io.aeron.driver.status`): the per-stream positions (`PublisherLimit`, `SenderPos`,
  `SenderLimit`, `ReceiverHwm`, `ReceiverPos`, `SubscriberPos`, ...) and `SystemCounters`, held in an in-memory
  counters store (§5.1).
- **Debug/loss tooling** (`io.aeron.driver.ext`): `LossGenerator`, `FixedLossGenerator`, `RandomLossGenerator`,
  `MultiGapLossGenerator`, `DebugSendChannelEndpoint`, `DebugReceiveChannelEndpoint`. These are needed for the
  loss and retransmit tests.

### Out of scope (each with a reason)
| Excluded | Why |
|---|---|
| IPC publications, spy subscriptions (`IpcPublication`, `SpySubscriptionLink`, ...) | Same-process IPC needs no transport. It can be added later on the same log buffers. |
| CnC file, client ↔ driver shared-memory protocol (`ClientConductor`, `DriverProxy`, `ClientCommandAdapter`, `command/*`, `CncFileDescriptor`) | There is no separate driver process. The client facade calls the conductor in-process (§4.3). |
| Memory-mapped files (`MappedRawLog`, `FileStoreLogFactory`, loss report file) | Log buffers are in-memory `ArrayBuffer`s. |
| Driver name resolver / gossip (`DriverNameResolver*`, `UdpNameResolutionTransport`, `ResolutionEntryFlyweight` use) | Optional Aeron feature. Hostnames resolve through `dns.lookup` (`DefaultNameResolver`). |
| ATS (encrypted transport, frame types 0x08–0x0A) | Aeron Premium only, not in open-source Aeron. |
| Response channels (`control-mode=response`, `RSP_SETUP` use) | A newer feature that Rune does not use. The flyweight is ported; the flow is a later phase. |
| `CubicCongestionControl` | Not the default; deferred. |
| Driver logging agents, `DutyCycleTracker`, termination validators, `NativeResourceAgent` | Diagnostics and process management, not transport. |

## 4. Architecture

### 4.1 Threading: Aeron's `INVOKER` mode on the Node event loop
Node gives us one JS thread. That matches Aeron's **`ThreadingMode.INVOKER`**: the conductor, sender and receiver
agents are combined into one `CompositeAgent` and stepped by an `AgentInvoker`. The `CommandProxy` queues stay.
They become plain bounded FIFOs (a port of `OneToOneConcurrentArrayQueue` with no atomics), drained in each agent's
`doWork`. Ordering is then exactly Aeron's.

```
Node event loop
 ├─ dgram 'message' events ──► UdpTransportPoller receive ring (preallocated slots)
 └─ AgentRunner (setImmediate / timer, IdleStrategy) ──► AgentInvoker.invoke()
        CompositeAgent: DriverConductor.doWork(nowNs)
                        Sender.doWork(nowNs)     — poll control socket ring, send data/setup/heartbeats/RTTM
                        Receiver.doWork(nowNs)   — poll data socket rings, SMs, NAKs, image liveness
```

- **Time** is injected: `NanoClock` / `EpochClock` (the Agrona interfaces). Production uses
  `process.hrtime.bigint()` converted to `number` nanoseconds relative to the process start. Tests use
  `CachedNanoClock` and advance it explicitly.
- **AgentRunner** drives `invoke()` from `setImmediate` while there is work, and backs off through an
  `IdleStrategy` port (`BackoffIdleStrategy`, `SleepingIdleStrategy`, `NoOpIdleStrategy`) mapped onto timers
  when idle. It never busy-spins the event loop. Users may instead call `aeron.doWork()` themselves (the
  `AgentInvoker` API).

### 4.2 Sockets
- `UdpChannelTransport` wraps `dgram.Socket` (`udp4` / `udp6`, `reuseAddr`, multicast membership, TTL,
  `SO_RCVBUF` / `SO_SNDBUF` via `setRecvBufferSize` / `setSendBufferSize`).
- **Receive:** Aeron polls sockets with `recvfrom`; Node delivers datagrams as events. `UdpTransportPoller` keeps
  Aeron's `pollTransports()` API. The `'message'` handler copies each datagram into a slot of a preallocated
  receive ring. `pollTransports()` drains the ring and calls `onFrame`/`onDataPacket` exactly as Aeron's poller
  calls them. A full ring drops the datagram and increments a counter; Aeron's protocol treats that like any lost
  packet.
- **Send:** `socket.send()` is asynchronous and never returns `EAGAIN`. `sendto` therefore always reports the full
  length as sent (Aeron's success path). The outstanding-send count is tracked so a stuck socket shows up in a
  counter, the same as Aeron's short-send counter.

### 4.3 The in-process `Aeron` facade
`Aeron.addPublication(channel, streamId)`, `addExclusivePublication`, `addSubscription(channel, streamId,
availableImageHandler, unavailableImageHandler)`, `close()`. These call `DriverConductor.onAddNetworkPublication` /
`onAddNetworkSubscription` / `onRemove*` directly and return the client objects (`ExclusivePublication`,
`Subscription`, `Image`) bound to the same in-memory `LogBuffers` and position counters as the driver side. The
client-side classes keep Aeron's code and method names (`offer`, `tryClaim`, `poll`, `controlledPoll`,
`blockPoll`, `position`, `isConnected`, ...). Only how they are created changes.

### 4.4 Lifecycles (Aeron's rich-state machines, unchanged)
- `NetworkPublication.State`: `ACTIVE → DRAINING → LINGER → DONE`.
- `PublicationImage.State`: `INIT → ACTIVE → DRAINING → LINGER → DONE`.
- `ReceiveChannelEndpoint` / `SendChannelEndpoint` status (`ChannelEndpointStatus`), `LossDetector` gap state,
  `RetransmitHandler` `RetransmitAction` states (`DELAYED`, `LINGERING`, `INACTIVE`).

These are ported as they are, with the same states, transitions and timeouts.

## 5. Mapping rules (how the one-to-one port is written)

### 5.1 Files and names
- `io/aeron/<pkg>/<Name>.java` → `src/<pkg>/<Name>.ts`. Example: `io/aeron/driver/media/UdpChannel.java` →
  `src/driver/media/UdpChannel.ts`. Agrona: `org/agrona/<pkg>/<Name>.java` → `src/agrona/<pkg>/<Name>.ts`.
- Class, method, field, enum and constant names are kept exactly, including `SCREAMING_CASE` constants and
  `Configuration` property names (`aeron.mtu.length` and the others). Overloads become one method with optional or
  union parameters where the overloads differ only in arity; otherwise they get distinct names with the Java name
  as prefix (`offer` / `offerVectored`). Every rename is listed in `docs/mapping.md`.
- Each TypeScript file opens with a header naming its source: `// Port of io/aeron/logbuffer/TermRebuilder.java
  @ 1.53.3`. It keeps Aeron's Apache-2.0 copyright notice (see §10).
- Methods stay in the same order as in the Java file, so a side-by-side diff lines up.
- **Agrona subset**, ported only as far as used: `concurrent/UnsafeBuffer` (with `DirectBuffer`,
  `MutableDirectBuffer`, `AtomicBuffer`), `BitUtil`, `concurrent/{Agent, AgentInvoker, AgentRunner,
  CompositeAgent, IdleStrategy, BackoffIdleStrategy, SleepingIdleStrategy, NoOpIdleStrategy, NanoClock,
  EpochClock, CachedNanoClock, CachedEpochClock, SystemNanoClock, SystemEpochClock, OneToOneConcurrentArrayQueue}`,
  `concurrent/status/{Position, ReadablePosition, AtomicCounter, CountersManager, CountersReader,
  UnsafeBufferPosition}`, `collections/{Int2ObjectHashMap, Long2ObjectHashMap, Long2LongHashMap, ArrayUtil,
  ArrayListUtil}`, `SystemUtil` (`parseSize`, `parseDuration`), `CloseHelper`, `ErrorHandler`. Where JS has an
  exact built-in equivalent (`Map` for `Int2ObjectHashMap` on non-hot paths), the port may use it. That choice is
  recorded in `docs/mapping.md`.

### 5.2 Types
| Java | TypeScript | Rule |
|---|---|---|
| `int`, `short`, `byte` | `number` | Wrapped with `\| 0` / `>>> 0` exactly where Java's overflow matters (term ids, `computeTermIdFromPosition`, sequence wrap). |
| `long` holding a **position, offset, length or time in ns** | `number` | Exact up to 2^53. Positions cap at 2^53 − 1 (8 PiB per stream); a publication refuses to go past it with `MAX_POSITION_EXCEEDED`, as Aeron does at its own limit. Clock values are ns since process start. |
| `long` that is an **opaque 64-bit wire value** (`receiverId`, `groupTag`, RTTM `echoTimestampNs` / `receptionDelta`, reserved value, registration/correlation ids on the wire) | `bigint` | Read and written with `getBigInt64` / `setBigInt64`. Never on a per-data-frame hot path. |
| `DirectBuffer` / `UnsafeBuffer` | `UnsafeBuffer` port over `ArrayBuffer` + `DataView` | Little-endian, the same API (`getInt`, `putLong`, `wrap`, `capacity`, ...). |
| `volatile` / `VarHandle` / `putOrdered*` | plain access | Single JS thread. The `*Volatile` / `*Ordered` method names are kept as aliases so the call sites read the same. |
| `Object` / `Runnable` command | object / closure | Queued commands are preallocated where Aeron preallocates them. |

### 5.3 Hot path (allocation discipline)
On the per-frame paths (`offer`, sender scan and send, receiver `onDataPacket` → `TermRebuilder.insert`, image
`poll`, SM and NAK handling) the port allocates nothing per message. Buffers, flyweights, receive-ring slots and
send scratch are preallocated, and no closure is created per frame. The one unavoidable allocation is the `Buffer`
that Node's `dgram` creates for each received datagram. It is copied into the ring slot straight away and dropped.
This is recorded as deviation D1 (§6).

### 5.4 TypeScript paradigm, Java logic
The code is the Java code expressed in TypeScript, not a redesign. The same classes, fields, branches, loops and
early returns appear in the same order. TypeScript idioms are used only where Java has no direct equivalent:
`class` + `readonly` fields for `final`, `enum`-like `const` objects for Java enums with the same ordinal order,
`implements` for Java interfaces, `throw new AeronException(...)` with the same exception class names and
messages, closures for lambdas and method references. A reader with the Java file open beside the TypeScript file
should be able to follow both line by line.

Tests follow the same rule: each JUnit test becomes a vitest `it` with the same name, the same arrange / act /
assert steps and the same expected values. `@BeforeEach` / `@AfterEach` become `beforeEach` / `afterEach`;
`@ParameterizedTest` sources become `it.each` tables with the same rows; Mockito mocks become `vi.fn()` / hand fakes
and `verify(...)` becomes the matching `expect(...).toHaveBeenCalledWith(...)` / call-count check, in the same order.

## 6. Deviations from Aeron (closed list)
Any deviation outside this list is a bug in the port.

| # | Deviation | Reason |
|---|---|---|
| D1 | Receive is event-driven into a preallocated ring, then polled (§4.2); one `Buffer` allocation per datagram by `dgram`. | Node has no synchronous `recvfrom`. |
| D2 | `sendto` never partially sends or returns `EAGAIN`; an outstanding-send counter replaces the short-send path. | `dgram.send` is asynchronous. |
| D3 | `INVOKER` threading only; `DEDICATED` / `SHARED` / `SHARED_NETWORK` are not offered. | One JS thread. (Worker threads may be added later.) |
| D4 | Log buffers and counters live in memory; no CnC or `.logbuffer` files. | No external driver process. |
| D5 | Positions are capped at 2^53 − 1 instead of Aeron's term-count limit. | JS `number`; `bigint` on the hot path is too slow. |
| D6 | Socket options Node cannot set (`SO_TIMESTAMP`, `IP_MULTICAST_IF` by index on some platforms, `IP_PMTUDISC`) are ignored with a counter. | Not exposed by `dgram`. |

## 7. Code layout and tooling
```
aeron-transport-ts/
  src/agrona/...            Agrona subset (§5.1)
  src/client/protocol/...   io.aeron.protocol
  src/client/logbuffer/...  io.aeron.logbuffer
  src/client/*.ts           io.aeron (ChannelUri, Publication, Image, Subscription, ...)
  src/driver/...            io.aeron.driver (+ media/, status/, ext/, buffer/)
  test/<same paths>/<Name>.test.ts      one-to-one with Aeron's *Test.java
  test/interop/...          against the real Aeron C driver (§8.3)
  test/system/...           real-UDP TS ↔ TS end-to-end
  bench/...                 latency and throughput benches
  docs/specs, docs/plans, docs/mapping.md
```
- TypeScript 5.x with `strict` and `noUncheckedIndexedAccess`; ESM; Node ≥ 22; no runtime dependencies.
- Test runner: **vitest**. `describe` matches the Java class, `it` / `it.each` matches each `@Test` /
  `@ParameterizedTest`, and Mockito becomes `vi.fn()` / hand-written fakes with the same verifications.
- Lint and format: eslint + prettier. CI runs typecheck, lint and unit tests, then interop against the C driver
  built at the pinned tag (cached).

## 8. Testing

### 8.1 Test-first, one-to-one
- For every ported class, the test file is ported **first** from Aeron's `*Test.java`, with the same test names
  (`shouldNakMissingData` stays `shouldNakMissingData`), the same setup, actions, expected values and Mockito
  verifications. It is run red, then the class is ported until it is green.
- `docs/mapping.md` lists each source file → TS file and each test file → TS test file, with a count of test
  methods on both sides. CI checks the counts (a script parses `@Test` / `@ParameterizedTest` in the pinned Java
  sources and `it(` in the TS tests) so a test cannot be dropped silently.
- A Java test that cannot apply (for example one that asserts on a memory-mapped file) is kept as `it.skip` with
  the reason, and listed in `docs/mapping.md`. Each skip is reviewed.

### 8.2 Tests Aeron does not have, added for the port
- **Wire golden vectors:** frames captured from the real C driver for every frame type (DATA, PAD, SETUP, SM with
  and without the setup/EOS flags, receiver tag, NAK, RTTM request and reply, ERR, heartbeat, EOS). Each is decoded
  with the TS flyweights, and re-encoding it must reproduce the same bytes.
- **Deterministic network simulation:** an in-memory `UdpChannelTransport` fake with a seeded loss / reorder /
  duplicate / delay model, driven by an advanced `CachedNanoClock`. Every drive loop has an iteration cap and fails
  instead of hanging. These tests check that produced = consumed for every channel type under faults.

### 8.3 Interop with real Aeron (the acceptance gate)
A harness runs the Aeron C 1.53.3 `aeronmd` and the C samples (`basic_publisher`, `basic_subscriber`,
`streaming_publisher`, `rate_subscriber`, `basic_mds_subscriber`) against the TS transport on loopback:

| TS side | Aeron side | Channel |
|---|---|---|
| publication | subscriber | unicast; MDC dynamic; MDC manual; multicast |
| subscription | publisher | unicast; MDC dynamic (TS sends SMs to the control endpoint); multicast; MDS |
| both directions | with C-driver loss (`AERON_UDP_CHANNEL_INCOMING/OUTGOING_INTERCEPTORS` loss) | unicast + MDC |
| publication | subscriber that leaves and rejoins | unicast + MDC: EOS, image re-creation, connection timeout |
| fragmentation | either | messages of 1 B, MTU − 32, MTU − 31, 2 × MTU, term length / 8 (max message) |
| term rotation | either | ≥ 4 × term length streamed, with a non-zero `init-term-id` and a wrapping `term-id` |

Every case asserts that what was produced equals what was consumed, in order, with no loss and no duplicates.

### 8.4 Interaction matrix
Operations × entities × timings that the system and interop tests must cover:
- **Operations:** add/remove publication, add/remove subscription, offer (unfragmented, fragmented, max size),
  close, re-add with the same stream.
- **Entities:** same channel and stream on two publications (shared vs exclusive), two subscriptions on one channel,
  two images (two sessions) on one subscription, MDC destination add/remove, MDS destination add/remove.
- **Timings:** subscriber first vs publisher first; publication closed mid-fragmented-message; subscriber gone
  (connection timeout → `NOT_CONNECTED`); receiver restarts in the middle of a term; NAK in flight when the
  publication closes; SM lost while the window is full (heartbeat path); term rotation during a retransmit;
  `init-term-id` near `Integer.MAX_VALUE`.

## 9. Delivery: phases
Each phase gets its own plan (`docs/plans/`) of small, test-first tasks. Every task names the Java file(s) and test
file(s) it ports.

1. **Foundation (pure code, no sockets):** Agrona subset; `io.aeron.protocol`; `io.aeron.logbuffer`;
   `ChannelUri`, `ChannelUriStringBuilder`, `BufferBuilder`, `FragmentAssembler` family, `ErrorCode`, `Header`.
   Exit: every mapped test green, golden frame vectors green.
2. **Unicast transport:** `Configuration`, `MediaDriver.Context`, `UdpChannel`, `SocketAddressParser`,
   `NetworkUtil`, transports and pollers, `Send`/`ReceiveChannelEndpoint`, `DataPacketDispatcher`,
   `NetworkPublication`, `PublicationImage`, `LossDetector`, `RetransmitHandler`, delay generators,
   `StaticWindowCongestionControl`, `UnicastFlowControl`, `Sender`, `Receiver`, the network part of
   `DriverConductor`, the `Aeron` facade, `Publication`, `ExclusivePublication`, `ConcurrentPublication`, `Image`,
   `Subscription`. Exit: mapped tests green; TS ↔ TS and TS ↔ C unicast interop green, including under loss.
3. **Multi-destination and multicast:** min/max/tagged/preferred multicast flow control, `ReceiverLivenessTracker`,
   MDC dynamic and manual (both sides), MDS (`MultiRcvDestination`, `ReceiveDestinationTransport`), multicast,
   `ext/` loss generators and debug endpoints. Exit: the full §8.3 interop matrix green, plus benches with
   recorded baselines.

## 10. Licensing
Aeron and Agrona are Apache-2.0. The port is a derivative work, so the repo is **Apache-2.0**: a `LICENSE` file and a
`NOTICE` that credits Real Logic / Adaptive Financial Consulting. Each ported file keeps the original copyright
line and adds "Modified/ported to TypeScript".

## 11. Decisions (confirmed by the owner, 2026-10-21)
1. **Java 1.53.3 is the one-to-one source** for code and tests; C 1.53.3 is the interop peer (§2).
2. **Scope cuts in §3 stand.** UDP only: no IPC, no spy, no response channels, no name-resolver gossip in v1.
3. **vitest**, Node ≥ 22, ESM only.
4. **Apache-2.0** for the repo.
5. **The initial commit (README, LICENSE, NOTICE, this spec) goes straight to `main`.** After that, work happens on
   branches through pull requests.

## 12. Review focus
- Is anything on the wire, or any protocol timing, different from Aeron's? Check against the C driver, not by
  reading the code.
- Is the mapping really one-to-one? Is every rename and deviation listed, and do the test counts match?
- Does the hot path allocate (`--trace-gc` plus an allocation-sampling bench)?
- Does any test wait on wall time or run an uncapped loop?
