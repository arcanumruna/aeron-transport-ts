// The multicast probe of phase 3 (T5, plan decision 2): a real multicast group on the loopback interface (group
// 224.20.30.39, interface 127.0.0.1, no route set), the way the driver's transports use it (receivers bound to one port
// with `reuseAddr` and joined to the group, a sender with its multicast interface set), and the same scenarios on the
// netsim group model (D117), which must deliver what the real sockets deliver. `scripts/multicast-probe.mjs` runs the first
// half alone in CI before the suite, so that a runner without multicast is told so and a red multicast test is never just
// a missing route.
import dgram from 'node:dgram';
import type { Socket } from 'node:dgram';
import { afterEach, describe, expect, it } from 'vitest';
import { ManualClock } from '../support/EmbeddedRig.js';
import { NO_FAULTS, SimNetwork } from '../support/SimNetwork.js';
import type { SimSocket } from '../support/SimNetwork.js';
import { syncLookup } from '../support/Udp.js';

const GROUP = '224.20.30.39';
const INTERFACE = '127.0.0.1';

/** The part of a socket that the scenario needs, so that one scenario runs on a real socket and a simulated one. */
interface Endpoint {
    bind(port: number): void;
    join(): void;
    leave(): void;
    send(text: string, port: number): void;
    onMessage(listener: (text: string) => void): void;
    port(): number;
    close(): void;
}

interface Medium {
    endpoint(shared: boolean): Endpoint;
    /** The datagrams sent so far have arrived (or never will): real UDP needs turns of the event loop, the simulation the clock. */
    settle(): Promise<void>;
}

const open: Socket[] = [];

afterEach(() => {
    for (const socket of open.splice(0)) {
        try {
            socket.close();
        } catch {
            // closed by the test
        }
    }
});

function realMedium(): Medium {
    return {
        endpoint(shared: boolean): Endpoint {
            const socket = dgram.createSocket({ type: 'udp4', lookup: syncLookup, reuseAddr: shared });
            open.push(socket);
            let listener: (text: string) => void = () => {};
            socket.on('message', (message) => listener(message.toString('latin1')));
            return {
                bind: (port) => socket.bind(port),
                join: () => socket.addMembership(GROUP, INTERFACE),
                leave: () => socket.dropMembership(GROUP, INTERFACE),
                send: (text, port) => {
                    try {
                        socket.address();
                    } catch {
                        socket.bind(0);
                    }
                    socket.setMulticastInterface(INTERFACE);
                    socket.send(Buffer.from(text, 'latin1'), port, GROUP);
                },
                onMessage: (l) => void (listener = l),
                port: () => socket.address().port,
                close: () => socket.close(),
            };
        },
        // a probe datagram on the loopback is queued at once; the sends of the scenario are followed by a marker that goes
        // the same way, and the wait ends when a socket has seen it (no time is waited, the event loop is turned)
        async settle(): Promise<void> {
            const marker = this.endpoint(true);
            marker.bind(0);
            marker.join();
            let seen = false;
            marker.onMessage((text) => void (seen = 'settle' === text));
            marker.send('settle', marker.port());
            for (let turn = 0; turn < 1_000_000 && !seen; turn++) {
                await new Promise<void>((resolve) => setImmediate(resolve));
            }
            if (!seen) {
                throw new Error(
                    'no multicast delivery on the loopback interface (group ' +
                        GROUP +
                        ', interface ' +
                        INTERFACE +
                        '): this host cannot run the multicast tests',
                );
            }
            // the other sockets of the group were sent to before the marker, so they have their datagrams
            marker.close();
        },
    };
}

function simMedium(): Medium {
    const clock = new ManualClock();
    const network = new SimNetwork(1, NO_FAULTS, clock);
    return {
        endpoint(shared: boolean): Endpoint {
            const socket: SimSocket = network.newSocket({ reuseAddr: shared });
            let listener: (text: string) => void = () => {};
            socket.on('message', ((message: Uint8Array) => listener(Buffer.from(message).toString('latin1'))) as never);
            return {
                bind: (port) => socket.bind(port),
                join: () => socket.addMembership(GROUP, INTERFACE),
                leave: () => socket.dropMembership(GROUP, INTERFACE),
                send: (text, port) => {
                    const bytes = Buffer.from(text, 'latin1');
                    socket.send(bytes, 0, bytes.length, port, GROUP);
                },
                onMessage: (l) => void (listener = l),
                port: () => socket.address().port,
                close: () => socket.close(),
            };
        },
        settle: async () => {
            clock.ns += 1_000_000;
            network.deliverDue();
        },
    };
}

/** Three receivers on one port and a sender; a late joiner; one that leaves; a socket on the port that is not a member. The
 * rules of delivery are Linux's, so the two tests skip elsewhere. */
async function scenario(medium: Medium): Promise<Record<string, string[]>> {
    const names = ['a', 'b', 'c', 'late', 'outsider'];
    const received: Record<string, string[]> = Object.fromEntries(names.map((name) => [name, []]));
    const first = medium.endpoint(true);
    first.bind(0);
    const port = first.port();
    const group = new Map<string, Endpoint>([['a', first]]);
    for (const name of ['b', 'c', 'outsider']) {
        const endpoint = medium.endpoint(true);
        endpoint.bind(port);
        group.set(name, endpoint);
    }
    for (const [name, endpoint] of group) {
        endpoint.onMessage((text) => void (received[name] as string[]).push(text));
        if ('outsider' !== name) {
            endpoint.join();
        }
    }

    const sender = medium.endpoint(false);
    for (let i = 0; i < 5; i++) {
        sender.send('m' + i, port);
    }
    await medium.settle();

    const late = medium.endpoint(true);
    late.bind(port);
    late.onMessage((text) => void (received.late as string[]).push(text));
    late.join();
    (group.get('b') as Endpoint).leave();
    for (let i = 5; i < 8; i++) {
        sender.send('m' + i, port);
    }
    await medium.settle();
    return received;
}

const EXPECTED = {
    a: ['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'],
    // Linux (IP_MULTICAST_ALL is on): a socket that left the group, and one that never joined, still get the datagrams of
    // the port while another socket of the host is in the group
    b: ['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'],
    c: ['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'],
    late: ['m5', 'm6', 'm7'],
    outsider: ['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'],
};

describe('MulticastProbe', () => {
    it.skipIf('linux' !== process.platform)(
        'aRealMulticastGroupOnTheLoopbackInterfaceDeliversToEveryMemberOfThePort',
        async () => {
            expect(await scenario(realMedium())).toEqual(EXPECTED);
        },
    );

    it.skipIf('linux' !== process.platform)('theNetsimGroupModelDeliversWhatTheRealGroupDelivers', async () => {
        const real = await scenario(realMedium());
        const simulated = await scenario(simMedium());

        expect(simulated).toEqual(real);
        expect(simulated).toEqual(EXPECTED);
    });
});
