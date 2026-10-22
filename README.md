# aeron-transport-ts

A TypeScript port of the [Aeron](https://github.com/aeron-io/aeron) UDP transport for Node.js.

A Node process can publish to and subscribe from any Aeron peer over UDP (a real Aeron media driver, or a service
that embeds one) without a separate media driver process, shared memory or native add-ons.

- **Wire-compatible** with Aeron 1.53.3: the same frames and the same protocol rules (setup, status messages, NAKs,
  retransmit, flow control, heartbeats, end of stream, RTT measurement).
- **One-to-one port** of the Aeron Java code: each in-scope Java file maps to one TypeScript file with the same
  names and control flow, and each Aeron JUnit test maps to a vitest test with the same name.
- **UDP only:** unicast, multicast, multi-destination-cast (MDC) and multi-destination subscriptions (MDS). No IPC.

**Status:** design approved; implementation in progress. See the
[design spec](docs/specs/2026-10-21-aeron-transport-ts-design.md).

## Golden wire vectors

`test/golden/frames.json` holds datagrams captured from the real Aeron 1.53.3 C driver; `npm test` checks the
flyweights against it and needs no C driver. To regenerate it:

1. Fetch the Aeron sources (`npm run fetch:refs` puts them in `.refs/aeron`) and build the C driver and samples out of
   tree (about 20 s with Ninja):

   ```sh
   cmake -G Ninja -S .refs/aeron -B "$AERON_C_BUILD" -DCMAKE_BUILD_TYPE=Release \
     -DAERON_TESTS=OFF -DAERON_UNIT_TESTS=OFF -DAERON_SYSTEM_TESTS=OFF -DAERON_BUILD_DOCUMENTATION=OFF \
     -DAERON_INSTALL_TARGETS=OFF -DBUILD_AERON_ARCHIVE_API=OFF -DAERON_BUILD_SAMPLES=ON
   ninja -C "$AERON_C_BUILD" aeronmd basic_publisher basic_subscriber streaming_publisher
   ```

2. Run the capture (about 45 s; it starts and stops its own drivers on 127.0.0.1, ports from 41100):

   ```sh
   AERON_C_BUILD=/path/to/build node scripts/capture-golden.mjs
   ```

   Options: `--out`, `--build`, `--work` (scratch directory, default `<tmp>/aeron-golden-work`), `--base-port`,
   `--only <scenario>`; the same as the environment variables `GOLDEN_OUT`, `AERON_C_BUILD`, `GOLDEN_WORK_DIR` and
   `GOLDEN_BASE_PORT`. Receiver ids and RTT timestamps differ from run to run, so a re-run changes `frames.json`; the
   test only needs it to be self-consistent.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
