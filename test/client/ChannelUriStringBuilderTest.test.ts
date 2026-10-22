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
// Port of io/aeron/ChannelUriStringBuilderTest.java @ 1.53.3
import { describe, expect, it } from 'vitest';
import { IllegalArgumentException, TimeUnit } from '../../src/agrona/jdk.js';
import { SystemUtil } from '../../src/agrona/SystemUtil.js';
import { ChannelUri } from '../../src/client/ChannelUri.js';
import { ChannelUriStringBuilder } from '../../src/client/ChannelUriStringBuilder.js';
import { CommonContext } from '../../src/client/CommonContext.js';
import { assertThrows } from '../support/Assertions.js';

const {
    MAX_RESEND_PARAM_NAME,
    PUBLICATION_WINDOW_LENGTH_PARAM_NAME,
    RESPONSE_CORRELATION_ID_PARAM_NAME,
    STREAM_ID_PARAM_NAME,
    UNTETHERED_LINGER_TIMEOUT_PARAM_NAME,
    UNTETHERED_RESTING_TIMEOUT_PARAM_NAME,
    UNTETHERED_WINDOW_LIMIT_TIMEOUT_PARAM_NAME,
} = CommonContext;

describe('ChannelUriStringBuilder', () => {
    it('shouldValidateMedia', () => {
        assertThrows(IllegalArgumentException, () => new ChannelUriStringBuilder().validate());
    });

    it('shouldValidateEndpointOrControl', () => {
        assertThrows(IllegalArgumentException, () => new ChannelUriStringBuilder().media('udp').validate());
    });

    it('shouldValidateInitialPosition', () => {
        assertThrows(IllegalArgumentException, () =>
            new ChannelUriStringBuilder().media('udp').endpoint('address:port').termId(999).validate(),
        );
    });

    it('shouldGenerateBasicIpcChannel', () => {
        const builder = new ChannelUriStringBuilder().media('ipc');

        expect(builder.build()).toBe('aeron:ipc');
    });

    it('shouldGenerateBasicUdpChannel', () => {
        const builder = new ChannelUriStringBuilder().media('udp').endpoint('localhost:9999');

        expect(builder.build()).toBe('aeron:udp?endpoint=localhost:9999');
    });

    it('shouldGenerateBasicUdpChannelSpy', () => {
        const builder = new ChannelUriStringBuilder().prefix('aeron-spy').media('udp').endpoint('localhost:9999');

        expect(builder.build()).toBe('aeron-spy:aeron:udp?endpoint=localhost:9999');
    });

    it('shouldGenerateComplexUdpChannel', () => {
        const builder = new ChannelUriStringBuilder()
            .media('udp')
            .endpoint('localhost:9999')
            .ttl(9)
            .termLength(1024 * 128);

        expect(builder.build()).toBe('aeron:udp?endpoint=localhost:9999|term-length=128k|ttl=9');
    });

    it('shouldGenerateReplayUdpChannel', () => {
        const builder = new ChannelUriStringBuilder()
            .media('udp')
            .endpoint('address:9999')
            .termLength(1024 * 128)
            .initialTermId(777)
            .termId(999)
            .termOffset(64);

        expect(builder.build()).toBe(
            'aeron:udp?endpoint=address:9999|term-length=128k|init-term-id=777|term-id=999|term-offset=64',
        );
    });

    it('shouldGenerateChannelWithSocketParameters', () => {
        const builder = new ChannelUriStringBuilder()
            .media('udp')
            .endpoint('address:9999')
            .socketSndbufLength(8192)
            .socketRcvbufLength(4096);

        expect(builder.build()).toBe('aeron:udp?endpoint=address:9999|so-sndbuf=8k|so-rcvbuf=4k');
    });

    it('shouldGenerateChannelWithReceiverWindow', () => {
        const builder = new ChannelUriStringBuilder().media('udp').endpoint('address:9999').receiverWindowLength(8192);

        expect(builder.build()).toBe('aeron:udp?endpoint=address:9999|rcv-wnd=8k');
    });

    it('shouldGenerateChannelWithLingerTimeout', () => {
        // Java: 987654321123456789L, which is above 2^53 - 1 (spec D5); see "Adapted tests" in docs/mapping.md
        const lingerNs = 987654321123456;
        const builder = new ChannelUriStringBuilder().media('ipc').linger(lingerNs);

        expect(builder.linger()).toBe(lingerNs);
        expect(builder.build()).toBe('aeron:ipc?linger=987654321123456ns');
    });

    it('shouldGenerateChannelWithoutLingerTimeoutIfNullIsPassed', () => {
        const builder = new ChannelUriStringBuilder().media('udp').endpoint('address:9999').linger(null);

        expect(builder.linger()).toBeNull();
        expect(builder.build()).toBe('aeron:udp?endpoint=address:9999');
    });

    it('shouldRejectNegativeLingerTimeout', () => {
        const exception = assertThrows(IllegalArgumentException, () =>
            new ChannelUriStringBuilder().media('udp').endpoint('address:9999').linger(-1),
        );

        expect(exception.message).toBe('`linger` value cannot be negative: -1');
    });

    it('shouldCopyLingerTimeoutFromChannelUriHumanForm', () => {
        const builder = new ChannelUriStringBuilder();
        builder.linger(ChannelUri.parse('aeron:ipc?linger=7200s'));

        expect(builder.linger()).toBe(
            TimeUnit.SECONDS.toNanos(2 * 3600) /* HOURS.toNanos(2): the stand-in TimeUnit has no HOURS */,
        );
    });

    it('shouldCopyLingerTimeoutFromChannelUriNanoseconds', () => {
        // Java: 19191919191919191, which is above 2^53 - 1 (spec D5); see "Adapted tests" in docs/mapping.md
        const builder = new ChannelUriStringBuilder();
        builder.linger(ChannelUri.parse('aeron:udp?linger=1919191919191919'));

        expect(builder.linger()).toBe(1919191919191919);
    });

    it('shouldCopyLingerTimeoutFromChannelUriNoValue', () => {
        const builder = new ChannelUriStringBuilder();
        builder.linger(ChannelUri.parse('aeron:udp?endpoint=localhost:8080'));

        expect(builder.linger()).toBeNull();
    });

    it('shouldCopyLingerTimeoutFromChannelUriNegativeValue', () => {
        const channelUri = ChannelUri.parse('aeron:udp?linger=-1000');
        assertThrows(IllegalArgumentException, () => new ChannelUriStringBuilder().linger(channelUri));
    });

    it('shouldBuildChannelBuilderUsingExistingStringWithAllTheFields', () => {
        const uri =
            'aeron-spy:aeron:udp?endpoint=127.0.0.1:0|interface=127.0.0.1|control=127.0.0.2:0|' +
            'control-mode=manual|tags=2,4|alias=foo|cc=cubic|fc=min|reliable=false|ttl=16|mtu=8992|' +
            'term-length=1m|init-term-id=5|term-offset=64|term-id=4353|session-id=2314234|gtag=3|' +
            'linger=100000055000001ns|sparse=true|eos=true|tether=false|group=false|ssc=true|so-sndbuf=8m|' +
            'so-rcvbuf=2m|rcv-wnd=1m|media-rcv-ts-offset=reserved|channel-rcv-ts-offset=0|' +
            'channel-snd-ts-offset=8|response-endpoint=127.0.0.3:0|response-correlation-id=12345|nak-delay=100us|' +
            'untethered-window-limit-timeout=1us|untethered-resting-timeout=5us|stream-id=87|pub-wnd=10224';

        const fromString = ChannelUri.parse(uri);
        const fromBuilder = ChannelUri.parse(new ChannelUriStringBuilder(uri).build());

        expect(fromString.diff(fromBuilder)).toEqual(new Map());
    });

    it('shouldBuildChannelBuilderUsingExistingStringWithTaggedSessionIdAndIpc', () => {
        const uri = 'aeron:ipc?session-id=tag:123456';

        const fromString = ChannelUri.parse(uri);
        const fromBuilder = ChannelUri.parse(new ChannelUriStringBuilder(uri).build());

        expect(fromString.diff(fromBuilder)).toEqual(new Map());
    });

    it('shouldRejectInvalidOffsets', () => {
        assertThrows(IllegalArgumentException, () =>
            new ChannelUriStringBuilder().mediaReceiveTimestampOffset('breserved'),
        );
        assertThrows(IllegalArgumentException, () =>
            new ChannelUriStringBuilder().channelReceiveTimestampOffset('breserved'),
        );
        assertThrows(IllegalArgumentException, () =>
            new ChannelUriStringBuilder().channelSendTimestampOffset('breserved'),
        );
    });

    it('shouldRejectInvalidNakDelay', () => {
        assertThrows(IllegalArgumentException, () => new ChannelUriStringBuilder().nakDelay('foo'));
    });

    it('shouldHandleNakDelayWithUnits', () => {
        expect(new ChannelUriStringBuilder().nakDelay('1us').nakDelay()).toBe(1000);
        expect(new ChannelUriStringBuilder().nakDelay('1ns').nakDelay()).toBe(1);
        expect(new ChannelUriStringBuilder().nakDelay('1ms').nakDelay()).toBe(1000000);
    });

    it('shouldHandleUntetheredWindowLimitTimeoutWithUnits', () => {
        expect(new ChannelUriStringBuilder().untetheredWindowLimitTimeout('1us').untetheredWindowLimitTimeoutNs()).toBe(
            1000,
        );
        expect(new ChannelUriStringBuilder().untetheredWindowLimitTimeout('1ns').untetheredWindowLimitTimeoutNs()).toBe(
            1,
        );
        expect(new ChannelUriStringBuilder().untetheredWindowLimitTimeout('1ms').untetheredWindowLimitTimeoutNs()).toBe(
            1000000,
        );
    });

    it('shouldHandleUntetheredRestingTimeoutWithUnits', () => {
        expect(new ChannelUriStringBuilder().untetheredRestingTimeout('1us').untetheredRestingTimeoutNs()).toBe(1000);
        expect(new ChannelUriStringBuilder().untetheredRestingTimeout('1ns').untetheredRestingTimeoutNs()).toBe(1);
        expect(new ChannelUriStringBuilder().untetheredRestingTimeout('1ms').untetheredRestingTimeoutNs()).toBe(
            1000000,
        );
    });

    it('shouldHandleMaxRetransmits', () => {
        expect(new ChannelUriStringBuilder().maxResend(20).maxResend()).toBe(20);
        expect(new ChannelUriStringBuilder().maxResend(20).build()).toContain(MAX_RESEND_PARAM_NAME + '=20');
        expect(
            new ChannelUriStringBuilder()
                .maxResend(ChannelUri.parse(new ChannelUriStringBuilder().maxResend(30).build()))
                .maxResend(),
        ).toBe(30);
    });

    it('shouldHandleStreamId', () => {
        expect(new ChannelUriStringBuilder().streamId()).toBeNull();

        const streamId = 1234;
        expect(new ChannelUriStringBuilder().streamId(streamId).streamId()).toBe(streamId);

        const uri = new ChannelUriStringBuilder().streamId(streamId).build();
        expect(ChannelUri.parse(uri).get(STREAM_ID_PARAM_NAME)).toBe(String(streamId));
    });

    it('shouldRejectInvalidStreamId', () => {
        const uri = ChannelUri.parse('aeron:ipc?stream-id=abc');
        assertThrows(IllegalArgumentException, () => new ChannelUriStringBuilder().streamId(uri));
    });

    it('shouldHandlePublicationWindowLength', () => {
        expect(new ChannelUriStringBuilder().publicationWindowLength()).toBeNull();

        const pubWindowLength = 7777;
        expect(new ChannelUriStringBuilder().publicationWindowLength(pubWindowLength).publicationWindowLength()).toBe(
            pubWindowLength,
        );

        const uri = new ChannelUriStringBuilder().publicationWindowLength(pubWindowLength).build();
        expect(ChannelUri.parse(uri).get(PUBLICATION_WINDOW_LENGTH_PARAM_NAME)).toBe(String(pubWindowLength));
    });

    it.each(['abc', '1000000000000'])('shouldRejectInvalidPublicationWindowLength %s', (pubWnd) => {
        const uri = ChannelUri.parse('aeron:ipc');
        uri.put(PUBLICATION_WINDOW_LENGTH_PARAM_NAME, pubWnd);
        assertThrows(IllegalArgumentException, () => new ChannelUriStringBuilder().publicationWindowLength(uri));
    });

    it.each([
        [1000, 666, 2002],
        [50, 40, 30],
    ])(
        'shouldHandleUntetheredParameters %d %d %d',
        (untetheredWindowLimitTimeoutNs, untetheredLingerTimeoutNs, untetheredRestingTimeoutNs) => {
            const builder = new ChannelUriStringBuilder('aeron:ipc')
                .untetheredWindowLimitTimeoutNs(untetheredWindowLimitTimeoutNs)
                .untetheredLingerTimeoutNs(untetheredLingerTimeoutNs)
                .untetheredRestingTimeoutNs(untetheredRestingTimeoutNs);

            expect(builder.untetheredWindowLimitTimeoutNs()).toBe(untetheredWindowLimitTimeoutNs);
            expect(builder.untetheredLingerTimeoutNs()).toBe(untetheredLingerTimeoutNs);
            expect(builder.untetheredRestingTimeoutNs()).toBe(untetheredRestingTimeoutNs);

            const uri = ChannelUri.parse(builder.build());
            expect(uri.get(UNTETHERED_WINDOW_LIMIT_TIMEOUT_PARAM_NAME)).toBe(
                SystemUtil.formatDuration(untetheredWindowLimitTimeoutNs),
            );
            expect(uri.get(UNTETHERED_LINGER_TIMEOUT_PARAM_NAME)).toBe(
                SystemUtil.formatDuration(untetheredLingerTimeoutNs),
            );
            expect(uri.get(UNTETHERED_RESTING_TIMEOUT_PARAM_NAME)).toBe(
                SystemUtil.formatDuration(untetheredRestingTimeoutNs),
            );
        },
    );

    it.each([['this.will.not.work'], ['-2']])(
        'shouldThrowAnExceptionOnInvalidResponseCorrelationId %s',
        (responseCorrelationId) => {
            const channelUri = ChannelUri.parse(
                'aeron:udp?' + RESPONSE_CORRELATION_ID_PARAM_NAME + '=' + responseCorrelationId,
            );
            assertThrows(IllegalArgumentException, () =>
                new ChannelUriStringBuilder().responseCorrelationId(channelUri),
            );
        },
    );

    it.each([['prototype'], ['2']])(
        'shouldNotThrowAnExceptionOnValidResponseCorrelationId %s',
        (responseCorrelationId) => {
            const channelUri = ChannelUri.parse(
                'aeron:udp?' + RESPONSE_CORRELATION_ID_PARAM_NAME + '=' + responseCorrelationId,
            );
            expect(() => new ChannelUriStringBuilder().responseCorrelationId(channelUri)).not.toThrow();
        },
    );

    it('shouldFormatSizeAndDurationsWhenCreatingChannelString', () => {
        const channel = new ChannelUriStringBuilder()
            .media('udp')
            .endpoint('localhost:5050')
            .receiverWindowLength(1024)
            .mtu(8192)
            .termLength(4 * 1024 * 1024)
            .socketSndbufLength(64 * 1024)
            .socketRcvbufLength(32 * 1024)
            .publicationWindowLength(1024 * 1024)
            .untetheredWindowLimitTimeoutNs(TimeUnit.MICROSECONDS.toNanos(100))
            .untetheredLingerTimeoutNs(TimeUnit.MILLISECONDS.toNanos(3))
            .untetheredRestingTimeoutNs(TimeUnit.SECONDS.toNanos(1))
            .linger(TimeUnit.MILLISECONDS.toNanos(50))
            .nakDelay(123456789)
            .maxResend(1000)
            .tether(true)
            .rejoin(false)
            .streamId(-87)
            .initialPosition(17 * 1024 * 1024, -9, 4 * 1024 * 1024)
            .build();
        expect(
            ChannelUri.parse(channel).diff(
                ChannelUri.parse(
                    'aeron:udp?endpoint=localhost:5050|mtu=8k|term-length=4m|rcv-wnd=1k|so-sndbuf=64k|' +
                        'so-rcvbuf=32k|pub-wnd=1m|untethered-linger-timeout=3ms|untethered-window-limit-timeout=100us|' +
                        'untethered-resting-timeout=1s|linger=50ms|nak-delay=123456789ns|max-resend=1000|rejoin=false|' +
                        'tether=true|stream-id=-87|term-id=-5|init-term-id=-9|term-offset=1048576',
                ),
            ),
        ).toEqual(new Map());
    });
});
