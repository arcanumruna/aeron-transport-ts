// Port of aeron-system-tests/src/test/java/io/aeron/MdsAndMdcInteractionTest.java @ 1.53.3 (phase 3, T10, D115).
// The clock is manual (one turn is 1 ms). The leader and the follower are clients of one driver, as in Java.
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { ChannelUriStringBuilder } from '../../src/client/ChannelUriStringBuilder.js';
import { LogBufferDescriptor } from '../../src/client/logbuffer/LogBufferDescriptor.js';
import type { Publication } from '../../src/client/Publication.js';
import { ChannelEndpointStatus } from '../../src/client/status/ChannelEndpointStatus.js';
import { LocalSocketAddressStatus } from '../../src/client/status/LocalSocketAddressStatus.js';
import type { Subscription } from '../../src/client/Subscription.js';
import { systemTests } from '../support/SystemTests.js';
import type { SystemTests, TestClient, TestNode } from '../support/SystemTests.js';

const STREAM_ID = 10000;
const SESSION_ID = 20000;
const CATCHUP_ENDPOINT = 'aeron:udp?endpoint=localhost:20001|alias=catchup';
const LIVE_ENDPOINT_EARLY = 'aeron:udp?endpoint=localhost:20002|alias=live';
const LIVE_ENDPOINT_LATE = 'aeron:udp?endpoint=localhost:20003|alias=live';
const LIVE_URI = 'aeron:udp?control-mode=manual|session-id=' + SESSION_ID;

/** The cap, in turns, of the loops that Java leaves to `@InterruptAfter`. */
const CAP = 200_000;

describe('MdsAndMdcInteractionTest', () => {
    const msg = new UnsafeBuffer(new TextEncoder().encode('Hello World'));

    let tests: SystemTests;
    let driver: TestNode;

    function setUp(name: string): void {
        tests = systemTests(name, true);
        driver = tests.launch((context) => context.publicationTermBufferLength(LogBufferDescriptor.TERM_MIN_LENGTH));
    }

    function offer(publication: Publication): Promise<void> {
        return tests.drainUntil(
            () => publication.offer(msg) >= 0,
            CAP,
            () => 'a window in ' + publication,
        );
    }

    /** `awaitMessages(sub, count)` */
    async function awaitMessages(sub: Subscription, count: number): Promise<void> {
        let messageCount = 0;
        await tests.drainUntil(
            () => {
                if (count === messageCount) {
                    return true;
                }
                sub.poll({ onFragment: () => void messageCount++ }, 10);
                return count === messageCount;
            },
            CAP,
            () => 'expected=' + count + ', actual=' + messageCount,
        );
    }

    it('shouldSwitchFromCatchupToLive', async () => {
        setUp('shouldSwitchFromCatchupToLive');
        const initialTermId = 100;
        const activeTermId = 100;
        const termOffset = 0;
        const termLength = 64 * 1024;
        const positionBitsToShift = LogBufferDescriptor.positionBitsToShift(termLength);
        const position = LogBufferDescriptor.computePosition(
            activeTermId,
            termOffset,
            positionBitsToShift,
            initialTermId,
        );
        const messageCount = 10;

        const catchupUri = new ChannelUriStringBuilder(CATCHUP_ENDPOINT)
            .sessionId(SESSION_ID)
            .initialPosition(position, initialTermId, termLength)
            .build();

        const liveUri = new ChannelUriStringBuilder(LIVE_URI)
            .flowControl('min,t:1s')
            .sessionId(SESSION_ID)
            .initialPosition(position, initialTermId, termLength)
            .build();

        const follower: TestClient = tests.connect(driver);
        const leader: TestClient = tests.connect(driver);
        const lateJoinSub = follower.aeron.addSubscription(LIVE_URI, STREAM_ID);
        const livePub = leader.aeron.addPublication(liveUri, STREAM_ID) as Publication;
        const earlySub = follower.aeron.addSubscription(LIVE_ENDPOINT_EARLY, STREAM_ID);

        const catchupPub = leader.aeron.addPublication(catchupUri, STREAM_ID) as Publication;
        lateJoinSub.addDestination(CATCHUP_ENDPOINT);
        livePub.addDestination(LIVE_ENDPOINT_EARLY);
        livePub.addDestination(LIVE_ENDPOINT_LATE);

        await tests.awaitConnected(lateJoinSub);
        await tests.awaitConnected(earlySub);
        await tests.awaitConnected(catchupPub);
        await tests.awaitConnected(livePub);

        for (let i = 0; i < messageCount; i++) {
            await offer(catchupPub);

            await offer(livePub);
        }

        await awaitMessages(lateJoinSub, messageCount);
        await awaitMessages(earlySub, messageCount);

        lateJoinSub.addDestination(LIVE_ENDPOINT_LATE);

        await tests.drainUntil(
            () =>
                2 ===
                (lateJoinSub.imageBySessionId(SESSION_ID) as { activeTransportCount(): number }).activeTransportCount(),
            CAP,
            () => 'two active transports',
        );

        lateJoinSub.removeDestination(CATCHUP_ENDPOINT);

        catchupPub.close();

        for (let i = 0; i < messageCount; i++) {
            await offer(livePub);
        }

        await awaitMessages(lateJoinSub, messageCount);
        expect((lateJoinSub.imageBySessionId(SESSION_ID) as { position(): number }).position()).toBe(
            livePub.position(),
        );
        expect(tests.errors()).toEqual([]);
    });

    it('shouldSwitchFromCatchupToLiveWhenRestartingClient', async () => {
        setUp('shouldSwitchFromCatchupToLiveWhenRestartingClient');
        const initialTermId = 100;
        const activeTermId = 100;
        const termOffset = 0;
        const termLength = 64 * 1024;
        const positionBitsToShift = LogBufferDescriptor.positionBitsToShift(termLength);
        const position = LogBufferDescriptor.computePosition(
            activeTermId,
            termOffset,
            positionBitsToShift,
            initialTermId,
        );
        const messageCount = 10;

        const liveUri = new ChannelUriStringBuilder(LIVE_URI)
            .flowControl('min,t:1s')
            .sessionId(SESSION_ID)
            .initialPosition(position, initialTermId, termLength)
            .build();

        const leader: TestClient = tests.connect(driver);
        const livePub = leader.aeron.addPublication(liveUri, STREAM_ID) as Publication;
        const earlySub = leader.aeron.addSubscription(LIVE_ENDPOINT_EARLY, STREAM_ID);

        livePub.addDestination(LIVE_ENDPOINT_EARLY);
        livePub.addDestination(LIVE_ENDPOINT_LATE);
        await tests.awaitConnected(earlySub);

        const follower1: TestClient = tests.connect(driver);
        const lateJoinSub1 = follower1.aeron.addSubscription(LIVE_URI, STREAM_ID);
        lateJoinSub1.addDestination(LIVE_ENDPOINT_LATE);
        await tests.awaitConnected(lateJoinSub1);
        await tests.awaitConnected(livePub);

        const lateJoinChannelStatusId = lateJoinSub1.channelStatusId();

        for (let i = 0; i < messageCount; i++) {
            await offer(livePub);
        }

        await awaitMessages(earlySub, messageCount);
        await awaitMessages(lateJoinSub1, messageCount);

        // the end of `try (Aeron follower = ...; Subscription lateJoinSub = ...)`: the subscription, then the client
        lateJoinSub1.close();
        follower1.close();

        await tests.drainUntil(
            () =>
                LocalSocketAddressStatus.findAddresses(
                    leader.aeron.countersReader(),
                    ChannelEndpointStatus.ACTIVE,
                    lateJoinChannelStatusId,
                ).length === 0,
            CAP,
            () => 'no active address of the closed subscription',
        );

        const restartPosition = livePub.position();

        for (let i = 0; i < messageCount; i++) {
            await offer(livePub);
        }

        await awaitMessages(earlySub, messageCount);

        const follower2: TestClient = tests.connect(driver);
        const lateJoinSub2 = follower2.aeron.addSubscription(LIVE_URI, STREAM_ID);
        lateJoinSub2.addDestination(CATCHUP_ENDPOINT);

        const catchupUri = new ChannelUriStringBuilder(CATCHUP_ENDPOINT)
            .sessionId(SESSION_ID)
            .initialPosition(restartPosition, initialTermId, termLength)
            .build();

        const catchupPub = leader.aeron.addPublication(catchupUri, STREAM_ID) as Publication;
        await tests.awaitConnected(lateJoinSub2);

        for (let i = 0; i < messageCount; i++) {
            await offer(catchupPub);
        }

        await awaitMessages(lateJoinSub2, messageCount);

        expect((lateJoinSub2.imageBySessionId(SESSION_ID) as { position(): number }).position()).toBe(
            livePub.position(),
        );

        lateJoinSub2.addDestination(LIVE_ENDPOINT_LATE);

        await tests.drainUntil(
            () =>
                2 ===
                (
                    lateJoinSub2.imageBySessionId(SESSION_ID) as { activeTransportCount(): number }
                ).activeTransportCount(),
            CAP,
            () => 'two active transports',
        );

        lateJoinSub2.removeDestination(CATCHUP_ENDPOINT);

        for (let i = 0; i < messageCount; i++) {
            await offer(livePub);
        }

        await awaitMessages(earlySub, messageCount);
        await awaitMessages(lateJoinSub2, messageCount);
        expect(tests.errors()).toEqual([]);
    });
});
