# Phase 3 plan — multicast, MDC and MDS

**Spec:** [2026-10-21-aeron-transport-ts-design.md](../specs/2026-10-21-aeron-transport-ts-design.md) (§9, phase 3;
deviations D115 to D117 are new with this plan).
**Pinned sources:** Aeron Java `1.53.3`, Agrona `2.6.1`, Aeron C `1.53.3` (interop peer).
**Builds on:** phase 2 (`feature/phase-2-unicast`, PR #9). This branch starts from its tip and merges `main` in once
phase 2 is merged.
**Exit:** every test mapped in this plan is green or a reviewed `it.skip`; the mapping check passes; the full §8.3
interop matrix is green (every multicast, MDC and MDS row, no loss, no duplicates, including under C-driver loss);
the new per-message paths allocate nothing in the port's own code; benches for the new channel types have recorded
baselines and `bench:gate` passes against `main`.
**After this:** phase 4 (Aeron's `SHARED` mode in one `worker_thread`) is the last phase. It gets its own plan, and
its exit gate runs this phase's suites in both modes.

## What phase 2 already left in place

Ported in phase 2, with their behaviour not yet tested end to end (`docs/mapping.md`, "phase 3"):

- `SendChannelEndpoint` with `MultiSndDestination`, `ManualSndMultiDestination`, `DynamicSndMultiDestination` and
  `Destination`; `ReceiveChannelEndpoint` with `MultiRcvDestination` and `ReceiveDestinationTransport`.
- The client destination calls (`addDestination`, `removeDestination`, `addRcvDestination`, the `async*` forms) and
  the conductor handlers (`onAddSendDestination`, `onAddRcvDestination`, `onAddRcvNetworkDestination`,
  `isMulticastSemantics`).
- Multicast sockets in `UdpChannelTransport` (`addMembership`, the multicast interface and TTL),
  `OptimalMulticastDelayGenerator`, `ReceiverLivenessTracker` (D59), `MaxMulticastFlowControl` and the max-only
  `DefaultMulticastFlowControlSupplier` (D59).

Phase 3 therefore adds four flow-control strategies and their suppliers, then proves the multi-destination and
multicast paths on real sockets, against the C driver and in benches.

## Decisions taken with this plan (2026-10-26)

1. **The Aeron system tests are ported, not rewritten (D115).** Phase 2 wrote its own system tests because the
   unicast ones lean on features out of scope (IPC, archive, counters). The phase 3 suites are about exactly this
   phase's scope, so `MultiDestinationCastTest`, `MultiDestinationSubscriptionTest`, `MdsAndMdcInteractionTest`,
   `MinFlowControlSystemTest`, `TaggedFlowControlSystemTest`, `MaxFlowControlStrategySystemTest`,
   `MultipleMulticastsSubscriptionsTest`, `MultiDriverTest`, `ChannelEndpointStatusTest` and the unicast and
   multicast rows of `PubAndSubTest` are ported one to one into `test/system/`, under the usual rules: same names,
   same order, same values. The adaptations, recorded once in `docs/mapping.md`:
   - `TestMediaDriver.launch` → an embedded `INVOKER` `MediaDriver` (D3).
   - `Tests.await*` and `while (...) Tests.yield()` → `await drainUntil(cond, maxTurns)`, which yields to the
     event loop and fails rather than hangs.
   - `@Timeout` → the vitest timeout.
   - `TestMediaDriver.isCDriver` branches → the Java branch.
   - IPC, spy (where IPC is the point), archive and counters-API rows → `it.skip` with the reason.
   - Mockito `ErrorHandler` mocks → `vi.fn()`.
2. **Multicast runs on the loopback interface.** Tests use Aeron's own groups (`224.20.30.39` and its siblings) with
   `interface=localhost`. A probe in this container showed loopback multicast works with no route set
   (`setMulticastInterface('127.0.0.1')`, loopback on). T5 adds a CI step that runs the same probe first and fails
   with a clear message if the runner cannot do it, so a red multicast test is never just a missing route.
3. **The interop C programs grow, rather than switching to the C samples (D116).** `interop_publisher` and
   `interop_subscriber` (D106) gain `-D <destination>` (repeatable). The publisher uses it for manual MDC
   (`aeron_publication_async_add_destination`) and the subscriber for MDS
   (`aeron_subscription_async_add_destination`). The multicast and dynamic MDC rows need only a channel string, so
   the programs keep their produced = consumed summary for every row.
4. **The deterministic network simulation learns multicast (D117).** The netsim `UdpChannelTransport` fake (§8.2)
   delivers a datagram sent to a group address to every member socket, with its own seeded
   loss / reorder / duplicate / delay draw for each receiver. MDC under loss, multicast under loss and min / tagged
   flow control with a slow receiver are then checked deterministically (produced = consumed) before they meet a
   real socket.
5. **The Configuration members held back in phase 2 are ported** (`docs/mapping.md`, line 897):
   - `unicastFlowControlSupplier`, `multicastFlowControlSupplier` and `flowControlGroupTag` in `Configuration` and
     `MediaDriver.Context`, with Java's property names and defaults.
   - The supplier is chosen by class name string as Java does, from a static registry of the ported suppliers
     (no reflection), recorded in `docs/mapping.md`.

## How every task is done (applies to all tasks)

Phase 2's rules stand unchanged: test first and red, port the class, green with typecheck, lint, format and the
mapping check, update `docs/mapping.md`, one commit per task (`phase3(T<n>): <what>`). That includes:

- Mockito → hand fakes and `vi.fn()`, with `verify` counts and order kept.
- `drainUntil` with a turn cap, and no test that waits on wall time.
- `expectNoAllocation` tests for every per-message method a task ports.
- Micro benches for every per-message path, with baselines in `bench/README.md`.
- `bench:gate` on an idle machine for every task that touches a per-message path.

Agents and reviews:

- **Implementers:** one Sonnet implementer per task, never more than one task in flight on the same files.
- **Reviews:** ONE Opus reviewer per stage, never several at once.
  - Stage A and Stage B each get one combined review of all their tasks.
  - Stage C's review is the T15 whole-branch review.
  - One fix round follows each review. Urgent items (a hang, loss, a wrong frame on the wire, an allocation on the
    message path) are fixed in that round; the rest become labelled issues.

Paths below are relative to `aeron-driver/src/{main,test}/java/io/aeron/driver/` (Aeron driver) and
`aeron-system-tests/src/test/java/io/aeron/` (Aeron system tests).

## Tasks

### Stage A — multicast flow control (unit level)

#### T1 — Min multicast flow control
- Port `AbstractMinMulticastFlowControl`, `MinMulticastFlowControl` and `MinMulticastFlowControlSupplier`.
- Tests: `MinMulticastFlowControlTest` (5).
- Notes:
  - The receiver list is Java's array of `Receiver` objects, grown on the control plane (a new receiver id) and
    reused on every status message; it is never rebuilt per message.
  - Receiver ids are `(high, low)` halves (D14).
- Allocation tests: `onStatusMessage` from a known receiver, `onIdle` with 1, 8 and 64 receivers.

#### T2 — Tagged multicast flow control and the group tag
- Port `TaggedMulticastFlowControl` and `TaggedMulticastFlowControlSupplier`.
- Add `flowControlGroupTag` to `Configuration` and `MediaDriver.Context` (decision 5), and the `gtag` and `g:` FC
  URI parameters as Java parses them in `AbstractMinMulticastFlowControl`.
- Tests: `TaggedMulticastFlowControlTest` (7).
- Allocation tests: as T1, with a tagged receiver, an untagged one and a wrong tag.

#### T3 — Preferred and max suppliers, the full default supplier, supplier selection
- Port `PreferredMulticastFlowControl`, `PreferredMulticastFlowControlSupplier` and
  `MaxMulticastFlowControlSupplier`.
- Complete `DefaultMulticastFlowControlSupplier` (min, max, tagged; D59's max-only cut ends).
- Port the `Configuration` / `Context` supplier members (decision 5).
- Tests:
  - `DefaultMulticastFlowControlSupplierTest` (4).
  - The three `FlowControlTest` rows skipped in phase 2, parameterised over max, min and tagged.
  - Remove the D59 "pulled forward" notes from `docs/mapping.md` and spec D59.

#### T4 — Flow-control micro benches
- `bench/micro/`:
  - `onStatusMessage` and `onIdle` for max, min and tagged, with 1, 8 and 64 receivers.
  - The sender's `processTimeouts` with an MDC publication of 1, 4 and 16 destinations.
- Baselines go in `bench/README.md`. `bench:gate` against the phase 2 tip.

**Review A** (one Opus): T1–T4 against the Java sources. Check line-by-line fidelity, the receiver timeout and
position arithmetic, the tag parsing, the allocation tests and the bench numbers.

### Stage B — system tests, TS ↔ TS (D115)

#### T5 — System-test support and multicast in netsim
- `test/support/SystemTests.ts`: the parts of Aeron's `Tests`, `SystemTests` and `TestMediaDriver` the ported
  suites call:
  - `awaitConnected`, `awaitAvailable`, `awaitPosition`, `awaitCounterDelta` over `drainUntil`;
  - drivers launched with a per-test directory name;
  - teardown that closes clients before drivers.
- netsim multicast groups (D117), with their own unit tests. A send to a group reaches every member. Each member
  draws its loss from its own seed, and the same seed gives the same delivery trace.
- The CI multicast probe (decision 2).

#### T6 — Multicast basics
- Tests: `MultipleMulticastsSubscriptionsTest` (4), `MaxFlowControlStrategySystemTest` (2), `MultiDriverTest` (3).
- Fix in the driver whatever they show is missing, test first, at the fastest layer that reproduces it.

#### T7 — `PubAndSubTest`
- `PubAndSubTest` (30), with Java's channel parameters minus IPC: unicast, multicast, and unicast and multicast with
  `session-id` / `term-length` overrides, as the Java `@MethodSource` lists them.
- IPC rows are `it.skip` (out of scope).

#### T8 — Min and tagged flow control end to end
- Tests: `MinFlowControlSystemTest` (5), `TaggedFlowControlSystemTest` (5), `ChannelEndpointStatusTest` (the system
  test phase 2 left for later, mapping line 920).

#### T9 — MDC
- Tests: `MultiDestinationCastTest` (14), covering:
  - dynamic MDC (control endpoint, `control-mode=dynamic`);
  - manual MDC (`control-mode=manual`, `addDestination` / `removeDestination`);
  - destinations added and removed while publishing;
  - a late joiner catching up.

#### T10 — MDS and the MDS + MDC interaction
- Tests: `MultiDestinationSubscriptionTest` (25), `MdsAndMdcInteractionTest` (2), covering:
  - `control-mode=manual` subscriptions;
  - `addDestination` / `removeDestination` on a subscription;
  - unicast and multicast destinations mixed;
  - merged streams from two destinations, with no duplicate fragments.

#### T11 — Loss properties for the new channel types
- Extend `test/system/UnicastLossPropertiesTest` into `MultiDestinationLossPropertiesTest`: seeded netsim runs
  (D117) where produced = consumed, in order, with no duplicates, for:
  - multicast with 3 receivers, each with its own loss;
  - dynamic and manual MDC with 3 destinations;
  - MDS with 2 destinations carrying the same stream;
  - min flow control with one slow receiver that times out and is dropped;
  - tagged flow control where the tagged group gates and an untagged receiver does not.
- Each runs 200 seeds within the suite budget. A failing seed is printed and kept as a named regression case.

**Review B** (one Opus): T5–T11. Check:
- that every Java test is there or skipped with a reason;
- that no wait is uncapped and no assertion is weakened;
- the driver fixes T6–T10 made;
- the netsim group model against real multicast delivery.

### Stage C — interop, benches, checkpoint

#### T12 — C programs and rig for destinations
- `interop_publisher` and `interop_subscriber` take `-D <destination>` (D116), repeatable.
- `InteropRig` gains:
  - multicast channel helpers;
  - a second C subscriber process, so MDC and multicast have two receivers;
  - a per-destination `LossyRelay` for MDC.
- `build-c.mjs` is unchanged (the C client API already has the calls).

#### T13 — The remaining §8.3 rows (D108)
Every row asserts produced = consumed, in order, with no loss and no duplicates.

| TS side | Peer | Channel / case |
|---|---|---|
| publication | two C subscribers | MDC dynamic; MDC manual; multicast |
| subscription | C publisher | MDC dynamic (TS sends SMs to the control endpoint); multicast; MDS with two destinations |
| both directions | C driver with loss interceptors (D107) | MDC |
| publication | C subscriber that leaves and rejoins | MDC: EOS, image re-creation, connection timeout |
| either | C peer | fragmentation sizes and term rotation (≥ 4 × term length, non-zero `init-term-id`) on MDC and multicast |

#### T14 — Benches and baselines
- `bench/e2e/`:
  - multicast loopback with 1 and 3 subscriptions;
  - MDC with 2 and 4 destinations;
  - MDS with 2 destinations;
  - each measured offer → poll at p50 / p99 / p99.9 (≥ 5 runs interleaved) and as throughput (≥ 3 runs);
  - allocation per message as D112 measures it.
- Baselines in `bench/README.md`. The benches join `bench:gate`, and the non-gating CI bench job reports them.

#### T15 — Phase checkpoint
- Run the full suite, typecheck, lint, format, mapping check, interop and `bench:gate` against `main`.
- One whole-branch review (one Opus) against the Java sources and the C driver.
- One fix round for urgent items; the rest become issues.
- Write the checkpoint doc `docs/plans/2026-10-26-phase-3-checkpoint.md`.

## Interaction matrix

| Area | Operations | Entities / values | Orderings / timings |
|---|---|---|---|
| Multicast FC (T1–T3, T8) | SM from a new / known receiver, `onIdle` timeout, `onSetup`, tag parse | 0, 1, 8, 64 receivers; tagged / untagged / wrong tag; `min-receivers` (`g:/N`) 0, 1, N, N + 1; receiver timeout at the boundary | receiver joins while the window is full; the slowest receiver times out mid-stream; all receivers time out; SM after its receiver timed out |
| MDC (T9, T11, T13) | dynamic join by SM, manual `addDestination` / `removeDestination`, offer, close | 1, 2, 4, 16 destinations; same destination added twice; removing an unknown destination | add before the first offer and mid-stream; remove during a retransmit; destination silent (timeout); publication closed with destinations live; C subscriber rejoins |
| MDS (T10, T11, T13) | `addDestination` / `removeDestination` on a subscription, poll | unicast + multicast destinations; same stream on both; 2 sessions | destination added after the image exists; removed mid-fragmented-message; both destinations lossy at different points |
| Multicast (T6, T7, T11, T13) | subscribe, publish, NAK, retransmit, SETUP / SM | 1 and 3 subscriptions on one group; two groups on one interface; two subscriptions on one channel (§8.4) | subscriber first / publisher first; NAK storms damped by `OptimalMulticastDelayGenerator`; subscriber leaves and rejoins |
| Interop (T13) | as §8.3 | the TS and C drivers on one loopback | C loss interceptor on either side; rotation with a non-zero `init-term-id` |

## Review focus

- **Line-by-line fidelity:** each flow-control strategy matches its Java file: member order, branches, constants,
  timeouts and position arithmetic. Every skip and adaptation of the ported system tests is in `docs/mapping.md`.
- **Protocol on the wire:** multicast SETUP / SM / NAK and MDC destination handling checked against the C driver
  (T13), not by reading the code.
- **Allocation:** `onStatusMessage`, `onIdle` and the MDC send loop allocate nothing per message; the receiver and
  destination arrays grow only on the control plane.
- **Latency:** `bench:gate` passed for every task touching a per-message path and against `main` at T15, with the
  ratios in the review report.
- **Tests:** nothing waits on wall time or runs an uncapped loop; no assertion weakened; the netsim group model is
  validated against a real multicast socket test.
