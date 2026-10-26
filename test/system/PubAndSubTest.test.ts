// Port of aeron-system-tests/src/test/java/io/aeron/PubAndSubTest.java @ 1.53.3 (phase 3, T7, D115).
// The clock of the test is manual: one turn is 1 ms for the driver and the clients, so every timeout of Java (the 300 ms
// connection timeout, 500 ms image liveness, the 200 ms linger, the `Tests.executeUntil` limits) is a number of turns.
// The `aeron:ipc` row of each `channels()` test is a row that skips (IPC is not ported, spec section 3, D54).
import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { BitUtil } from '../../src/agrona/BitUtil.js';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import type { DirectBuffer } from '../../src/agrona/DirectBuffer.js';
import type { ErrorHandler } from '../../src/agrona/ErrorHandler.js';
import { AeronCounters } from '../../src/client/AeronCounters.js';
import type { Aeron } from '../../src/client/Aeron.js';
import { ChannelUri } from '../../src/client/ChannelUri.js';
import { ChannelUriStringBuilder } from '../../src/client/ChannelUriStringBuilder.js';
import type { ExclusivePublication } from '../../src/client/ExclusivePublication.js';
import { FragmentAssembler } from '../../src/client/FragmentAssembler.js';
import { Image } from '../../src/client/Image.js';
import { ImageFragmentAssembler } from '../../src/client/ImageFragmentAssembler.js';
import { LogBuffers } from '../../src/client/LogBuffers.js';
import { RegistrationException } from '../../src/client/exceptions/RegistrationException.js';
import type { FragmentHandler } from '../../src/client/logbuffer/FragmentHandler.js';
import { BufferClaim } from '../../src/client/logbuffer/BufferClaim.js';
import { FrameDescriptor } from '../../src/client/logbuffer/FrameDescriptor.js';
import { LogBufferDescriptor } from '../../src/client/logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from '../../src/client/protocol/DataHeaderFlyweight.js';
import type { Publication } from '../../src/client/Publication.js';
import type { Subscription } from '../../src/client/Subscription.js';
import { DebugSendChannelEndpoint } from '../../src/driver/ext/DebugSendChannelEndpoint.js';
import { DebugChannelEndpointConfiguration } from '../../src/driver/ext/DebugChannelEndpointConfiguration.js';
import { MediaDriver } from '../../src/driver/MediaDriver.js';
import { ThreadingMode } from '../../src/driver/ThreadingMode.js';
import type { MemoryLogFactory } from '../../src/driver/buffer/MemoryLogFactory.js';
import { CountersReader } from '../../src/agrona/concurrent/status/CountersReader.js';
import { FragmentRecorder } from '../support/FragmentRecorder.js';
import { mulberry32 } from '../support/Random.js';
import {
    TestMediaDriver,
    newLossReportBuffer,
    systemTests,
    verifyLossOccurredForStream,
} from '../support/SystemTests.js';
import type { SystemTests, TestClient, TestNode } from '../support/SystemTests.js';

const { HEADER_LENGTH } = DataHeaderFlyweight;
const { FRAME_ALIGNMENT } = FrameDescriptor;
const SIZE_OF_INT = BitUtil.SIZE_OF_INT;
const IPC_URI = 'aeron:ipc';
const STREAM_ID = 1001;
const MS = 1_000_000;

const CHANNELS = [
    'aeron:udp?endpoint=localhost:24325',
    'aeron:udp?endpoint=localhost:24325|session=id=55555',
    'aeron:udp?endpoint=224.20.30.39:24326|interface=localhost',
    IPC_URI,
];

const IPC_REASON = 'IPC is not ported (spec section 3, D54)';

/** The cap, in turns, of the loops that Java leaves to `@InterruptAfter`. */
const CAP = 200_000;

/** `RethrowingErrorHandler.INSTANCE` */
const RETHROWING_ERROR_HANDLER: ErrorHandler = {
    onError: (ex) => {
        throw ex;
    },
};

describe('PubAndSubTest', () => {
    let tests: SystemTests;
    let node: TestNode;
    let subscribingClient: TestClient;
    let publishingClient: TestClient;
    let driverSetup: Array<(context: MediaDriver.Context) => void>;
    let subscription: Subscription;
    let publication: Publication;
    let buffer: UnsafeBuffer;
    let fragmentHandler: FragmentRecorder;
    let availableImageHandler: { onAvailableImage: Mock<(image: Image) => void> };
    let unavailableImageHandler: { onUnavailableImage: Mock<(image: Image) => void> };

    /** The `driverContext` fields that a test sets before `launch`, in the order it sets them. */
    function driverContext(set: (context: MediaDriver.Context) => void): void {
        driverSetup.push(set);
    }

    function begin(name: string): void {
        tests = systemTests(name, true);
        driverSetup = [];
        buffer = new UnsafeBuffer(new Uint8Array(8192));
        fragmentHandler = new FragmentRecorder();
        availableImageHandler = { onAvailableImage: vi.fn<(image: Image) => void>() };
        unavailableImageHandler = { onUnavailableImage: vi.fn<(image: Image) => void>() };
        driverContext((context) =>
            context
                .publicationConnectionTimeoutNs(300 * MS)
                .imageLivenessTimeoutNs(500 * MS)
                .timerIntervalNs(10 * MS),
        );
    }

    /**
     * `launch(channel)`; a null channel launches the driver and the two clients only (the tests that Java launches with
     * `aeron:ipc` and then use for UDP channels of their own).
     */
    function launch(channel: string | null): void {
        const configureClient = (context: Aeron.Context): void => {
            context.resourceLingerDurationNs(200 * MS).subscriberErrorHandler(RETHROWING_ERROR_HANDLER);
        };
        node = tests.launch((context) => {
            for (const set of driverSetup) {
                set(context);
            }
        }, configureClient);
        subscribingClient = node.clients[0] as TestClient;
        publishingClient = tests.connect(node, configureClient);
        if (null !== channel) {
            subscription = subscribingClient.aeron.addSubscription(
                channel,
                STREAM_ID,
                availableImageHandler,
                unavailableImageHandler,
            );
            publication = publishingClient.aeron.addPublication(channel, STREAM_ID) as Publication;
        }
    }

    /** The errors of the drivers and clients that the test did not ignore (`watcher.ignoreErrorsMatching`). */
    function unexpectedErrors(ignore: (message: string) => boolean = () => false): string[] {
        return tests
            .errors()
            .map((error) => error.message)
            .filter((message) => !ignore(message));
    }

    /** `while (publication.offer(buffer, 0, length) < 0L) Tests.yield();` */
    function offerMessage(length: number, maxTurns = CAP): Promise<void> {
        return tests.drainUntil(
            () => publication.offer(buffer, 0, length) >= 0,
            maxTurns,
            () => 'a window for ' + length + ' bytes in ' + publication,
        );
    }

    /** `pollForFragment()` */
    function pollForFragment(): Promise<void> {
        return tests.drainUntil(
            () => subscription.poll(fragmentHandler, 10) > 0,
            CAP,
            () => 'a fragment of ' + subscription.channel(),
        );
    }

    /** `pollForBatch(batchSize)` */
    function pollForBatch(batchSize: number): Promise<void> {
        let fragmentsRead = 0;
        return tests.drainUntil(
            () => {
                fragmentsRead += subscription.poll(fragmentHandler, 10);
                return fragmentsRead >= batchSize;
            },
            CAP,
            () => batchSize + ' fragments of ' + subscription.channel() + ' (read ' + fragmentsRead + ')',
        );
    }

    /** `Tests.executeUntil(() -> fragmentsRead.value <cond>, poll and add the fragments, MAX_VALUE, timeout)` */
    async function pollUntil(done: (fragmentsRead: number) => boolean, timeoutNs: number): Promise<void> {
        let fragmentsRead = 0;
        await tests.executeUntil(
            () => done(fragmentsRead),
            () => {
                fragmentsRead += subscription.poll(fragmentHandler, 10);
            },
            0x7fffffff,
            timeoutNs,
        );
    }

    it.for(CHANNELS)('shouldReceivePublishedMessageViaPollFile %s', async (channel, { skip }) => {
        if (IPC_URI === channel) {
            skip(IPC_REASON);
        }
        begin('shouldReceivePublishedMessageViaPollFile');
        const rawBlockHandler = { onBlock: vi.fn() };
        launch(channel);

        buffer.putInt(0, 1);
        await offerMessage(SIZE_OF_INT);

        await tests.drainUntil(
            () => subscription.rawPoll(rawBlockHandler, 0x7fffffff) > 0,
            CAP,
            () => 'a block of ' + subscription.channel(),
        );

        const expectedOffset = 0;
        const expectedLength = BitUtil.align(HEADER_LENGTH + SIZE_OF_INT, FRAME_ALIGNMENT);

        // `verify(rawBlockHandler).onBlock(captor, eq(0L), any(UnsafeBuffer), eq(0), eq(expectedLength), anyInt, anyInt)`
        expect(rawBlockHandler.onBlock).toHaveBeenCalledTimes(1);
        const args = rawBlockHandler.onBlock.mock.calls[0] as unknown[];
        expect(args[1]).toBe(expectedOffset);
        expect(args[2]).toBeInstanceOf(UnsafeBuffer);
        expect(args[3]).toBe(expectedOffset);
        expect(args[4]).toBe(expectedLength);
        expect(typeof args[5]).toBe('number');
        expect(typeof args[6]).toBe('number');
        // `assertTrue(channelArgumentCaptor.getValue().isOpen(), "File Channel is closed")` has no file to check (D4)
        expect(unexpectedErrors()).toEqual([]);
    });

    it.for([1408, 128])('shouldSendAndReceiveMessage %d', async (mtu) => {
        begin('shouldSendAndReceiveMessage');
        launch('aeron:udp?endpoint=localhost:24325|mtu=' + mtu);
        let frameLength = -1;
        let position = -1;

        const payloadLength = 500;
        const handler: FragmentHandler = {
            onFragment: (_buffer, _offset, _length, header) => {
                frameLength = header.frameLength();
                position = header.position();
            },
        };

        const assembler = HEADER_LENGTH + payloadLength < mtu ? handler : new FragmentAssembler(handler);

        await offerMessage(payloadLength);

        await tests.drainUntil(
            () => {
                if (-1 !== frameLength && -1 !== position) {
                    return true;
                }
                subscription.poll(assembler, 10);
                return false;
            },
            CAP,
            () => 'a message of ' + payloadLength + ' bytes',
        );

        expect(frameLength).toBe(HEADER_LENGTH + payloadLength);
        expect(position).toBe(subscription.imageAtIndex(0).position());
        expect(unexpectedErrors()).toEqual([]);
    });

    it.for(CHANNELS)('shouldContinueAfterBufferRollover %s', async (channel, { skip }) => {
        if (IPC_URI === channel) {
            skip(IPC_REASON);
        }
        begin('shouldContinueAfterBufferRollover');
        const termBufferLength = 64 * 1024;
        const numMessagesInTermBuffer = 64;
        const messageLength = termBufferLength / numMessagesInTermBuffer - HEADER_LENGTH;
        const numMessagesToSend = numMessagesInTermBuffer + 1;

        driverContext((context) => context.publicationTermBufferLength(termBufferLength));

        launch(channel);

        for (let i = 0; i < numMessagesToSend; i++) {
            await offerMessage(messageLength);

            await pollForFragment();
        }

        expect(fragmentHandler.count(messageLength)).toBe(numMessagesToSend);
        expect(unexpectedErrors()).toEqual([]);
    });

    it.for(CHANNELS)('shouldContinueAfterRolloverWithMinimalPaddingHeader %s', async (channel, { skip }) => {
        if (IPC_URI === channel) {
            skip(IPC_REASON);
        }
        begin('shouldContinueAfterRolloverWithMinimalPaddingHeader');
        const termBufferLength = 64 * 1024;
        const termBufferLengthMinusPaddingHeader = termBufferLength - HEADER_LENGTH;
        const num1kMessagesInTermBuffer = 63;
        const lastMessageLength = termBufferLengthMinusPaddingHeader - num1kMessagesInTermBuffer * 1024 - HEADER_LENGTH;
        const messageLength = 1024 - HEADER_LENGTH;

        driverContext((context) => context.publicationTermBufferLength(termBufferLength));

        launch(channel);

        // lock step reception until we get to within 8 messages of the end
        for (let i = 0; i < num1kMessagesInTermBuffer - 7; i++) {
            await offerMessage(messageLength);

            await pollForFragment();
        }

        for (let i = 7; i > 0; i--) {
            await offerMessage(messageLength);
        }

        // small enough to leave room for padding that is just a header
        await offerMessage(lastMessageLength);

        // no roll over
        await offerMessage(messageLength);

        let fragmentsRead = 0;

        await tests.executeUntil(
            () => fragmentsRead === 9,
            () => {
                fragmentsRead += subscription.poll(fragmentHandler, 10);
            },
            0x7fffffff,
            500 * MS,
        );

        // `InOrder`: 63 messages of `messageLength`, one of `lastMessageLength`, one of `messageLength`
        expect(fragmentHandler.lengths).toEqual([
            ...new Array<number>(num1kMessagesInTermBuffer).fill(messageLength),
            lastMessageLength,
            messageLength,
        ]);
        expect(unexpectedErrors()).toEqual([]);
    });

    it.for(CHANNELS)(
        'shouldReceivePublishedMessageOneForOneWithDataLoss %s',
        { timeout: 20_000 },
        async (channel, { skip }) => {
            if (IPC_URI === channel) {
                skip(IPC_REASON);
            }
            begin('shouldReceivePublishedMessageOneForOneWithDataLoss');
            const termBufferLength = 64 * 1024;
            const numMessagesInTermBuffer = 64;
            const messageLength = termBufferLength / numMessagesInTermBuffer - HEADER_LENGTH;
            const numMessagesToSend = 2 * numMessagesInTermBuffer;

            const noLossGenerator = DebugChannelEndpointConfiguration.lossGeneratorSupplier(0, 0);
            const loss = newLossReportBuffer();

            driverContext((context) => {
                context.publicationTermBufferLength(termBufferLength).lossReport(loss.report);
                context.sendChannelEndpointSupplier({
                    newInstance: (udpChannel, statusIndicator, ctx) =>
                        new DebugSendChannelEndpoint(
                            udpChannel,
                            statusIndicator,
                            ctx,
                            noLossGenerator,
                            noLossGenerator,
                        ),
                });
                TestMediaDriver.enableRandomLoss(context, 0.1, 0xcafebabe, true, false);
            });

            launch(channel);

            for (let i = 0; i < numMessagesToSend; i++) {
                await offerMessage(messageLength);

                await pollForFragment();
            }

            expect(fragmentHandler.count(messageLength)).toBe(numMessagesToSend);

            expect(verifyLossOccurredForStream(loss.buffer, STREAM_ID)).toBe(true);
            expect(unexpectedErrors()).toEqual([]);
        },
    );

    it.for(CHANNELS)('shouldReceivePublishedMessageBatchedWithDataLoss %s', async (channel, { skip }) => {
        if (IPC_URI === channel) {
            skip(IPC_REASON);
        }
        begin('shouldReceivePublishedMessageBatchedWithDataLoss');
        const termBufferLength = 64 * 1024;
        const numMessagesInTermBuffer = 64;
        const messageLength = termBufferLength / numMessagesInTermBuffer - HEADER_LENGTH;
        const numMessagesToSend = 2 * numMessagesInTermBuffer;
        const numBatches = 4;
        const numMessagesPerBatch = numMessagesToSend / numBatches;

        const noLossGenerator = DebugChannelEndpointConfiguration.lossGeneratorSupplier(0, 0);
        const loss = newLossReportBuffer();

        driverContext((context) => {
            context.publicationTermBufferLength(termBufferLength).lossReport(loss.report);
            context.sendChannelEndpointSupplier({
                newInstance: (udpChannel, statusIndicator, ctx) =>
                    new DebugSendChannelEndpoint(udpChannel, statusIndicator, ctx, noLossGenerator, noLossGenerator),
            });
            TestMediaDriver.enableRandomLoss(context, 0.1, 0xcafebabe, true, false);
        });

        launch(channel);

        for (let i = 0; i < numBatches; i++) {
            for (let j = 0; j < numMessagesPerBatch; j++) {
                await offerMessage(messageLength);
            }

            await pollForBatch(numMessagesPerBatch);
        }

        expect(fragmentHandler.count(messageLength)).toBe(numMessagesToSend);

        expect(verifyLossOccurredForStream(loss.buffer, STREAM_ID)).toBe(true);
        expect(unexpectedErrors()).toEqual([]);
    });

    it.for(CHANNELS)('shouldContinueAfterBufferRolloverBatched %s', async (channel, { skip }) => {
        if (IPC_URI === channel) {
            skip(IPC_REASON);
        }
        begin('shouldContinueAfterBufferRolloverBatched');
        const termBufferLength = 64 * 1024;
        const numBatchesPerTerm = 4;
        const numMessagesPerBatch = 16;
        const numMessagesInTermBuffer = numMessagesPerBatch * numBatchesPerTerm;
        const messageLength = termBufferLength / numMessagesInTermBuffer - HEADER_LENGTH;
        const numMessagesToSend = numMessagesInTermBuffer + 1;

        driverContext((context) => context.publicationTermBufferLength(termBufferLength));

        launch(channel);

        for (let i = 0; i < numBatchesPerTerm; i++) {
            for (let j = 0; j < numMessagesPerBatch; j++) {
                await offerMessage(messageLength);
            }

            await pollForBatch(numMessagesPerBatch);
        }

        await offerMessage(messageLength);

        await pollUntil((fragmentsRead) => fragmentsRead > 0, 900 * MS);

        expect(fragmentHandler.count(messageLength)).toBe(numMessagesToSend);
        expect(unexpectedErrors()).toEqual([]);
    });

    it.for(CHANNELS)('shouldContinueAfterBufferRolloverWithPadding %s', async (channel, { skip }) => {
        if (IPC_URI === channel) {
            skip(IPC_REASON);
        }
        begin('shouldContinueAfterBufferRolloverWithPadding');
        /*
         * 65536 bytes in the buffer
         * 63 * 1032 = 65016
         * 65536 - 65016 = 520 bytes padding at the end
         * so, sending 64 messages causes last to overflow
         */
        const termBufferLength = 64 * 1024;
        const messageLength = 1032 - HEADER_LENGTH;
        const numMessagesToSend = 64;

        driverContext((context) => context.publicationTermBufferLength(termBufferLength));

        launch(channel);

        for (let i = 0; i < numMessagesToSend; i++) {
            await offerMessage(messageLength);

            await pollForFragment();
        }

        expect(fragmentHandler.count(messageLength)).toBe(numMessagesToSend);
        expect(unexpectedErrors()).toEqual([]);
    });

    it.for(CHANNELS)('shouldContinueAfterBufferRolloverWithPaddingBatched %s', async (channel, { skip }) => {
        if (IPC_URI === channel) {
            skip(IPC_REASON);
        }
        begin('shouldContinueAfterBufferRolloverWithPaddingBatched');
        /*
         * 65536 bytes in the buffer
         * 63 * 1032 = 65016
         * 65536 - 65016 = 520 bytes padding at the end
         * so, sending 64 messages causes last to overflow
         */
        const termBufferLength = 64 * 1024;
        const messageLength = 1032 - HEADER_LENGTH;
        const numMessagesToSend = 64;
        const numBatchesPerTerm = 4;
        const numMessagesPerBatch = numMessagesToSend / numBatchesPerTerm;

        driverContext((context) => context.publicationTermBufferLength(termBufferLength));

        launch(channel);

        for (let i = 0; i < numBatchesPerTerm; i++) {
            for (let j = 0; j < numMessagesPerBatch; j++) {
                await offerMessage(messageLength);
            }

            await pollForBatch(numMessagesPerBatch);
        }

        expect(fragmentHandler.count(messageLength)).toBe(numMessagesToSend);
        expect(unexpectedErrors()).toEqual([]);
    });

    it.for(CHANNELS)('shouldReceiveOnlyAfterSendingUpToFlowControlLimit %s', async (channel, { skip }) => {
        if (IPC_URI === channel) {
            skip(IPC_REASON);
        }
        begin('shouldReceiveOnlyAfterSendingUpToFlowControlLimit');
        /*
         * The subscriber will flow control before an entire term buffer. So, send until can't send anymore.
         * Then start up subscriber to drain.
         */
        const termBufferLength = 64 * 1024;
        const numMessagesPerTerm = 64;
        const messageLength = termBufferLength / numMessagesPerTerm - HEADER_LENGTH;
        const maxFails = 10000;
        let messagesSent = 0;

        driverContext((context) => context.publicationTermBufferLength(termBufferLength));

        launch(channel);

        for (let i = 0; i < numMessagesPerTerm; i++) {
            let offerFails = 0;

            // `while (publication.offer(..) < 0L) { if (++offerFails > maxFails) break; Tests.yield(); }`
            while (publication.offer(buffer, 0, messageLength) < 0) {
                if (++offerFails > maxFails) {
                    break;
                }

                tests.cycle();
                await new Promise<void>((resolve) => setImmediate(resolve));
            }

            if (offerFails > maxFails) {
                break;
            }

            messagesSent++;
        }

        const messagesToReceive = messagesSent;

        await pollUntil((fragmentsRead) => fragmentsRead >= messagesToReceive, 500 * MS);

        expect(fragmentHandler.count(messageLength)).toBe(messagesToReceive);
        expect(unexpectedErrors()).toEqual([]);
    });

    it.for(CHANNELS)('shouldReceivePublishedMessageOneForOneWithReSubscription %s', async (channel, { skip }) => {
        if (IPC_URI === channel) {
            skip(IPC_REASON);
        }
        begin('shouldReceivePublishedMessageOneForOneWithReSubscription');
        const termBufferLength = 64 * 1024;
        const numMessagesInTermBuffer = 64;
        const messageLength = termBufferLength / numMessagesInTermBuffer - HEADER_LENGTH;
        const numMessagesToSendStageOne = numMessagesInTermBuffer / 2;

        driverContext((context) => context.publicationTermBufferLength(termBufferLength));

        launch(channel);

        await tests.awaitConnected(subscription);

        for (let i = 0; i < numMessagesToSendStageOne; i++) {
            await offerMessage(messageLength);

            await pollForFragment();
        }

        expect(subscription.imageAtIndex(0).position()).toBe(publication.position());

        subscription.close();
        subscription = await tests.reAddSubscription(subscribingClient.aeron, channel, STREAM_ID);

        await tests.awaitConnected(subscription);

        for (let i = 0; i < numMessagesInTermBuffer; i++) {
            await offerMessage(messageLength);

            await pollForFragment();
        }

        expect(subscription.imageAtIndex(0).position()).toBe(publication.position());
        expect(unexpectedErrors()).toEqual([]);
    });

    it.for(CHANNELS)('shouldFragmentExactMessageLengthsCorrectly %s', async (channel, { skip }) => {
        if (IPC_URI === channel) {
            skip(IPC_REASON);
        }
        begin('shouldFragmentExactMessageLengthsCorrectly');
        const termBufferLength = 64 * 1024;
        const numFragmentsPerMessage = 2;
        const mtuLength = new MediaDriver.Context().mtuLength();
        const frameLength = mtuLength - HEADER_LENGTH;
        const messageLength = frameLength * numFragmentsPerMessage;
        const numMessagesToSend = 2;
        const numFramesToExpect = numMessagesToSend * numFragmentsPerMessage;

        driverContext((context) => context.publicationTermBufferLength(termBufferLength));

        launch(channel);

        for (let i = 0; i < numMessagesToSend; i++) {
            await offerMessage(messageLength);
        }

        await pollUntil((fragmentsRead) => fragmentsRead > numFramesToExpect, 500 * MS);

        expect(fragmentHandler.count(frameLength)).toBe(numFramesToExpect);
        expect(unexpectedErrors()).toEqual([]);
    });

    it.for(CHANNELS)('shouldNoticeDroppedSubscriber %s', async (channel, { skip }) => {
        if (IPC_URI === channel) {
            skip(IPC_REASON);
        }
        begin('shouldNoticeDroppedSubscriber');
        launch(channel);

        await tests.awaitConnected(publication);

        subscription.close();

        await tests.drainUntil(
            () => !publication.isConnected(),
            CAP,
            () => 'a publication that is not connected',
        );
        expect(unexpectedErrors()).toEqual([]);
    });

    it('shouldAllowSubscriptionsIfUsingTagsAndParametersAndAllMatch', async () => {
        begin('shouldAllowSubscriptionsIfUsingTagsAndParametersAndAllMatch');
        launch(null);

        const pubChannel = 'aeron:udp?control-mode=dynamic|control=127.0.0.1:9999';
        const channel = 'aeron:udp?endpoint=127.0.0.1:0|control=127.0.0.1:9999|tags=1001';
        const pub = subscribingClient.aeron.addPublication(pubChannel, 1000) as Publication;
        const sub1 = subscribingClient.aeron.addSubscription(channel, 1000);
        const sub2 = subscribingClient.aeron.addSubscription(channel, 1000);

        await tests.awaitConnected(sub1);
        await tests.awaitConnected(sub2);
        await tests.awaitConnected(pub);
        expect(unexpectedErrors()).toEqual([]);
    });

    it('shouldRejectSubscriptionsIfUsingTagsAndParametersAndEndpointDoesNotMatchEndpointWithExplicitControl', () => {
        begin('shouldRejectSubscriptionsIfUsingTagsAndParametersAndEndpointDoesNotMatchEndpointWithExplicitControl');
        launch(null);

        const builder = new ChannelUriStringBuilder('aeron:udp?endpoint=127.0.0.1:0|control=127.0.0.1:9999|tags=1001');

        const ignore1 = subscribingClient.aeron.addSubscription(builder.build(), 1000);
        expect(ignore1).not.toBeNull();
        expect(() => subscribingClient.aeron.addSubscription(builder.endpoint('127.0.0.1:9999').build(), 1000)).toThrow(
            RegistrationException,
        );
        expect(() => subscribingClient.aeron.addSubscription(builder.endpoint('127.0.0.2:0').build(), 1000)).toThrow(
            RegistrationException,
        );
        expect(unexpectedErrors((s) => s.includes('has mismatched endpoint or control'))).toEqual([]);
    });

    it('shouldRejectSubscriptionsIfUsingTagsAndParametersAndEndpointDoesNotMatchEndpointWithoutControl', () => {
        begin('shouldRejectSubscriptionsIfUsingTagsAndParametersAndEndpointDoesNotMatchEndpointWithoutControl');
        launch(null);

        const builder = new ChannelUriStringBuilder('aeron:udp?endpoint=127.0.0.1:9999|tags=1001');

        const ignore1 = subscribingClient.aeron.addSubscription(builder.build(), 1000);
        expect(ignore1).not.toBeNull();
        expect(() => subscribingClient.aeron.addSubscription(builder.endpoint('127.0.0.1:0').build(), 1000)).toThrow(
            RegistrationException,
        );
        expect(() => subscribingClient.aeron.addSubscription(builder.endpoint('127.0.0.2:9999').build(), 1000)).toThrow(
            RegistrationException,
        );
        expect(unexpectedErrors((s) => s.includes('has mismatched endpoint or control'))).toEqual([]);
    });

    it('shouldRejectSubscriptionsIfUsingTagsAndParametersAndEndpointDoesNotMatchControl', () => {
        begin('shouldRejectSubscriptionsIfUsingTagsAndParametersAndEndpointDoesNotMatchControl');
        launch(null);

        const builder = new ChannelUriStringBuilder('aeron:udp?endpoint=127.0.0.1:0|control=127.0.0.1:9999|tags=1001');

        const ignore1 = subscribingClient.aeron.addSubscription(builder.build(), 1000);
        expect(ignore1).not.toBeNull();
        expect(() =>
            subscribingClient.aeron.addSubscription(builder.controlEndpoint('127.0.0.1:10000').build(), 1000),
        ).toThrow(RegistrationException);
        expect(() =>
            subscribingClient.aeron.addSubscription(builder.controlEndpoint('127.0.0.2:9999').build(), 1000),
        ).toThrow(RegistrationException);
        expect(unexpectedErrors((s) => s.includes('has mismatched endpoint or control'))).toEqual([]);
    });

    it('shouldRejectSubscriptionsIfUsingTagsAndParametersAndEndpointDoesNotMatchSocketReceiveBufferLength', () => {
        begin('shouldRejectSubscriptionsIfUsingTagsAndParametersAndEndpointDoesNotMatchSocketReceiveBufferLength');
        launch(null);

        const builder = new ChannelUriStringBuilder(
            'aeron:udp?endpoint=127.0.0.1:0|control=127.0.0.1:9999|so-rcvbuf=128K|tags=1001',
        );

        const ignore1 = subscribingClient.aeron.addSubscription(builder.build(), 1000);
        expect(ignore1).not.toBeNull();
        expect(() =>
            subscribingClient.aeron.addSubscription(builder.socketRcvbufLength(64 * 1024).build(), 1000),
        ).toThrow(RegistrationException);
        // `watcher.ignoreErrorsMatching((s) -> true)`
    });

    it('shouldAllowPublicationsIfUsingTagsAndParametersAndAllMatch', () => {
        begin('shouldAllowPublicationsIfUsingTagsAndParametersAndAllMatch');
        launch(null);

        const channel = 'aeron:udp?endpoint=127.0.0.1:9999|control=127.0.0.1:0|tags=1001';
        const ignore1 = subscribingClient.aeron.addPublication(channel, 1000);
        const ignore2 = subscribingClient.aeron.addPublication(channel, 1000);
        expect(ignore1).not.toBeNull();
        expect(ignore2).not.toBeNull();
        expect(unexpectedErrors()).toEqual([]);
    });

    it('shouldRejectPublicationsIfUsingTagsAndParametersAndEndpointDoesNotMatchEndpointWithExplicitControl', () => {
        begin('shouldRejectPublicationsIfUsingTagsAndParametersAndEndpointDoesNotMatchEndpointWithExplicitControl');
        launch(null);

        const builder = new ChannelUriStringBuilder('aeron:udp?endpoint=127.0.0.1:10000|control=127.0.0.1:0|tags=1001');

        const ignore1 = subscribingClient.aeron.addPublication(builder.build(), 1000);
        expect(ignore1).not.toBeNull();
        expect(() => subscribingClient.aeron.addPublication(builder.endpoint('127.0.0.1:9999').build(), 1000)).toThrow(
            RegistrationException,
        );
        expect(() => subscribingClient.aeron.addPublication(builder.endpoint('127.0.0.2:10000').build(), 1000)).toThrow(
            RegistrationException,
        );
        expect(unexpectedErrors((s) => s.includes('has mismatched endpoint or control'))).toEqual([]);
    });

    it('shouldRejectPublicationsIfUsingTagsAndParametersAndEndpointDoesNotMatchEndpointWithoutControl', () => {
        begin('shouldRejectPublicationsIfUsingTagsAndParametersAndEndpointDoesNotMatchEndpointWithoutControl');
        launch(null);

        const builder = new ChannelUriStringBuilder('aeron:udp?endpoint=127.0.0.1:10000|tags=1001');

        const ignore1 = subscribingClient.aeron.addSubscription(builder.build(), 1000);
        expect(ignore1).not.toBeNull();
        expect(() => subscribingClient.aeron.addSubscription(builder.endpoint('127.0.0.1:9999').build(), 1000)).toThrow(
            RegistrationException,
        );
        expect(() =>
            subscribingClient.aeron.addSubscription(builder.endpoint('127.0.0.2:10000').build(), 1000),
        ).toThrow(RegistrationException);
        expect(unexpectedErrors((s) => s.includes('has mismatched endpoint or control'))).toEqual([]);
    });

    it('shouldRejectPublicationsIfUsingTagsAndParametersAndEndpointDoesNotMatchControl', () => {
        begin('shouldRejectPublicationsIfUsingTagsAndParametersAndEndpointDoesNotMatchControl');
        launch(null);

        const builder = new ChannelUriStringBuilder('aeron:udp?endpoint=127.0.0.1:10000|control=127.0.0.1:0|tags=1001');

        const ignore1 = subscribingClient.aeron.addPublication(builder.build(), 1000);
        expect(ignore1).not.toBeNull();
        expect(() =>
            subscribingClient.aeron.addPublication(builder.controlEndpoint('127.0.0.1:10000').build(), 1000),
        ).toThrow(RegistrationException);
        expect(() =>
            subscribingClient.aeron.addPublication(builder.controlEndpoint('127.0.0.2:0').build(), 1000),
        ).toThrow(RegistrationException);
        expect(unexpectedErrors((s) => s.includes('has mismatched endpoint or control'))).toEqual([]);
    });

    it('shouldRejectPublicationsIfUsingTagsAndParametersAndMtuDoesNotMatch', () => {
        begin('shouldRejectPublicationsIfUsingTagsAndParametersAndMtuDoesNotMatch');
        launch(null);

        const builder = new ChannelUriStringBuilder(
            'aeron:udp?endpoint=127.0.0.1:10000|control=127.0.0.1:0|mtu=1408|tags=1001',
        );

        const ignore1 = subscribingClient.aeron.addPublication(builder.build(), 1000);
        expect(ignore1).not.toBeNull();
        expect(() => subscribingClient.aeron.addPublication(builder.mtu(8192).build(), 1000)).toThrow(
            RegistrationException,
        );
        // `watcher.ignoreErrorsMatching((s) -> true)`
    });

    // The four assemblers of `fragmentAssemblers()` over `aeron:ipc?mtu=2048|term-length=64K|init-term-id=5|term-id=13|
    // term-offset=...`: the test publishes frames of the header types `HDR_TYPE_RSP_SETUP` and `HDR_TYPE_SM` through a
    // `BufferClaim`, which only a log that the subscriber reads directly (IPC) delivers; a UDP receiver drops them.
    it.skip('shouldReturnCompleteHeaderForAssembledMessages', () => {});

    it.for(CHANNELS)('shouldMarkPublicationNotConnectedWhenItLoosesAllSubscribers %s', async (channel, { skip }) => {
        if (IPC_URI === channel) {
            skip(IPC_REASON);
        }
        begin('shouldMarkPublicationNotConnectedWhenItLoosesAllSubscribers');
        driverContext((context) => context.timerIntervalNs(1500 * MS).publicationConnectionTimeoutNs(2000 * MS));
        launch(channel);
        await tests.awaitConnected(publication);
        await tests.awaitConnected(subscription);

        const random = mulberry32(42);
        const claimLength = 1 + Math.floor(random() * 999);
        const bufferClaim = new BufferClaim();
        await tests.drainUntil(
            () => publication.tryClaim(claimLength, bufferClaim) >= 0,
            CAP,
            () => 'a claim of ' + claimLength,
        );
        const msgLength = bufferClaim.length();
        const fill = Math.floor(random() * 256);
        for (let i = 0; i < msgLength; i++) {
            bufferClaim.buffer().putByte(bufferClaim.offset() + i, fill);
        }
        bufferClaim.commit();

        let received = false;
        const handler: FragmentHandler = {
            onFragment: (_buffer, _offset, length) => {
                received = true;
                expect(length).toBe(msgLength);
            },
        };
        await tests.drainUntil(
            () => subscription.poll(handler, 1) > 0,
            CAP,
            () => 'the message',
        );
        expect(received).toBe(true);

        subscription.close();

        const clock = tests.clock as NonNullable<typeof tests.clock>;
        const startNs = clock.nanoTime();
        await tests.drainUntil(
            () => !publication.isConnected(),
            CAP,
            () => 'a publication that is not connected',
        );
        const durationNs = clock.nanoTime() - startNs;
        expect(durationNs).toBeLessThan(node.driver.context().timerIntervalNs() / 2);
        expect(unexpectedErrors()).toEqual([]);
    });

    it.for(CHANNELS)('shouldCleanupImagesWhenPublicationIsClosed %s', async (channel, { skip }) => {
        if (IPC_URI === channel) {
            skip(IPC_REASON);
        }
        begin('shouldCleanupImagesWhenPublicationIsClosed');
        let unavailableCount = 0;
        unavailableImageHandler.onUnavailableImage.mockImplementation(() => void unavailableCount++);

        launch(channel);
        const sub2 = subscribingClient.aeron.addSubscription(
            channel,
            STREAM_ID,
            availableImageHandler,
            unavailableImageHandler,
        );
        await tests.awaitConnected(publication);
        await tests.awaitConnected(subscription);
        await tests.awaitConnected(sub2);

        const bufferClaim = new BufferClaim();
        const msgLength = 555;
        await tests.drainUntil(
            () => publication.tryClaim(msgLength, bufferClaim) >= 0,
            CAP,
            () => 'a claim of ' + msgLength,
        );
        for (let i = 0; i < msgLength; i++) {
            bufferClaim.buffer().putByte(bufferClaim.offset() + i, 0xff);
        }
        bufferClaim.commit();

        const image = subscription.imageAtIndex(0);
        const image2 = sub2.imageAtIndex(0);
        expect(image).not.toBe(image2);
        expect(image2.correlationId()).toBe(image.correlationId());

        await tests.drainUntil(
            () => 0 !== image.poll(fragmentHandler, 1) && 0 !== image2.poll(fragmentHandler, 1),
            CAP,
            () => 'the message in both images',
        );
        // `verify(fragmentHandler, times(2)).onFragment(any, eq(HEADER_LENGTH), eq(msgLength), any)`
        expect(
            fragmentHandler.offsets.filter((o, i) => o === HEADER_LENGTH && fragmentHandler.lengths[i] === msgLength),
        ).toHaveLength(2);

        const logFactory = node.driver.context().logFactory() as MemoryLogFactory;
        const pubLogBuffer = 'publications/' + publication.registrationId() + '.logbuffer';
        const imageLogBuffer = 'images/' + image.correlationId() + '.logbuffer';
        expect(logFactory.lookup(pubLogBuffer)).not.toBeNull();
        expect(logFactory.lookup(imageLogBuffer)).not.toBeNull();

        publication.close();

        await tests.drainUntil(
            () => 2 === unavailableCount,
            CAP,
            () => 'both images unavailable (' + unavailableCount + ')',
        );
        expect(subscription.imageCount()).toBe(0);
        expect(sub2.imageCount()).toBe(0);

        await tests.drainUntil(
            () => null === logFactory.lookup(pubLogBuffer) && null === logFactory.lookup(imageLogBuffer),
            CAP,
            () => 'the logs of the publication and the image freed',
        );
        expect(logFactory.lookup(pubLogBuffer)).toBeNull();
        expect(logFactory.lookup(imageLogBuffer)).toBeNull();
        expect(unexpectedErrors()).toEqual([]);
    });

    it.for(CHANNELS)('shouldAssignOwnerIdForEachStreamCounter %s', async (channel, { skip }) => {
        if (IPC_URI === channel) {
            skip(IPC_REASON);
        }
        begin('shouldAssignOwnerIdForEachStreamCounter');
        launch(channel);
        await tests.awaitConnected(publication);
        await tests.awaitConnected(subscription);

        const countersReader = subscribingClient.aeron.countersReader();
        verifyStreamCounters(countersReader, subscription.registrationId(), subscribingClient.aeron.clientId());

        verifyStreamCounters(countersReader, publication.registrationId(), publishingClient.aeron.clientId());
        expect(unexpectedErrors()).toEqual([]);
    });

    it.for(CHANNELS)('shouldReflectPublicationTypeInTheCountersAndLogMetadata %s', async (channel, { skip }) => {
        if (IPC_URI === channel) {
            skip(IPC_REASON);
        }
        begin('shouldReflectPublicationTypeInTheCountersAndLogMetadata');
        launch(channel);

        const exclusivePublication = publishingClient.aeron.addExclusivePublication(
            channel,
            STREAM_ID + 1,
        ) as ExclusivePublication;
        await tests.awaitConnected(publication);
        await tests.awaitConnected(subscription);

        const countersReader = subscribingClient.aeron.countersReader();
        const concurrentPubPosCounterId = countersReader.findByTypeIdAndRegistrationId(
            AeronCounters.DRIVER_PUBLISHER_POS_TYPE_ID,
            publication.registrationId(),
        );
        expect(countersReader.getCounterLabel(concurrentPubPosCounterId).startsWith('pub-pos (concurrent): ')).toBe(
            true,
        );
        const exclusivePubPosCounterId = countersReader.findByTypeIdAndRegistrationId(
            AeronCounters.DRIVER_PUBLISHER_POS_TYPE_ID,
            exclusivePublication.registrationId(),
        );
        expect(countersReader.getCounterLabel(exclusivePubPosCounterId).startsWith('pub-pos (exclusive): ')).toBe(true);

        verifyLogBufferType(
            publication.registrationId(),
            'publications',
            LogBufferDescriptor.LOG_BUFFER_TYPE_CONCURRENT_PUBLICATION,
        );
        verifyLogBufferType(
            exclusivePublication.registrationId(),
            'publications',
            LogBufferDescriptor.LOG_BUFFER_TYPE_EXCLUSIVE_PUBLICATION,
        );

        if (ChannelUri.parse(channel).isUdp()) {
            const image = subscription.imageBySessionId(publication.sessionId()) as Image;
            verifyLogBufferType(image.correlationId(), 'images', LogBufferDescriptor.LOG_BUFFER_TYPE_PUBLICATION_IMAGE);
        }
        expect(unexpectedErrors()).toEqual([]);
    });

    it.for(ThreadingMode.values())('shouldSharePublicationImagesBetweenSubscriptions %s', async (threadingMode) => {
        // `INVOKER` is the one mode the driver of this port has (spec D3); the other modes launch it as `INVOKER` too
        begin('shouldSharePublicationImagesBetweenSubscriptions');
        await testImageSharing(threadingMode, 'aeron:udp?term-length=64k|endpoint=localhost:20802', 12345);
        expect(unexpectedErrors()).toEqual([]);
    });

    // `testImageSharing` for `aeron:ipc?term-length=64k`: the log buffer of an IPC publication is the one the subscriber reads.
    it.skip('shouldShareLogBufferForIpc', () => {});

    async function testImageSharing(threadingMode: ThreadingMode, channel: string, streamId: number): Promise<void> {
        driverContext((context) =>
            context
                .threadingMode(threadingMode)
                .publicationReservedSessionIdLow(0)
                .publicationReservedSessionIdHigh(1000),
        );
        launch(null);
        const data = new Uint8Array(8192);
        buffer = new UnsafeBuffer(data);
        const random = mulberry32(777);

        const sub1 = subscribingClient.aeron.addSubscription(channel, streamId);
        const pub1 = publishingClient.aeron.addPublication(channel, streamId) as Publication;
        const pub2 = subscribingClient.aeron.addPublication(channel, streamId) as Publication;
        expect(pub2.registrationId()).not.toBe(pub1.registrationId());
        expect(pub2.originalRegistrationId()).toBe(pub1.registrationId());
        expect(pub2.sessionId()).toBe(pub1.sessionId());

        await tests.drainUntil(
            () => pub1.isConnected() && pub2.isConnected() && sub1.isConnected(),
            CAP,
            () => 'connected publications and subscription',
        );

        const pubCounters = publishingClient.aeron.countersReader();
        const pub1LimitCounterId = pubCounters.findByTypeIdAndRegistrationId(
            AeronCounters.DRIVER_PUBLISHER_LIMIT_TYPE_ID,
            pub1.registrationId(),
        );
        expect(pub1LimitCounterId).not.toBe(CountersReader.NULL_COUNTER_ID);
        await tests.drainUntil(
            () => 0 !== pubCounters.getCounterValue(pub1LimitCounterId),
            CAP,
            () => 'a publisher limit',
        );

        const publishRandomData = async (pub: Publication): Promise<void> => {
            for (let i = 0; i < data.length; i++) {
                data[i] = Math.floor(random() * 256);
            }
            tests.cycle();
            await tests.drainUntil(
                () => pub.offer(buffer) >= 0,
                CAP,
                () => 'a window to offer random data',
            );
        };

        await publishRandomData(pub1);

        const sub1Img1 = sub1.imageBySessionId(pub1.sessionId()) as Image;
        expect(sub1Img1.joinPosition()).toBe(0);
        const fragmentHandler: FragmentHandler = {
            onFragment: (bytes: DirectBuffer, offset: number, length: number) => {
                expect(length).toBe(data.length);
                for (let i = 0; i < length; i++) {
                    if (data[i] !== bytes.getByte(offset + i) + (bytes.getByte(offset + i) < 0 ? 256 : 0)) {
                        expect.unreachable('byte ' + i + ' differs');
                    }
                }
            },
        };
        const messageAssembler1 = new ImageFragmentAssembler(fragmentHandler);
        const pollImageFully = (image: Image, pub: Publication, handler: ImageFragmentAssembler): Promise<void> =>
            tests.drainUntil(
                () => {
                    if (image.position() >= pub.position()) {
                        return true;
                    }
                    image.poll(handler, 1);
                    return false;
                },
                CAP,
                () => 'the image to reach ' + pub.position() + ' (at ' + image.position() + ')',
            );
        await pollImageFully(sub1Img1, pub1, messageAssembler1);
        expect(sub1Img1.position()).toBe(pub1.position());

        const positionMsg2 = pub1.position();

        await publishRandomData(pub2);
        await pollImageFully(sub1Img1, pub2, messageAssembler1);
        expect(sub1Img1.position()).toBe(pub2.position());
        expect(pub1.position()).toBe(pub2.position());

        await tests.drainUntil(
            () => pubCounters.getCounterValue(pub1LimitCounterId) > positionMsg2 + pub1.termBufferLength() / 2,
            CAP,
            () => 'the publisher limit to pass half a term',
        );

        const sub2 = subscribingClient.aeron.addSubscription(
            ChannelUri.addSessionId(channel, pub1.sessionId()),
            streamId,
        );
        await tests.drainUntil(
            () => sub2.isConnected(),
            CAP,
            () => 'a connected subscription 2',
        );

        const messageAssembler2 = new ImageFragmentAssembler(fragmentHandler);
        const sub2Img1 = sub2.imageBySessionId(pub1.sessionId()) as Image;
        expect(sub2Img1.joinPosition()).toBeGreaterThan(positionMsg2);
        expect(sub2Img1.joinPosition()).toBeLessThanOrEqual(pub1.position());
        expect(sub2Img1).not.toBe(sub1Img1);
        expect(sub2Img1.correlationId()).toBe(sub1Img1.correlationId());

        await publishRandomData(pub1);

        await pollImageFully(sub1Img1, pub1, messageAssembler1);
        await pollImageFully(sub2Img1, pub1, messageAssembler2);

        expect(sub1Img1.position()).toBe(pub1.position());
        expect(sub2Img1.position()).toBe(pub1.position());

        const channelUri = ChannelUri.parse(channel);
        channelUri.put('session-id', '42');
        const initialPosition = 1024 * 1024 * 1024 * 1024 * 17;
        channelUri.initialPosition(initialPosition, 555, 128 * 1024);
        const pub3 = publishingClient.aeron.addExclusivePublication(
            channelUri.toString(),
            streamId,
        ) as ExclusivePublication;
        expect(pub3.position()).toBe(initialPosition);

        let sub1Img2: Image | null = null;
        await tests.drainUntil(
            () => {
                sub1Img2 = sub1.imageBySessionId(pub3.sessionId());
                return null !== sub1Img2;
            },
            CAP,
            () => 'an image of the publication 3',
        );
        const image2 = sub1Img2 as unknown as Image;
        expect(image2.joinPosition()).toBe(pub3.position());
        expect(image2.position()).toBe(pub3.position());

        expect(sub1.imageCount()).toBe(2);
        expect(image2.correlationId()).not.toBe(sub1Img1.correlationId());

        await publishRandomData(pub3);
        await pollImageFully(image2, pub3, messageAssembler1);

        verifyLogBufferType(
            pub1.registrationId(),
            'publications',
            LogBufferDescriptor.LOG_BUFFER_TYPE_CONCURRENT_PUBLICATION,
        );
        verifyLogBufferType(
            pub3.registrationId(),
            'publications',
            LogBufferDescriptor.LOG_BUFFER_TYPE_EXCLUSIVE_PUBLICATION,
        );
        if (ChannelUri.parse(channel).isUdp()) {
            verifyLogBufferType(
                sub1Img1.correlationId(),
                'images',
                LogBufferDescriptor.LOG_BUFFER_TYPE_PUBLICATION_IMAGE,
            );
            verifyLogBufferType(
                image2.correlationId(),
                'images',
                LogBufferDescriptor.LOG_BUFFER_TYPE_PUBLICATION_IMAGE,
            );
        }
    }

    function verifyLogBufferType(registrationId: number, dir: string, expectedType: number): void {
        const logBuffers = new LogBuffers(
            dir + '/' + registrationId + '.logbuffer',
            node.driver.context().logFactory() as MemoryLogFactory,
        );
        try {
            expect(LogBufferDescriptor.type(logBuffers.metaDataBuffer())).toBe(expectedType);
        } finally {
            logBuffers.close();
        }
    }

    function verifyStreamCounters(countersReader: CountersReader, registrationId: number, clientId: number): void {
        countersReader.forEach((counterId: number, label: string) => {
            const typeId = countersReader.getCounterTypeId(counterId);
            if (
                ((typeId >= AeronCounters.DRIVER_PUBLISHER_LIMIT_TYPE_ID &&
                    typeId <= AeronCounters.DRIVER_RECEIVER_POS_TYPE_ID) ||
                    AeronCounters.DRIVER_SENDER_LIMIT_TYPE_ID === typeId ||
                    AeronCounters.DRIVER_PUBLISHER_POS_TYPE_ID === typeId ||
                    AeronCounters.DRIVER_SENDER_BPE_TYPE_ID === typeId ||
                    AeronCounters.DRIVER_SENDER_NAKS_RECEIVED_TYPE_ID === typeId ||
                    AeronCounters.DRIVER_RECEIVER_NAKS_SENT_TYPE_ID === typeId) &&
                countersReader.getCounterRegistrationId(counterId) === registrationId
            ) {
                expect(countersReader.getCounterOwnerId(counterId), label).toBe(clientId);
            }
        });
    }
});
