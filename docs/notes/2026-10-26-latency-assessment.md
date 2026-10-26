# Latency assessment — shelved (2026-10-26)

**Status:** shelved by the owner. This note records what was measured and why, so the work can resume later. It
supersedes the native-transport and busy-spin parts of `docs/plans/2026-10-26-phase-4-5-low-latency.md`.

**Owner constraints:** no busy spinning, no native binaries (one cross-platform pure-JS package).
**Original goal:** round trip p50 ≤ 10 µs, p99 no worse than WebSocket, throughput above WebSocket.

## Verdict

On loopback, pure-Node Aeron rUDP cannot reach p50 ≤ 10 µs or beat `ws` without spinning. The floor is the
event-loop wake, not Aeron logic, and the remaining overhead is spread across many small pieces. rUDP's advantage
over WebSocket is on lossy networks (no TCP head-of-line blocking), not on loopback.

## Floors (quiet 4-core host, cross-process round trip, p50)

| Path | p50 |
|---|---|
| raw Node `dgram` UDP echo | 19–20 µs |
| `ws` (TCP, no deflate) | 19–22 µs |
| this port (Aeron, `dgram`, `setImmediate` duty cycles) | 35–40 µs |

Under load (another agent running on the box) Aeron p50 swings 60–180 µs; only interleaved runs pinned with
`taskset -c 2,3` are comparable.

## Where the Aeron time goes (per side, userland, µs)

| Step | µs |
|---|---|
| `recv` → duty cycle | 1.5 |
| sender `doWork` (idle) | 1.0 |
| receiver `doWork` (`insertPacket`, copy) | 2.2 |
| agent 3 / agent 4 | 0.2 / 0.7 |
| `applicationWakeUp` → poll | 0.7 |
| echo handler | 0.5 |
| `offer` → duty cycle → `send` | 2.2 |

About 18 µs of userland per round trip on top of the raw UDP floor. The largest single JS cost is `doSend` (the
kernel `sendmsg`, ≈ 5 µs). There is no single hot spot.

Traffic check (`bench/latency/cnt.ts`): one data datagram each way per trip; status messages are 36 B, about 197 per
3200 trips. No extra traffic.

## Experiments

| Experiment | Result |
|---|---|
| Inline duty cycle on receive (`wake(maxCycles)`, `ONE=1`) | small gain, kept in the patch |
| Plain `ArrayBuffer` instead of `SharedArrayBuffer` (`PLAIN=1`) | small gain (≈ 1 µs) |
| Park instead of the post-send `setImmediate` (NOIMM) | worse: p50 60 → 80 µs (timer cost); reverted |
| Timer variants on raw UDP (`bench/latency/udpvar.mjs`) | any armed timer/immediate after a receive adds latency |

The experimental `src` changes (with temporary env switches and trace hooks) are in
`bench/latency/experiments.patch`. They are not production code; apply with `git apply` on `3e9da48` to reproduce.

## Native and WASM

- A native addon (N-API, `recv(MSG_DONTWAIT)`, busy-poll worker) measured 4–5 µs p50, but only with a spinning core.
- Prebuilt binaries for every OS/CPU can ship in one npm package (prebuildify + node-gyp-build, N-API is ABI-stable),
  but that needs a build matrix in CI and still ships per-platform binaries.
- WASM cannot open sockets.
- Without spinning, native code gains little: the event-loop wake dominates.

## What is still worth doing (3–5 µs per round trip, pure JS, no spin)

1. Skip the idle sender and conductor work on a receive-triggered wake.
2. Plain `ArrayBuffer`s in the in-process (`INVOKER`) mode.
3. One duty cycle per wake, then a long park with a short-deadline hint.
4. `sendmmsg`-style batching is not available in `dgram`; throughput at 1376 B stays bound by one send per datagram.

## Reproducing

Runner: `node --expose-gc --experimental-transform-types --import ./test/support/workerRegister.mjs --no-warnings <file.ts>`

| Script | What it measures |
|---|---|
| `bench/latency/xrtt.ts` | cross-process Aeron round trip; env `PARK`, `PLAIN`, `ONE`, `RUNS`, `XHOPS` |
| `bench/latency/evrtt.ts` | same-process event-driven round trip |
| `bench/latency/xws.mjs` | cross-process `ws` and raw UDP round trip (`WSDIR=<dir with ws installed>`) |
| `bench/latency/wsbench.mjs` | same-process `ws` round trip and stream throughput (`WSDIR=…`) |
| `bench/latency/udpvar.mjs` | raw UDP with timer variants (`V=plain|timer|imm|…`) |
| `bench/latency/hops.ts`, `xhops.ts`, `cnt.ts` | hop tracing and datagram counting hooks |

These scripts are excluded from typecheck, lint and format; the patch-dependent env switches (`PLAIN`, `ONE`,
`XHOPS`) need `experiments.patch` applied.
