/*
 * Copyright 2014-2025 Real Logic Limited.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Modified: ported to TypeScript for aeron-transport-ts.
 */
// Port of io/aeron/driver/PublicationParamsTest.java @ 1.53.3
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Long, ThreadLocalRandom, TimeUnit } from '../../src/agrona/jdk.js';
import { ChannelUri } from '../../src/client/ChannelUri.js';
import { CommonContext } from '../../src/client/CommonContext.js';
import { Configuration } from '../../src/driver/Configuration.js';
import { InvalidChannelException } from '../../src/driver/exceptions/InvalidChannelException.js';
import { MediaDriver } from '../../src/driver/MediaDriver.js';
import { PublicationParams, type DriverConductor, type PublicationLike } from '../../src/driver/PublicationParams.js';
import { assertThrows, assertThrowsExactly } from '../support/Assertions.js';

const { SESSION_ID_PARAM_NAME, STREAM_ID_PARAM_NAME } = CommonContext;
const { MICROSECONDS, MILLISECONDS, SECONDS } = TimeUnit;

/** `mock(DriverConductor.class)`: every method records its calls and returns null (0 for the session id). */
function mockDriverConductor() {
    return {
        findNetworkPublicationByTag: vi.fn<(tag: number) => PublicationLike | null>(() => null),
        findIpcPublicationByTag: vi.fn<(tag: number) => PublicationLike | null>(() => null),
        nextAvailableSessionId: vi.fn<(streamId: number, channel: string) => number>(() => 0),
    };
}

/** `verifyNoInteractions(conductor)`. */
function verifyNoInteractions(conductor: ReturnType<typeof mockDriverConductor>): void {
    for (const [name, spy] of Object.entries(conductor)) {
        expect(spy, name).not.toHaveBeenCalled();
    }
}

/** `mock(NetworkPublication.class)` / `mock(IpcPublication.class)` with the three stubbed methods. */
function mockPublication(sessionId: number, mtu: number, termLength: number): PublicationLike {
    return {
        sessionId: () => sessionId,
        mtuLength: () => mtu,
        termBufferLength: () => termLength,
        channel: () => '',
    };
}

/**
 * `ThreadLocalRandom.current().nextLong()` for a long that a `number` holds (spec D5): over [-(2^53 - 1), 2^53 - 1].
 */
function nextLong(): number {
    return Math.floor((Math.random() * 2 - 1) * Long.MAX_VALUE);
}

describe('PublicationParamsTest', () => {
    let ctx: MediaDriver.Context;
    let conductor: ReturnType<typeof mockDriverConductor>;
    const asConductor = (): DriverConductor => conductor;

    beforeEach(() => {
        ctx = new MediaDriver.Context();
        conductor = mockDriverConductor();
    });

    it('basicParse', () => {
        const uri = ChannelUri.parse('aeron:udp?endpoint=localhost:1010');
        const params = PublicationParams.getPublicationParams(uri, ctx, asConductor(), 42, 'UDP');
        expect(params.maxResend).toBe(ctx.maxResend());
    });

    it('hasMaxRetransmits', () => {
        const uri = ChannelUri.parse(
            'aeron:udp?endpoint=localhost:1010|' + CommonContext.MAX_RESEND_PARAM_NAME + '=100',
        );
        const params = PublicationParams.getPublicationParams(uri, ctx, asConductor(), 8, 'UDP');
        expect(params.maxResend).toBe(100);
    });

    it('hasNegativeMaxRetransmits', () => {
        const uri = ChannelUri.parse(
            'aeron:udp?endpoint=localhost:1010|' + CommonContext.MAX_RESEND_PARAM_NAME + '=-1234',
        );
        const exception = assertThrows(InvalidChannelException, () =>
            PublicationParams.getPublicationParams(uri, ctx, asConductor(), -19, 'UDP'),
        );

        expect(exception.message).toContain('must be > 0');
    });

    it('hasTooBigMaxRetransmits', () => {
        const uri = ChannelUri.parse(
            'aeron:udp?endpoint=localhost:1010|' +
                CommonContext.MAX_RESEND_PARAM_NAME +
                '=' +
                Configuration.MAX_RESEND_MAX * 2,
        );
        const exception = assertThrows(InvalidChannelException, () =>
            PublicationParams.getPublicationParams(uri, ctx, asConductor(), 22, 'UDP'),
        );

        expect(exception.message).toContain('and <= ' + Configuration.MAX_RESEND_MAX);
    });

    it('hasInvalidMaxRetransmits', () => {
        const uri = ChannelUri.parse(
            'aeron:udp?endpoint=localhost:1010|' + CommonContext.MAX_RESEND_PARAM_NAME + '=notanumber',
        );
        const exception = assertThrows(InvalidChannelException, () =>
            PublicationParams.getPublicationParams(uri, ctx, asConductor(), 8, 'UDP'),
        );

        expect(exception.message).toContain('must be a number');
    });

    it('shouldSetStreamId', () => {
        const streamId = 42;
        const uri = ChannelUri.parse('aeron:ipc?alias=x|stream-id=' + streamId);
        const params = PublicationParams.getPublicationParams(uri, ctx, asConductor(), 42, 'IPC');

        expect(params.streamId).toBe(streamId);
    });

    it('shouldRejectStreamIdThatIsNotANumber', () => {
        const uri = ChannelUri.parse('aeron:udp?endpoint=localhost:8080|stream-id=abc');
        const exception = assertThrowsExactly(InvalidChannelException, () =>
            PublicationParams.getPublicationParams(uri, ctx, asConductor(), 42, 'UDP'),
        );
        expect(exception.message).toBe('ERROR - invalid ' + STREAM_ID_PARAM_NAME + ', must be a number');
    });

    it('shouldRejectStreamIdTIfItDoesNotMatch', () => {
        const uri = ChannelUri.parse('aeron:udp?endpoint=localhost:8080|stream-id=-19');
        const exception = assertThrowsExactly(InvalidChannelException, () =>
            PublicationParams.getPublicationParams(uri, ctx, asConductor(), 2112, 'UDP'),
        );
        expect(exception.message).toBe('ERROR - stream-id=-19 does not match provided streamId=2112');
    });

    it.each([0, 1407])('shouldRejectPublicationWindowLessThanMtu %s', (pubWindow) => {
        const uri = ChannelUri.parse('aeron:udp?endpoint=localhost:8080|mtu=1408|pub-wnd=' + pubWindow);
        const exception = assertThrowsExactly(InvalidChannelException, () =>
            PublicationParams.getPublicationParams(uri, ctx, asConductor(), 2112, 'UDP'),
        );
        expect(exception.message).toBe('ERROR - pub-wnd=' + pubWindow + ' cannot be less than the mtu=1408');
    });

    it.each([100_000, 32 * 1024 + 1])('shouldRejectPublicationWindowLargerThanHalfATermLength %s', (pubWindow) => {
        const uri = ChannelUri.parse('aeron:udp?endpoint=localhost:8080|term-length=64k|pub-wnd=' + pubWindow);
        const exception = assertThrowsExactly(InvalidChannelException, () =>
            PublicationParams.getPublicationParams(uri, ctx, asConductor(), 2112, 'UDP'),
        );
        expect(exception.message).toBe('ERROR - pub-wnd=' + pubWindow + ' must not exceed half the term-length=65536');
    });

    it.each([2048, 32 * 1024])('shouldSetPublicationWindowFromUriParameter %s', (pubWindow) => {
        const uri = ChannelUri.parse('aeron:udp?endpoint=localhost:8080|term-length=64k|pub-wnd=' + pubWindow);
        const params = PublicationParams.getPublicationParams(uri, ctx, asConductor(), 2112, 'UDP');

        expect(params.publicationWindowLength).toBe(pubWindow);
    });

    it.each(['aeron:ipc?term-length=1m', 'aeron:udp?endpoint=localhost:5555|term-length=128k'])(
        'shouldSetPublicationWindowToHalfATermIfNotSet %s',
        (uri) => {
            ctx.ipcPublicationTermWindowLength(0).publicationTermWindowLength(0);

            const params = PublicationParams.getPublicationParams(
                ChannelUri.parse(uri),
                ctx,
                asConductor(),
                100,
                'test',
            );

            expect(params.publicationWindowLength).toBe(params.termLength / 2);
        },
    );

    it('shouldSetPublicationWindowFromConfigIpc', () => {
        ctx.ipcPublicationTermWindowLength(128 * 1024).publicationTermWindowLength(0);

        const uri = ChannelUri.parse('aeron:ipc?term-length=4m');
        const params = PublicationParams.getPublicationParams(uri, ctx, asConductor(), 100, 'IPC');

        expect(params.publicationWindowLength).toBe(ctx.ipcPublicationTermWindowLength());
    });

    it('shouldSetPublicationWindowFromConfigUdp', () => {
        ctx.ipcPublicationTermWindowLength(0).publicationTermWindowLength(4096);

        const uri = ChannelUri.parse('aeron:udp?term-length=16m|endpoint=localhost:7777');
        const params = PublicationParams.getPublicationParams(uri, ctx, asConductor(), 100, 'UDP');

        expect(params.publicationWindowLength).toBe(ctx.publicationTermWindowLength());
    });

    it.each(['aeron:ipc?term-length=1m', 'aeron:udp?endpoint=localhost:5555|term-length=128k'])(
        'shouldGenerateSessionIdWhenNotSet %s',
        (uri) => {
            const streamId = -98;
            const sessionId = 134238032;
            conductor.nextAvailableSessionId.mockReturnValue(sessionId);

            const channelUri = ChannelUri.parse(uri);
            const params = PublicationParams.getPublicationParams(
                channelUri,
                ctx,
                asConductor(),
                streamId,
                channelUri.media(),
            );

            expect(params.sessionId).toBe(sessionId);
            expect(conductor.nextAvailableSessionId).toHaveBeenCalledTimes(1);
            expect(conductor.nextAvailableSessionId).toHaveBeenCalledWith(streamId, channelUri.media());
        },
    );

    it.each(['aeron:ipc?mtu=1408', 'aeron:udp?endpoint=localhost:5555'])(
        'shouldSetSessionIdFromTheUriParameter %s',
        (uri) => {
            const streamId = ThreadLocalRandom.current().nextInt();
            const sessionId = ThreadLocalRandom.current().nextInt();

            const channelUri = ChannelUri.parse(uri + '|' + SESSION_ID_PARAM_NAME + '=' + sessionId);
            const params = PublicationParams.getPublicationParams(
                channelUri,
                ctx,
                asConductor(),
                streamId,
                channelUri.media(),
            );

            expect(params.sessionId).toBe(sessionId);
            verifyNoInteractions(conductor);
        },
    );

    it('shouldRejectTaggedSessionIfTagIsInvalid', () => {
        const channelUri = ChannelUri.parse('aeron:udp?endpoint=localhost:5555|session-id=tag:abc');
        const exception = assertThrowsExactly(InvalidChannelException, () =>
            PublicationParams.getPublicationParams(channelUri, ctx, asConductor(), 42, channelUri.media()),
        );
        expect(exception.message).toBe(
            'ERROR - session-id=tag:abc has an invalid tag: ' +
                'channel=aeron:udp?session-id=tag:abc|endpoint=localhost:5555',
        );
    });

    it('shouldRejectTaggedSessionIfUnknownPublicationReferenceUdp', () => {
        const tag = nextLong();

        const channelUri = ChannelUri.parse('aeron:udp?endpoint=localhost:5555|session-id=tag:' + tag);
        const exception = assertThrowsExactly(InvalidChannelException, () =>
            PublicationParams.getPublicationParams(channelUri, ctx, asConductor(), 42, channelUri.media()),
        );
        expect(exception.message).toBe(
            'ERROR - session-id=tag:' + tag + ' must reference a network publication: channel=' + channelUri,
        );

        expect(conductor.findNetworkPublicationByTag).toHaveBeenCalledTimes(1);
        expect(conductor.findNetworkPublicationByTag).toHaveBeenCalledWith(tag);
    });

    it('shouldRejectTaggedSessionIfUnknownPublicationReferenceIpc', () => {
        const tag = nextLong();

        const channelUri = ChannelUri.parse('aeron:ipc?session-id=tag:' + tag);
        const exception = assertThrowsExactly(InvalidChannelException, () =>
            PublicationParams.getPublicationParams(channelUri, ctx, asConductor(), 42, channelUri.media()),
        );
        expect(exception.message).toBe(
            'ERROR - session-id=tag:' + tag + ' must reference an IPC publication: channel=' + channelUri,
        );

        expect(conductor.findIpcPublicationByTag).toHaveBeenCalledTimes(1);
        expect(conductor.findIpcPublicationByTag).toHaveBeenCalledWith(tag);
    });

    it('shouldInitializeSessionIdTermBufferLengthAndMtuFromReferencedUdpPublicationIfTagged', () => {
        const tag = 42;
        const mtu = 1408;
        const termLength = 1024 * 1024;
        const sessionId = -4658437;
        const pub = mockPublication(sessionId, mtu, termLength);
        conductor.findNetworkPublicationByTag.mockImplementation((t) => (t === tag ? pub : null));

        const channelUri = ChannelUri.parse('aeron:udp?endpoint=localhost:5555|session-id=tag:' + tag);
        const params = PublicationParams.getPublicationParams(channelUri, ctx, asConductor(), 42, channelUri.media());

        expect(params.sessionId).toBe(sessionId);
        expect(params.mtuLength).toBe(mtu);
        expect(params.termLength).toBe(termLength);
        expect(conductor.findNetworkPublicationByTag).toHaveBeenCalledTimes(1);
        expect(conductor.findNetworkPublicationByTag).toHaveBeenCalledWith(tag);
    });

    it('shouldInitializeSessionIdTermBufferLengthAndMtuFromReferencedIpcPublicationIfTagged', () => {
        const tag = -5;
        const mtu = 2048;
        const termLength = 64 * 1024;
        const sessionId = 100;
        const pub = mockPublication(sessionId, mtu, termLength);
        conductor.findIpcPublicationByTag.mockImplementation((t) => (t === tag ? pub : null));

        const channelUri = ChannelUri.parse('aeron:ipc?session-id=tag:' + tag);
        const params = PublicationParams.getPublicationParams(channelUri, ctx, asConductor(), -87, channelUri.media());

        expect(params.sessionId).toBe(sessionId);
        expect(params.mtuLength).toBe(mtu);
        expect(params.termLength).toBe(termLength);
        expect(conductor.findIpcPublicationByTag).toHaveBeenCalledTimes(1);
        expect(conductor.findIpcPublicationByTag).toHaveBeenCalledWith(tag);
    });

    it.each(['aeron:ipc', 'aeron:udp?endpoint=localhost:5555'])('shouldReturnTrueForEosIfNotDefined %s', (uri) => {
        const channelUri = ChannelUri.parse(uri);
        const params = PublicationParams.getPublicationParams(channelUri, ctx, asConductor(), 1, channelUri.media());
        expect(params.signalEos).toBe(true);
    });

    it.each([true, false])('shouldSetEosFromUri %s', (eos) => {
        const channelUri = ChannelUri.parse('aeron:ipc?eos=' + eos);
        const params = PublicationParams.getPublicationParams(channelUri, ctx, asConductor(), 1, channelUri.media());
        expect(params.signalEos).toBe(eos);
    });

    it.each(['aeron:ipc', 'aeron:udp?endpoint=localhost:5555'])('shouldReturnConfigValueForSparse %s', (uri) => {
        ctx.termBufferSparseFile(ThreadLocalRandom.current().nextBoolean());

        const channelUri = ChannelUri.parse(uri);
        const params = PublicationParams.getPublicationParams(channelUri, ctx, asConductor(), 1, channelUri.media());
        expect(params.isSparse).toBe(ctx.termBufferSparseFile());
    });

    it.each([true, false])('shouldSetSparseFromUri %s', (sprase) => {
        const channelUri = ChannelUri.parse('aeron:ipc?sparse=' + sprase);
        const params = PublicationParams.getPublicationParams(channelUri, ctx, asConductor(), 1, channelUri.media());
        expect(params.isSparse).toBe(sprase);
    });

    it.each(['aeron:ipc', 'aeron:udp?endpoint=localhost:5555'])(
        'shouldReturnConfigValueForSpiesSimulateConnectionIfNotDefined %s',
        (uri) => {
            ctx.spiesSimulateConnection(ThreadLocalRandom.current().nextBoolean());

            const channelUri = ChannelUri.parse(uri);
            const params = PublicationParams.getPublicationParams(
                channelUri,
                ctx,
                asConductor(),
                1,
                channelUri.media(),
            );
            expect(params.spiesSimulateConnection).toBe(ctx.spiesSimulateConnection());
        },
    );

    it.each([true, false])('shouldSetSpiesSimulateConnectionFromUri %s', (sprase) => {
        const channelUri = ChannelUri.parse('aeron:ipc?ssc=' + sprase);
        const params = PublicationParams.getPublicationParams(channelUri, ctx, asConductor(), 1, channelUri.media());
        expect(params.spiesSimulateConnection).toBe(sprase);
    });

    it.each(['aeron:ipc', 'aeron:udp?endpoint=localhost:5555'])(
        'shouldReturnLingerTimeoutFromConfigIfNotSet %s',
        (uri) => {
            ctx.publicationLingerTimeoutNs(SECONDS.toNanos(7));

            const channelUri = ChannelUri.parse(uri);
            const params = PublicationParams.getPublicationParams(
                channelUri,
                ctx,
                asConductor(),
                1,
                channelUri.media(),
            );
            expect(params.lingerTimeoutNs).toBe(ctx.publicationLingerTimeoutNs());
        },
    );

    it.each(['aeron:ipc?mtu=4k', 'aeron:udp?endpoint=localhost:5555'])('shouldSetLingerTimeout %s', (uri) => {
        const lingerTimeoutMs = 321;

        const channelUri = ChannelUri.parse(uri + '|linger=' + lingerTimeoutMs + 'ms');
        const params = PublicationParams.getPublicationParams(channelUri, ctx, asConductor(), 1, channelUri.media());
        expect(params.lingerTimeoutNs).toBe(MILLISECONDS.toNanos(lingerTimeoutMs));
    });

    it.each(['aeron:ipc', 'aeron:udp?endpoint=localhost:5555'])(
        'shouldReturnUntetheredWindowLimitTimeoutFromConfigIfNotSet %s',
        (uri) => {
            ctx.untetheredWindowLimitTimeoutNs(SECONDS.toNanos(7));

            const channelUri = ChannelUri.parse(uri);
            const params = PublicationParams.getPublicationParams(
                channelUri,
                ctx,
                asConductor(),
                1,
                channelUri.media(),
            );
            expect(params.untetheredWindowLimitTimeoutNs).toBe(ctx.untetheredWindowLimitTimeoutNs());
        },
    );

    it.each(['aeron:ipc?mtu=4k', 'aeron:udp?endpoint=localhost:5555'])(
        'shouldSetUntetheredWindowLimitTimeout %s',
        (uri) => {
            const timeoutUs = 456;

            const channelUri = ChannelUri.parse(uri + '|untethered-window-limit-timeout=' + timeoutUs + 'us');
            const params = PublicationParams.getPublicationParams(
                channelUri,
                ctx,
                asConductor(),
                1,
                channelUri.media(),
            );
            expect(params.untetheredWindowLimitTimeoutNs).toBe(MICROSECONDS.toNanos(timeoutUs));
        },
    );

    it.each(['aeron:ipc', 'aeron:udp?endpoint=localhost:5555'])(
        'shouldReturnUntetheredRestingTimeoutFromConfigIfNotSet %s',
        (uri) => {
            ctx.untetheredRestingTimeoutNs(SECONDS.toNanos(7));

            const channelUri = ChannelUri.parse(uri);
            const params = PublicationParams.getPublicationParams(
                channelUri,
                ctx,
                asConductor(),
                1,
                channelUri.media(),
            );
            expect(params.untetheredRestingTimeoutNs).toBe(ctx.untetheredRestingTimeoutNs());
        },
    );

    it.each(['aeron:ipc?mtu=4k', 'aeron:udp?endpoint=localhost:5555'])(
        'shouldSetUntetheredRestingTimeout %s',
        (uri) => {
            const timeoutNs = 456;

            const channelUri = ChannelUri.parse(uri + '|untethered-resting-timeout=' + timeoutNs);
            const params = PublicationParams.getPublicationParams(
                channelUri,
                ctx,
                asConductor(),
                1,
                channelUri.media(),
            );
            expect(params.untetheredRestingTimeoutNs).toBe(timeoutNs);
        },
    );

    it('shouldHonorPrecedenceForUntetheredLingerTimeoutWithDefaultsInContext', () => {
        // context
        const channelUri = ChannelUri.parse('aeron:udp?endpoint=localhost:5555|untethered-window-limit-timeout=444ms');
        const params = PublicationParams.getPublicationParams(channelUri, ctx, asConductor(), 1, channelUri.media());
        expect(params.untetheredWindowLimitTimeoutNs).toBe(MILLISECONDS.toNanos(444));
        expect(params.untetheredLingerTimeoutNs).toBe(MILLISECONDS.toNanos(444));
    });

    it('shouldHonorPrecedenceForUntetheredLingerTimeoutWithOverriddenContext', () => {
        ctx.untetheredLingerTimeoutNs(MILLISECONDS.toNanos(555));

        // context
        const channelUri = ChannelUri.parse('aeron:udp?endpoint=localhost:5555|untethered-window-limit-timeout=444ms');
        const params = PublicationParams.getPublicationParams(channelUri, ctx, asConductor(), 1, channelUri.media());
        expect(params.untetheredWindowLimitTimeoutNs).toBe(MILLISECONDS.toNanos(444));
        expect(params.untetheredLingerTimeoutNs).toBe(MILLISECONDS.toNanos(555));
    });

    it('shouldHonorChannelOverrideForUntetheredLingerTimeout', () => {
        ctx.untetheredLingerTimeoutNs(MILLISECONDS.toNanos(555));

        // context
        const channelUri = ChannelUri.parse(
            'aeron:udp?endpoint=localhost:5555|untethered-window-limit-timeout=444ms|untethered-linger-timeout=333ms',
        );
        const params = PublicationParams.getPublicationParams(channelUri, ctx, asConductor(), 1, channelUri.media());
        expect(params.untetheredWindowLimitTimeoutNs).toBe(MILLISECONDS.toNanos(444));
        expect(params.untetheredLingerTimeoutNs).toBe(MILLISECONDS.toNanos(333));
    });

    it('shouldDiscardSessionIdIfNotInteger', () => {
        const channelUri = ChannelUri.parse('aeron:ipc?session-id=abc');
        const exception = assertThrowsExactly(InvalidChannelException, () =>
            PublicationParams.getPublicationParams(channelUri, ctx, asConductor(), 1, channelUri.media()),
        );
        expect(exception.message).toBe('ERROR - invalid session-id, must be a number');
    });
});
