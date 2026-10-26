// Tests of the multicast groups of the simulation (phase 3, T5, D117): a send to a group reaches every member bound to the
// port, each member draws its faults from its own seeded stream, and the same seed gives the same trace. A group model that
// cannot be trusted would make the multicast and MDC scenarios of T11 worth nothing; `MulticastProbeTest` checks the same
// scenarios against a real multicast socket.
import { describe, expect, it } from 'vitest';
import { ManualClock } from '../../support/EmbeddedRig.js';
import { NO_FAULTS, SimNetwork, isMulticastAddress } from '../../support/SimNetwork.js';
import type { FaultModel, SimSocket } from '../../support/SimNetwork.js';

const GROUP = '224.20.30.39';
const PORT = 40_123;

interface Group {
    clock: ManualClock;
    network: SimNetwork;
    sender: SimSocket;
    receivers: SimSocket[];
    received: string[][];
}

function group(seed: number, model: FaultModel, members = 3): Group {
    const clock = new ManualClock();
    const network = new SimNetwork(seed, model, clock);
    const sender = network.newSocket();
    sender.bind(0, '127.0.0.1');
    const receivers: SimSocket[] = [];
    const received: string[][] = [];
    for (let i = 0; i < members; i++) {
        const socket = network.newSocket({ reuseAddr: true });
        const texts: string[] = [];
        socket.on(
            'message',
            ((message: Uint8Array) => void texts.push(Buffer.from(message).toString('latin1'))) as never,
        );
        socket.bind(PORT);
        socket.addMembership(GROUP, '127.0.0.1');
        receivers.push(socket);
        received.push(texts);
    }
    return { clock, network, sender, receivers, received };
}

function sendToGroup(g: Group, text: string, port = PORT, address = GROUP): void {
    const bytes = Buffer.from(text, 'latin1');
    g.sender.send(bytes, 0, bytes.length, port, address);
}

/** Send `count` datagrams, one per millisecond, and deliver them all. */
function flow(g: Group, count: number): void {
    for (let i = 0; i < count; i++) {
        sendToGroup(g, 'd' + i);
        g.clock.ns += 1_000_000;
        g.network.deliverDue();
    }
    g.clock.ns += 100_000_000;
    g.network.deliverDue();
}

const LOSSY: FaultModel = {
    ...NO_FAULTS,
    lossRate: 0.2,
    burstRate: 0.2,
    burstLength: 2,
    duplicateRate: 0.1,
    reorderRate: 0.3,
    reorderDelayNs: 5_000_000,
    delayNs: 1_000_000,
    jitterNs: 2_000_000,
};

describe('SimNetwork multicast groups', () => {
    it('aSendToAGroupReachesEveryMemberOnceInOrder', () => {
        const g = group(1, NO_FAULTS);
        flow(g, 20);

        const all = Array.from({ length: 20 }, (_, i) => 'd' + i);
        expect(g.received).toEqual([all, all, all]);
        // one send, three copies
        expect(g.network.stats.sent).toBe(20);
        expect(g.network.stats.delivered).toBe(60);
    });

    it('aSocketOnAnotherPortOrBoundToAUnicastAddressGetsNothing', () => {
        const g = group(2, NO_FAULTS);
        const otherPort = g.network.newSocket({ reuseAddr: true });
        const otherTexts: string[] = [];
        otherPort.on('message', ((m: Uint8Array) => void otherTexts.push(String(m))) as never);
        otherPort.bind(PORT + 1);
        otherPort.addMembership(GROUP, '127.0.0.1');
        const unicastBound = g.network.newSocket({ reuseAddr: true });
        const unicastTexts: string[] = [];
        unicastBound.on('message', ((m: Uint8Array) => void unicastTexts.push(String(m))) as never);
        unicastBound.bind(PORT, '127.0.0.1');

        flow(g, 5);

        expect(g.received[0]).toHaveLength(5);
        expect([otherTexts, unicastTexts]).toEqual([[], []]);
    });

    it('aSocketOfThePortThatNeverJoinedGetsTheDatagramsWhileAnotherSocketIsInTheGroup', () => {
        const g = group(2, NO_FAULTS, 1);
        const outsider = g.network.newSocket({ reuseAddr: true });
        const texts: string[] = [];
        outsider.on('message', ((m: Uint8Array) => void texts.push(Buffer.from(m).toString('latin1'))) as never);
        outsider.bind(PORT);

        flow(g, 3);

        expect(texts).toEqual(['d0', 'd1', 'd2']);
    });

    it('aSendToAGroupNobodyIsInReachesNobody', () => {
        const g = group(2, NO_FAULTS, 1);
        const outsider = g.network.newSocket({ reuseAddr: true });
        const texts: string[] = [];
        outsider.on('message', ((m: Uint8Array) => void texts.push(String(m))) as never);
        outsider.bind(PORT);

        sendToGroup(g, 'x', PORT, '224.20.30.40');
        g.clock.ns += 1_000_000;
        g.network.deliverDue();

        expect([texts, g.received[0]]).toEqual([[], []]);
        expect(g.network.stats.undeliverable).toBe(1);
    });

    it('aMemberThatLeavesKeepsGettingTheDatagramsWhileAnotherIsInTheGroupAndNoneOnceAllHaveLeft', () => {
        const g = group(3, NO_FAULTS);
        flow(g, 3);
        (g.receivers[1] as SimSocket).dropMembership(GROUP, '127.0.0.1');
        (g.receivers[2] as SimSocket).close();
        flow(g, 3);
        // the last socket in the group leaves: nothing is delivered to anyone
        (g.receivers[0] as SimSocket).dropMembership(GROUP, '127.0.0.1');
        flow(g, 3);

        expect(g.received.map((texts) => texts.length)).toEqual([6, 6, 3]);
        expect(() => (g.receivers[1] as SimSocket).dropMembership(GROUP)).toThrow(/EADDRNOTAVAIL/);
    });

    it('aMemberThatJoinsLaterGetsTheDatagramsSentAfterTheJoinOnly', () => {
        const g = group(4, NO_FAULTS, 1);
        flow(g, 3);
        const late = g.network.newSocket({ reuseAddr: true });
        const texts: string[] = [];
        late.on('message', ((m: Uint8Array) => void texts.push(Buffer.from(m).toString('latin1'))) as never);
        late.bind(PORT);
        late.addMembership(GROUP);
        flow(g, 2);

        expect(texts).toEqual(['d0', 'd1']);
        expect((g.received[0] as string[]).length).toBe(5);
    });

    it('eachMemberDrawsItsOwnLossAndTheSameSeedGivesTheSameTrace', () => {
        const one = group(42, LOSSY);
        const two = group(42, LOSSY);
        const other = group(43, LOSSY);
        flow(one, 400);
        flow(two, 400);
        flow(other, 400);

        expect(one.received).toEqual(two.received);
        expect(one.network.trace).toBe(two.network.trace);
        expect(one.network.stats).toEqual(two.network.stats);
        expect(other.network.trace).not.toBe(one.network.trace);
        // the three members lost different datagrams: one stream per member
        const [a, b, c] = one.received.map((texts) => new Set(texts));
        expect([...(a as Set<string>)].sort()).not.toEqual([...(b as Set<string>)].sort());
        expect([...(b as Set<string>)].sort()).not.toEqual([...(c as Set<string>)].sort());
        for (const receiver of one.receivers) {
            const stats = one.network.statsOfMember(receiver);
            expect(stats.lost).toBeGreaterThan(0);
            expect(stats.delivered).toBeGreaterThan(0);
        }
    });

    it('aMembersLossRateIsTheRateOfTheModelAndDoesNotDependOnTheOtherMembers', () => {
        const model: FaultModel = { ...NO_FAULTS, lossRate: 0.25 };
        const three = group(7, model, 3);
        flow(three, 4000);

        for (const receiver of three.receivers) {
            const stats = three.network.statsOfMember(receiver);
            expect(stats.lost + stats.delivered).toBe(4000);
            expect(stats.lost / 4000).toBeGreaterThan(0.21);
            expect(stats.lost / 4000).toBeLessThan(0.29);
        }

        // the first member of a group of one has the stream of the first member of a group of three
        const one = group(7, model, 1);
        flow(one, 4000);
        expect(one.received[0]).toEqual(three.received[0]);
    });

    it('aDuplicateOfAMemberIsAnotherCopyAndNotTheSameMemory', () => {
        const g = group(11, { ...NO_FAULTS, duplicateRate: 1, jitterNs: 1_000_000 }, 2);
        sendToGroup(g, 'x');
        g.clock.ns += 10_000_000;
        g.network.deliverDue();

        expect(g.received).toEqual([
            ['x', 'x'],
            ['x', 'x'],
        ]);
        expect(g.network.stats.duplicated).toBe(2);
    });

    it('theMemberTheSenderIsReceivesItsOwnDatagrams', () => {
        const g = group(5, NO_FAULTS, 1);
        const sender = g.receivers[0] as SimSocket;
        const bytes = Buffer.from('self');
        sender.send(bytes, 0, bytes.length, PORT, GROUP);
        g.clock.ns += 1_000_000;
        g.network.deliverDue();

        expect(g.received[0]).toEqual(['self']);
    });

    it('aUnicastSendToTheSharedPortReachesTheLastToBindOnly', () => {
        const g = group(6, NO_FAULTS, 3);
        sendToGroup(g, 'u', PORT, '127.0.0.1');
        g.clock.ns += 1_000_000;
        g.network.deliverDue();

        expect(g.received).toEqual([[], [], ['u']]);
    });

    it('theRulesOfTheSocketOptions', () => {
        const g = group(8, NO_FAULTS, 1);
        const socket = g.receivers[0] as SimSocket;
        expect(() => socket.addMembership(GROUP)).toThrow(/EADDRINUSE/);
        expect(() => socket.addMembership('10.0.0.1')).toThrow(/EINVAL/);
        expect(() => g.network.newSocket().addMembership(GROUP)).toThrow(/EBADF/);
        expect(() => socket.setMulticastTTL(256)).toThrow(/EINVAL/);
        expect(socket.setMulticastTTL(7)).toBe(7);
        expect(socket.multicastTtl()).toBe(7);
        socket.setMulticastInterface('127.0.0.1');
        expect(socket.multicastInterface()).toBe('127.0.0.1');
        expect(socket.multicastLoopback()).toBe(true);
        expect(g.network.groupsOf(socket)).toEqual([GROUP]);
    });

    it('twoSocketsMayShareAPortOnlyWhenBothAskedForIt', () => {
        const clock = new ManualClock();
        const network = new SimNetwork(1, NO_FAULTS, clock);
        // a bind that fails is an 'error' event inside the call, as with the synchronous lookup of the transports
        const bindFails = (reuseAddr: boolean, port: number): boolean => {
            const errors: Error[] = [];
            const socket = network.newSocket({ reuseAddr });
            socket.on('error', ((e: Error) => void errors.push(e)) as never);
            socket.bind(port);
            return errors.length > 0 && /EADDRINUSE/.test(errors[0]?.message ?? '');
        };

        expect(bindFails(false, PORT)).toBe(false);
        expect(bindFails(true, PORT)).toBe(true);
        expect(bindFails(true, PORT + 1)).toBe(false);
        expect(bindFails(true, PORT + 1)).toBe(false);
        expect(bindFails(false, PORT + 1)).toBe(true);
    });

    it('theMulticastRangeIs224To239', () => {
        expect(
            ['223.255.255.255', '224.0.0.0', '224.20.30.39', '239.255.255.255', '240.0.0.0', 'localhost'].map(
                isMulticastAddress,
            ),
        ).toEqual([false, true, true, true, false, false]);
    });
});
