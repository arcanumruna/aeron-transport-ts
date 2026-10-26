// Channel endpoint suppliers of the loss tests (T22, spec D60 to D63): the debug endpoints of `io.aeron.driver.ext` with the
// loss generators the test gives them, where the suppliers of the port read the rates and seeds from system properties
// when the module loads (the same classes, for a test that sets its own generators).
import type { AtomicCounter } from '../../src/agrona/concurrent/status/AtomicCounter.js';
import type { DataPacketDispatcher } from '../../src/driver/DataPacketDispatcher.js';
import { DebugReceiveChannelEndpoint } from '../../src/driver/ext/DebugReceiveChannelEndpoint.js';
import { DebugSendChannelEndpoint } from '../../src/driver/ext/DebugSendChannelEndpoint.js';
import type { LossGenerator } from '../../src/driver/ext/LossGenerator.js';
import type { MediaDriverContext } from '../../src/driver/MediaDriver.js';
import type { ReceiveChannelEndpoint } from '../../src/driver/media/ReceiveChannelEndpoint.js';
import type { SendChannelEndpoint } from '../../src/driver/media/SendChannelEndpoint.js';
import type { UdpChannel } from '../../src/driver/media/UdpChannel.js';
import type { ReceiveChannelEndpointSupplier } from '../../src/driver/ReceiveChannelEndpointSupplier.js';
import type { SendChannelEndpointSupplier } from '../../src/driver/SendChannelEndpointSupplier.js';

/** Never drops. */
export const NO_LOSS: LossGenerator = {
    shouldDropFrame(): boolean {
        return false;
    },
};

/** `DebugSendChannelEndpoint`s with the given generators: `data` for what the sender sends, `control` for SMs, NAKs it gets. */
export class LossySendSupplier implements SendChannelEndpointSupplier {
    private readonly data: LossGenerator;
    private readonly control: LossGenerator;
    public constructor(data: LossGenerator, control: LossGenerator = NO_LOSS) {
        this.data = data;
        this.control = control;
    }

    public newInstance(
        udpChannel: UdpChannel,
        statusIndicator: AtomicCounter,
        context: MediaDriverContext,
    ): SendChannelEndpoint {
        return new DebugSendChannelEndpoint(udpChannel, statusIndicator, context, this.data, this.control);
    }
}

/** `DebugReceiveChannelEndpoint`s: `data` for the setup and data frames it gets, `control` for the SMs and NAKs it sends. */
export class LossyReceiveSupplier implements ReceiveChannelEndpointSupplier {
    private readonly data: LossGenerator;
    private readonly control: LossGenerator;
    public constructor(data: LossGenerator, control: LossGenerator = NO_LOSS) {
        this.data = data;
        this.control = control;
    }

    public newInstance(
        udpChannel: UdpChannel,
        dispatcher: DataPacketDispatcher,
        statusIndicator: AtomicCounter,
        context: MediaDriverContext,
    ): ReceiveChannelEndpoint {
        return new DebugReceiveChannelEndpoint(
            udpChannel,
            dispatcher,
            statusIndicator,
            context,
            this.data,
            this.control,
        );
    }
}

/**
 * Drops the first `count` frames of the short form (setup and RTT measurement on the receive side, a frame of the sender on
 * the send side) and then none; the long form (data frames) is never dropped. Counts what it dropped.
 */
export class DropFirstFrames implements LossGenerator {
    public dropped = 0;

    private readonly count: number;
    public constructor(count: number) {
        this.count = count;
    }

    public shouldDropFrame(_address: unknown, _buffer: unknown, _streamId: number, sessionId?: number): boolean {
        if (undefined === sessionId && this.dropped < this.count) {
            this.dropped++;
            return true;
        }

        return false;
    }
}

/** A generator that counts the frames it saw and the ones the generator it wraps dropped. */
export class Counting implements LossGenerator {
    public seen = 0;
    public dropped = 0;

    private readonly inner: LossGenerator;
    public constructor(inner: LossGenerator) {
        this.inner = inner;
    }

    public shouldDropFrame(
        address: never,
        buffer: never,
        streamId: number,
        sessionId?: number,
        termId?: number,
        termOffset?: number,
        length?: number,
    ): boolean {
        this.seen++;
        const drop = this.inner.shouldDropFrame(
            address,
            buffer,
            streamId,
            sessionId as number,
            termId as number,
            termOffset as number,
            length as number,
        );
        if (drop) {
            this.dropped++;
        }

        return drop;
    }
}
