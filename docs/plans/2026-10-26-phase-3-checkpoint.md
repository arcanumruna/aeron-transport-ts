# Phase 3 checkpoint — 2026-10-26

Where the Phase 3 (multicast and MDC) work stands, so a new session can pick it up.
Plan: [2026-10-26-phase-3-multicast-mdc.md](2026-10-26-phase-3-multicast-mdc.md). Branch: `feature/phase-3-multicast-mdc`.

## Status: Phase 3 done (T15)

T1–T14 are on `feature/phase-3-multicast-mdc`. The phase was checked as follows (numbers from the final run after
merging `main`; see the end of this file for the run):
- **Checks:** typecheck, lint, format and the mapping check are green.
- **Suite:** vitest 8501 passed, 137 skipped in the final run (ImageAllocationTest passed). The failure seen in the earlier run was `test/extra/client/ImageAllocationTest.test.ts`
  `fragmentedMessageThroughTheAssemblerAllocatesNothingLargePosition` (minor collections 2 > 1 under full-suite load).
  That run had 8494 passed and 1 failed. It passes alone, and neither the file nor the `Image` code differs from `main`. It is the pre-existing flake #46.
- **Interop:** 91 of 91 against C Aeron (5 files).
- **Multicast probe:** `probe:multicast` ok.
- **Bench gate vs `origin/main`:** two full `bench:gate` runs FAILed on differing sets of benches whose code is unchanged
  (run 1: 16 benches; run 2: 13, among them CubicCongestionControl, DataTransportPoller, SendChannelEndpoint
  timestamp, LossDetector, RetransmitHandler x4, ConcurrentPublication, Image controlledPoll, OneToOneRingBuffer,
  NetworkPublication resend and TermReader). No phase-3 change in `src/` reaches them: the `UdpChannelTransport`
  change is the bind host only, and the gate runs each file in its own process with the candidate's bench code on both
  sides. An isolated rerun of SendChannelEndpoint with 7 pairs passed (ratios 0.949, 1.023, 1.033). Verdict: host
  noise, tracked by #54 and #29.
- **Review:** one whole-branch review, no blocking findings.

## Fix round

- Merged `main` into the branch (a merge commit).
- Capped every bench drive loop (urgent: a hang). A loop that turned the event loop until a subscriber had read a
  message waited for ever if the subscriber had lost its image or a datagram was dropped, so the bench and the CI bench
  job would have hung. `bench/lib/turnCap.ts` holds `TurnCap` and `MAX_TURNS` = 1,000,000 turns; the loops in
  `bench/lib/e2e.ts` (`roundTrips`, `oneWay`, the first-message-after-idle wait) and `bench/lib/fanout.ts`
  (`fanoutLatency`, `fanoutStream`) count their turns and throw an `Error` naming the scenario and the progress
  (received/target). The raw `dgram` waits of `DgramPair` fail after the 20 s wait cap. The other `while` loops under
  `bench/` already have a bound (the offer retries, the warm-up, the ring buffer workers) or are the throwaway
  experiments in `bench/latency/`. The slowest healthy loop in `npm run bench:e2e` took 3,132 turns, so the cap is
  about 300 times what a healthy run needs. Regression test:
  `test/extra/bench/BenchDriveLoopCapRegression.test.ts` (a gone subscriber; red = four timeouts at 10 s, green = 6
  passed).
- Fixed the stale comment in `UdpChannelTransport` that said the socket binds to the group only "on a host with the
  option on": it now says what the code does (unconditional, except Windows and an IPv6 link-local group without an
  interface).

## Filed as issues

- #61: IPv6 link-local group without an interface binds the wildcard address (D119 gap).
- #62: `CloseHelper` D120, the duck-typed error handler is a footgun.
- #63: the MDS fan-out bench does not exercise one session over two paths.
- #64: the CI multicast probe is IPv4 only, so the IPv6 rows can skip silently.

Comments added on #14, #29, #46 and #54.
