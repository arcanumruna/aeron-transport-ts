# Phase 2 checkpoint — 2026-10-22

Where the Phase 2 (unicast) work stands, so a new session can pick it up.
Plan: [2026-10-22-phase-2-unicast.md](2026-10-22-phase-2-unicast.md). Draft PR: #9 (`feature/phase-2-unicast`).

## Workflow (unchanged)

One implementer per task with an exact recipe, then a review (spec compliance + code quality), then one fix round.
At most 3 agents at once. Test-first port; no silently weakened tests. Non-urgent findings go to GitHub issues.
Owner rule: 64-bit values keep Aeron's exact layout and true 64-bit semantics (no layout changes).

## Merged into `feature/phase-2-unicast`

| Task | What | State |
|---|---|---|
| T1 | Position cap on a term boundary; iterator and allocation tests | merged |
| T2 | Two-slot sequence lock, byte volatiles | merged |
| T5 | Epoch-nanos halves (D17), hash sets, error log | merged |
| T8 | `jdkNet` stand-ins (D20): `InetAddress`, `InetSocketAddress`, `NetworkInterface` | merged (4180569) |
| T9 | `UdpChannel`, `ControlMode`, `InvalidChannelException` | merged (e43d6d2) |
| — | Flaky allocation-test fix (consumer closure hoisted out of the measured loop) | merged (b59d4d9) |

Run all checks after every merge:
`npm run typecheck && npm run lint && npm run format:check && npm run check:mapping && npx vitest run`

## In flight (not merged): saved on `wip/*` branches

The WIP snapshots were taken while the agents were still working. Treat them as unreviewed.

| Branch | Task | State | Next step |
|---|---|---|---|
| `wip/t2b-stripes` | T2b: true 64-bit atomics on shared buffers via a 1024-stripe lock table (D16) | Review done; fix round in progress (fast path, spin cap with a test-only setter, kill tests, allocation at 2^40, D16 text, bench) | Finish the fixes, verify, merge **first**, close #10 with the SHA |
| `wip/t3-reviewed` | T3: bench gate (PASS / FAIL / NO_VERDICT, exit codes 0/1/2/3), `releaseFence` (D21), large-position allocation tests | Reviewed and fixed (d72ed58) | Merge after T2b. Resolve where D21 goes (after D20). Check the 20 `SharedNoAllocation` tests turn green, tighten `LARGE_POSITION_HEAP_NUMBERS`, run `bench:gate` on an idle host (exit 3 means a loaded host) |
| `wip/t6-commands` | T6: command flyweights, CnC layout, client status | Review done; fix round in progress (bigint `receiverId`/`groupTag`, §5.2/D5/D20 text, `| 0` wraps, SAB allocation tests, kill tests) | Verify the fixes, then merge |
| `wip/t7a-status` | T7a: driver `status/*`, `DutyCycleTracker`, `ThreadingMode`, `DriverManagedResource`, `SessionKey`, full `AeronCounters`, `DutyCycleStallTrackerTest`; splits the plan into T7a/T7b | Implementation in progress, not yet reviewed | Opus review, fix round, merge. On the `AeronCounters.ts` conflict with T6, keep T7a's full file |

Merge order: T2b → T3 → T6 → T7a.

## Not started (dependency order)

1. **T7b** — `Configuration`, `MediaDriver.Context`, `PublicationParams`, `SubscriptionParams`
   (tests: ConfigurationTest, MediaDriverContextTest, PublicationParamsTest).
2. **T4** — broadcast and `ExpandableArrayBuffer`; then revert the workaround tracked in #20.
3. **T10** — needs T7b; also port `CubicCongestionControl` (`DefaultCongestionControlSupplier` needs it).
4. **T11**, then **T12–T25**. Plan edits already recorded from the T8 review:
   - T12: reuse the last sender address and memoize `getHostAddress`.
   - T18: `NativeResourceAgent` (#12).
   - T19: `dns.lookup` with ipv4first; pre-resolve the hosts in `interface=` and `control=`, and for `addDestination`.

## Key decisions so far (full text in the spec §6)

- **D5:** `long` maps to `number` within ±(2^53−1). Opaque 64-bit wire values (`receiverId`, `groupTag`, the `correlationId` in log metadata) map to `bigint`. Command ids map to `number`.
- **D16:** 64-bit shared-buffer values use striped 64-bit atomics:
  - The writer locks the stripe with `Atomics.or`, stores the high half only if it changed, then stores the low half last.
  - The reader takes 4× `Atomics.load` and retries if the stripe is odd or has changed.
  - Never `terminate()` a worker that may be inside a buffer operation.
- **D17:** Epoch nanos are stored as exact halves.
- **D20:** `jdkNet` stand-ins replace the JDK network classes.
- **D21:** `VarHandle.releaseFence` is a no-op on x64 and `Atomics.add` on a fence word elsewhere.

## Open issues to know about

- #10 — close it when T2b merges.
- #11–#16 — earlier review findings. #15 (licensing) waits on the owner.
- #17–#24 — findings from this segment:

  | Issue | Finding |
  |---|---|
  | #17 | Unicode digits |
  | #18 | `parse(null)` |
  | #19 | Heap numbers at large positions |
  | #20 | `ExpandableArrayBuffer` revert |
  | #21 | 2^53 docs |
  | #22 | Plain `putLong` tearing |
  | #23 | `correlationId` bigint vs number |
  | #24 | `ReadableCounter` cross-worker test |

- Open question for the owner: whether to add a race checker (a TSan-like tool) for the memory-ordering code.
