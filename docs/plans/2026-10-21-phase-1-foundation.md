# Phase 1 plan — foundation (pure code, no sockets)

**Spec:** [2026-10-21-aeron-transport-ts-design.md](../specs/2026-10-21-aeron-transport-ts-design.md) (§9, phase 1)
**Pinned sources:** Aeron Java `1.53.3`, Agrona `2.6.1`.
**Exit:** every test mapped in this plan is green or a reviewed `it.skip`; the mapping check passes; the golden wire
vectors decode and re-encode byte-for-byte.

## How every task is done (applies to all tasks)

1. **Port the test file first.** Open the Java `*Test.java` and write `test/<path>/<Name>.test.ts`:
   - one `describe('<JavaClassName>')`;
   - one `it('<javaMethodName>', ...)` per `@Test`, in the same order, with the same arrange / act / assert steps
     and the same literal values;
   - one `it.each(rows)('<javaMethodName> %s', ...)` per `@ParameterizedTest`, with the same rows as its
     `@ValueSource` / `@CsvSource` / `@MethodSource`;
   - `@BeforeEach` / `@AfterEach` → `beforeEach` / `afterEach`; Mockito `mock` → `vi.fn()` or a hand fake;
     `verify(x).m(a)` → `expect(x.m).toHaveBeenCalledWith(a)`; `InOrder` → assert on `mock.calls` order;
     `verifyNoMoreInteractions` → exact call-count checks; `assertThrows(E.class, ...)` →
     `expect(() => ...).toThrow(E)`.
   - A test that cannot apply becomes `it.skip('<javaMethodName>', ...)` with a one-line reason comment, and is
     listed in `docs/mapping.md` under "Skipped tests".
2. **Run it red** (`npx vitest run <file>`): it must fail because the class is missing, not because the test is
   wrong.
3. **Port the source file(s)** to `src/<path>/<Name>.ts` by the spec §5 rules: same names, same member order, same
   control flow; the file header names the Java path and pinned version and keeps the original copyright notice.
4. **Run it green**, then `npm run typecheck && npm run lint && npm run check:mapping`.
5. **Update `docs/mapping.md`**: source row(s), test row(s) with Java and TS test counts, any rename or skip.
6. **One commit per task**, message `phase1(T<n>): <what>`.

Members of a Java file that only serve out-of-scope features (spec §3) are left out and listed in `docs/mapping.md`
as "not ported" with the reason. Everything else in the file is ported, even if nothing uses it yet.

Paths below are relative to `aeron-client/src/{main,test}/java/io/aeron/` (Aeron) and
`agrona/src/{main,test}/java/org/agrona/` (Agrona).

## Tasks

### T1 — Tooling, mapping check, CI
- `package.json` (`"type": "module"`, `engines.node >= 22`, no runtime deps; dev deps: `typescript`, `vitest`,
  `@types/node`, `eslint`, `typescript-eslint`, `prettier`), scripts `build`, `typecheck`, `lint`, `format`, `test`,
  `check:mapping`.
- `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` off, `module`/`moduleResolution`
  `NodeNext`, `target` `ES2022`, `outDir dist`.
- `vitest.config.ts`, `eslint.config.js`, `.prettierrc`, `.gitignore`, `CLAUDE.md` (the porting rules above, short).
- `scripts/check-test-mapping.mjs`: for each row of the test table in `docs/mapping.md`, read the Java test file
  from the pinned checkouts (`AERON_SRC`, `AGRONA_SRC` env vars), collect the method names annotated `@Test` /
  `@ParameterizedTest` (including those inherited from an abstract base listed in the row), collect the `it` /
  `it.each` / `it.skip` titles from the TS file, and fail on any Java name with no TS test of that name (or prefix,
  for `it.each`) and on any TS test with no Java name. Abstract bases (`MutableDirectBufferTests`) are ported as a
  shared function `mutableDirectBufferTests(factory)` and counted once per subclass that calls it.
- `scripts/fetch-refs.sh`: shallow-clones Aeron `1.53.3` and Agrona `2.6.1` into `.refs/` (git-ignored).
- `.github/workflows/ci.yml`: Node 22 and 24; install, fetch refs (cached by tag), typecheck, lint, test,
  check:mapping.
- **Tests:** the mapping script is tested by `test/scripts/checkTestMapping.test.ts` on fixture Java/TS files:
  matching names pass; a missing TS test fails; an extra TS test fails; an `it.each` prefix matches a
  `@ParameterizedTest`; an inherited abstract-base test is required in the subclass's TS file.

### T2 — Agrona: `BitUtil`, `Strings`, `LangUtil`, `AsciiEncoding`, `SystemUtil` (size/duration parse+format), `ErrorHandler`
- Sources: `BitUtil`, `Strings`, `LangUtil`, `AsciiEncoding`, `SystemUtil`, `ErrorHandler`.
- Tests: `BitUtilTest` (7), `LangUtilTest` (1), `AsciiEncodingTest` (24), `SystemUtilTest` (28: the
  OS/process/property tests — `getPid`, `osName`, `tmpDirName`, `threadDump`, ... — are `it.skip`, "no JVM
  equivalent").
- Type notes: `long` parse results (`parseLongAscii`, `parseSize`, `parseDuration`) return `number` and throw
  above 2^53 − 1 (D5); tests asserting `Long.MAX_VALUE` behaviour are adapted to the 2^53 − 1 bound and listed.

### T3 — Agrona buffers: `DirectBuffer`, `MutableDirectBuffer`, `AtomicBuffer`, `AbstractMutableDirectBuffer`, `UnsafeBuffer`, `BufferUtil`
- `UnsafeBuffer` wraps an `ArrayBuffer` (or a `Uint8Array` view, or another `UnsafeBuffer`) at an offset, over a
  `DataView` and a `Uint8Array`, little-endian by default with the `ByteOrder` overloads kept.
- `BufferUtil.allocateDirectAligned(length, alignment)` returns an `ArrayBuffer` (alignment is a no-op, recorded).
- Bounds checks follow Agrona (`SHOULD_BOUNDS_CHECK`, default on) and throw `IndexOutOfBoundsException`
  (ported in `src/agrona/exceptions.ts` with the JDK exception names Agrona throws).
- `*Volatile`, `*Ordered`, `*Release`, `*Acquire`, `*Opaque`, `compareAndSet*`, `getAndAdd*`, `getAndSet*` are
  plain single-threaded operations with the same names and return values.
- Tests: `MutableDirectBufferTests` (33, shared function), `UnsafeBufferTest` (24 + the 33 inherited),
  `AtomicBufferTest` (50; tests that need a `ByteBuffer` / off-heap address are `it.skip`, "no direct memory"),
  `BufferUtilTest` (13).

### T4 — Agrona collections: `Hashing`, `ArrayUtil`, `ArrayListUtil`, `Int2ObjectHashMap`, `Object2ObjectHashMap`, `Long2ObjectHashMap`, `Long2LongHashMap`
- `Long2ObjectHashMap` / `Long2LongHashMap` are generated from the `Int2*` templates in Agrona's build; they are
  ported from the generated shape with `number` keys (D5) and recorded as such.
- Tests: `ArrayUtilTest` (4), `Int2ObjectHashMapTest` (58), `Object2ObjectHashMapTest` (7),
  `Long2LongHashMapTest` (3). Tests of `java.util.Map` view classes that have no TS counterpart (`keySet().
  removeIf`, serialisation) are `it.skip`, each with its reason.

### T5 — Agrona agents, clocks, queues, counters (used from phase 2; pure code)
- Sources: `concurrent/{Agent, AgentInvoker, AgentRunner, CompositeAgent, IdleStrategy, BackoffIdleStrategy,
  SleepingIdleStrategy, NoOpIdleStrategy, YieldingIdleStrategy, NanoClock, EpochClock, CachedNanoClock,
  CachedEpochClock, SystemNanoClock, SystemEpochClock, OneToOneConcurrentArrayQueue}`,
  `concurrent/status/{Position, ReadablePosition, AtomicCounter, CountersReader, CountersManager,
  UnsafeBufferPosition}`, `CloseHelper`.
- `AgentRunner` runs the duty cycle with `setImmediate` (busy) and timers (idle back-off) instead of a thread
  (spec §4, D3); its tests that join a thread drive the runner with an injected scheduler and a capped loop.
- Tests: `AgentInvokerTest` (10), `AgentRunnerTest` (11), `CompositeAgentTest` (4), `CountersManagerTest` (26),
  `AtomicCounterTest` (1), `UnsafeBufferPositionTest` (5).

### T6 — Aeron basics: `AeronException` family, `ErrorCode`, `Aeron` / `CommonContext` constants
- Sources: `exceptions/{AeronException, ConfigurationException, ConductorServiceTimeoutException,
  RegistrationException, TimeoutException}`, `ErrorCode`, and the constants of `Aeron` (`NULL_VALUE`) and
  `CommonContext` (every `*_PARAM_NAME`, `*_VALUE`, `UDP_MEDIA`, `IPC_MEDIA`, `SPY_PREFIX`, ...). `Aeron.ts` and
  `CommonContext.ts` hold only these members now; phase 2 fills in the rest, in Java order.
- Tests: none in Aeron for these; they are covered by the tests of T7–T11.

### T7 — Protocol flyweights, part 1: `HeaderFlyweight`, `DataHeaderFlyweight`, `NakFlyweight`, `StatusMessageFlyweight`
- Tests: `protocol/HeaderFlyweightTest` (2), `protocol/NakFlyweightTest` (5), `protocol/StatusMessageFlyweightTest`
  (4), `FlyweightTest` (6; `shouldEncodeAndDecodeChannelsCorrectly` is `it.skip`, "uses the out-of-scope
  `command/PublicationMessageFlyweight`").
- `receiverId`, `groupTag` and the reserved value are `bigint` (spec §5.2).

### T8 — Protocol flyweights, part 2: `SetupFlyweight`, `RttMeasurementFlyweight`, `ErrorFlyweight`, `ResponseSetupFlyweight`, `ResolutionEntryFlyweight`
- `ResolutionEntryFlyweight` is pure and has its own test, so it is ported now; only its use by the name resolver
  is out of scope (recorded in `docs/mapping.md`).
- Tests: `protocol/SetupFlyweightTest` (7), `protocol/ErrorFlyweightTest` (9),
  `protocol/ResolutionEntryFlyweightTest` (11).

### T9 — Log buffers, part 1: `FrameDescriptor`, `LogBufferDescriptor`, `HeaderWriter`, `Header`, handlers, `BufferClaim`
- Sources: `logbuffer/{FrameDescriptor, LogBufferDescriptor, HeaderWriter, Header, FragmentHandler,
  ControlledFragmentHandler, BlockHandler, RawBlockHandler, BufferClaim}`.
- `ControlledFragmentHandler.Action` keeps its ordinal order (`ABORT`, `BREAK`, `COMMIT`, `CONTINUE`).
- Positions use `number`; `computePosition`, `computeTermIdFromPosition`, `rawTail*` keep Java's int wrapping with
  `| 0` exactly where Java truncates. `rawTail` (term id in the high 32 bits, offset in the low 32) is held as two
  `int` halves of the 64-bit metadata slot, read/written with the same method names.
- Tests: `logbuffer/HeaderTest` (6), `logbuffer/HeaderWriterTest` (2), `logbuffer/LogBufferDescriptorTest` (4).
- Replace the T7 stand-ins: switch `NakFlyweight` and `StatusMessageFlyweight` from their local `FRAME_ALIGNMENT` to
  `FrameDescriptor.isFrameAligned`, and the two ported tests (`NakFlyweightTest`, `StatusMessageFlyweightTest`) from
  their local term length to `LogBufferDescriptor.TERM_MIN_LENGTH`.
- Delete the T12 stand-in `src/client/ChannelUriLogBuffer.ts`: switch the `ChannelUri` and `ChannelUriStringBuilder`
  imports to `FrameDescriptor` / `LogBufferDescriptor`, and remove its row from `docs/mapping.md`.

### T10 — Log buffers, part 2: readers, scanners, rebuild, gap fill, unblock
- Sources: `logbuffer/{TermReader, TermScanner, TermBlockScanner, TermGapScanner, TermRebuilder, TermGapFiller,
  TermUnblocker, LogBufferUnblocker}`.
- Tests: `TermReaderTest` (6), `TermScannerTest` (10), `TermBlockScannerTest` (8), `TermGapScannerTest` (6),
  `TermRebuilderTest` (5), `TermGapFillerTest` (5), `TermUnblockerTest` (12), `LogBufferUnblockerTest` (5).
- `TermReader.read` takes the `ErrorHandler` and `Position` exactly as Java; no per-call closure.

### T11 — `BufferBuilder` and the fragment assemblers
- Sources: `BufferBuilder`, `FragmentAssembler`, `ImageFragmentAssembler`, `ControlledFragmentAssembler`,
  `ImageControlledFragmentAssembler`.
- Tests: `BufferBuilderTest` (22), `FragmentAssemblerTest` (7).

### T12 — `ChannelUri` and `ChannelUriStringBuilder`
- Sources: `ChannelUri`, `ChannelUriStringBuilder` (all parameters, including ones whose feature is out of scope:
  the builder is a pure string tool and Aeron peers may send such URIs).
- Tests: `ChannelUriTest` (26), `ChannelUriStringBuilderTest` (33).

### T13 — Golden wire vectors from the real C driver
- `scripts/capture-golden.mjs`: a UDP relay between two endpoints on loopback that forwards both ways and writes
  every datagram (direction, hex, decoded type) to `test/golden/frames.json`. It runs the C 1.53.3 `aeronmd` with
  `basic_publisher` → relay → `basic_subscriber` and covers: SETUP, SM (plain, with the SEND_SETUP flag), DATA
  (unfragmented; BEGIN/END fragments of a 3-MTU message), PAD at term end, heartbeat (zero-length DATA), EOS
  (heartbeat with the EOS flag), NAK and the retransmitted DATA (the relay drops one chosen data frame), RTTM
  request and reply (from the receiver's RTT measurement). ERR, RSP_SETUP and RES are not emitted in these flows;
  they are covered by their flyweight tests.
- `test/golden/goldenFrames.test.ts`: for each captured datagram, decode it with the TS flyweights, assert the
  field values recorded beside it, re-encode it into a fresh buffer from those fields and assert the bytes are
  identical. Frames in a datagram are walked with `FrameDescriptor` alignment.
- The capture is re-runnable but its output is committed; the test needs no C driver.

### T14 — Phase checkpoint
- Full suite, typecheck, lint, mapping check; `docs/mapping.md` complete for every file above, with every skip and
  rename and its reason. Whole-branch review against the Java sources, then fix round (urgent items only).

## Interaction matrix
Phase 1 is pure code; the ported tests carry most of the matrix. The extra tests below live in
`test/extra/<path>/<Name>ExtraTest.test.ts`, so mapped test files stay one-to-one.

| Area | Operations | Entities / values | Orderings / timings |
|---|---|---|---|
| Flyweights (T7, T8) | encode, decode, re-encode | every frame type; every field at 0, 1, max, `-1`, `INT32_MIN`; flags all set / none; `bigint` fields at 0, 2^63 − 1, −2^63 | — |
| Term rebuild (T10) | `TermRebuilder.insert`, `TermGapScanner.scanForGap`, `TermGapFiller.tryFillGap`, `TermReader.read` | frames of 0 (heartbeat), 1, MTU − 32 bytes; padding at term end; fragmented messages | in order; reversed; seeded random shuffle with duplicates (seeds fixed, 200 cases); gap filled then frame arrives late |
| Unblock (T10) | `TermUnblocker.unblock`, `LogBufferUnblocker.unblock` | blocked at term start, middle, last frame; across a term boundary | before / after the tail moves |
| Assemblers (T11) | `onFragment` | unfragmented; BEGIN, MIDDLE×n, END; two sessions interleaved (image assemblers) | END without BEGIN; BEGIN twice; message larger than initial `BufferBuilder` capacity |
| Channel URIs (T12) | parse → `toString` → parse, builder → string → parse | every parameter name in `CommonContext`; tags; aliases; IPv6 endpoints | — |
| Positions (T9) | `computePosition`, `computeTermIdFromPosition`, `computeTermOffsetFromPosition` | `initialTermId` at 0, `-1`, `INT32_MAX`, `INT32_MIN`; term lengths 64 KiB and 1 GiB; positions near 2^53 − 1 | term id wrap |

## Review focus
- **Line-by-line fidelity:** for each file pair, does the TS follow the Java member order and branches? Any added
  or dropped branch, changed constant or reordered field is a finding.
- **Integer semantics:** every place Java relies on `int` overflow or `long` arithmetic (term ids, offsets, tail
  counters, hash codes) — is the `| 0` / `>>> 0` / `bigint` choice right and tested at the boundary?
- **Test mapping:** names match, assertions match the Java values, skips are justified; no assertion weakened.
- **Allocation:** flyweights, `TermReader`, `TermScanner`, `TermRebuilder` and the assemblers allocate nothing per
  call (no closures, no `subarray`, no temporary arrays).
- **Golden vectors:** bytes come from the C driver, not from our own encoder.
