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

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
