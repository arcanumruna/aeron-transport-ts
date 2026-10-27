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
// Port of io/aeron/Aeron.java @ 1.53.3
import { ExpandableArrayBuffer } from '../agrona/ExpandableArrayBuffer.js';
import { CloseHelper } from '../agrona/CloseHelper.js';
import { AgentInvoker } from '../agrona/concurrent/AgentInvoker.js';
import { AgentRunner } from '../agrona/concurrent/AgentRunner.js';
import { BroadcastReceiver } from '../agrona/concurrent/broadcast/BroadcastReceiver.js';
import { CopyBroadcastReceiver } from '../agrona/concurrent/broadcast/CopyBroadcastReceiver.js';
import type { EpochClock } from '../agrona/concurrent/EpochClock.js';
import type { IdleStrategy } from '../agrona/concurrent/IdleStrategy.js';
import type { NanoClock } from '../agrona/concurrent/NanoClock.js';
import { NoOpLock, type Lock } from '../agrona/concurrent/NoOpLock.js';
import { ManyToOneRingBuffer } from '../agrona/concurrent/ringbuffer/ManyToOneRingBuffer.js';
import type { RingBuffer } from '../agrona/concurrent/ringbuffer/RingBuffer.js';
import { SleepingMillisIdleStrategy } from '../agrona/concurrent/SleepingMillisIdleStrategy.js';
import { SystemEpochClock } from '../agrona/concurrent/SystemEpochClock.js';
import { SystemNanoClock } from '../agrona/concurrent/SystemNanoClock.js';
import type { CountersReader } from '../agrona/concurrent/status/CountersReader.js';
import type { UnsafeBuffer } from '../agrona/concurrent/UnsafeBuffer.js';
import type { ErrorHandler } from '../agrona/ErrorHandler.js';
import { TimeUnit } from '../agrona/jdk.js';
import { ReentrantLock, System, type AutoCloseable } from '../agrona/jdkLang.js';
import { SystemErr, printStackTrace, type PrintStream } from '../agrona/jdkThrowable.js';
import { Strings } from '../agrona/Strings.js';
import { SystemUtil } from '../agrona/SystemUtil.js';
import { hostsToLookUp, lookUpHost } from '../driver/HostNameLookup.js';
import type { MediaDriver } from '../driver/MediaDriver.js';
import type { AvailableImageHandler } from './AvailableImageHandler.js';
import { CncFileDescriptor } from './CncFileDescriptor.js';
import { ClientConductor } from './ClientConductor.js';
import { CommonContext } from './CommonContext.js';
import type { ConcurrentPublication } from './ConcurrentPublication.js';
import { DriverProxy } from './DriverProxy.js';
import { ConcurrentConcludeException } from './exceptions/ConcurrentConcludeException.js';
import { AeronException } from './exceptions/AeronException.js';
import { ConfigurationException } from './exceptions/ConfigurationException.js';
import { DriverTimeoutException } from './exceptions/DriverTimeoutException.js';
import type { ExclusivePublication } from './ExclusivePublication.js';
import type { LogBuffersFactory } from './LogBuffersFactory.js';
import { MemoryLogBuffersFactory } from './MemoryLogBuffersFactory.js';
import { NULL_VALUE } from './NullValue.js';
import { PublicationErrorFrameHandler } from './PublicationErrorFrameHandler.js';
import type { Subscription } from './Subscription.js';
import type { UnavailableImageHandler } from './UnavailableImageHandler.js';
import type { LogLookup } from './LogBuffers.js';

/**
 * Configuration options for the client: the nested class `Aeron.Configuration`. The `@Config` annotations that Java
 * puts on the members are documentation for its configuration tooling and are not ported.
 */
export class AeronConfiguration {
    private constructor() {}

    /**
     * Default sleep of the idle strategy of the conductor, in milliseconds.
     */
    public static readonly IDLE_SLEEP_DEFAULT_MS = 16;

    /**
     * Duration to sleep in the idle strategy while awaiting a response from the driver, in milliseconds.
     */
    public static readonly AWAITING_IDLE_SLEEP_MS = 1;

    /**
     * Duration in nanoseconds for which the conductor will sleep when idle.
     */
    public static readonly IDLE_SLEEP_DURATION_PROP_NAME = 'aeron.client.idle.sleep.duration';

    /**
     * Default duration in nanoseconds for which the conductor will sleep when idle.
     */
    public static readonly IDLE_SLEEP_DEFAULT_NS = TimeUnit.MILLISECONDS.toNanos(
        AeronConfiguration.IDLE_SLEEP_DEFAULT_MS,
    );

    /**
     * Interval in nanoseconds between keepalives to the driver.
     */
    public static readonly KEEPALIVE_INTERVAL_NS = TimeUnit.MILLISECONDS.toNanos(500);

    /**
     * Duration to wait while lingering an entity such as an {@link Image} before deleting resources associated with it.
     */
    public static readonly RESOURCE_LINGER_DURATION_PROP_NAME = 'aeron.client.resource.linger.duration';

    /**
     * Default duration to wait while lingering an entity such as an {@link Image} before deleting resources
     * associated with it.
     */
    public static readonly RESOURCE_LINGER_DURATION_DEFAULT_NS = TimeUnit.SECONDS.toNanos(3);

    /**
     * Duration to wait while lingering after the client is closed. Java sleeps; here it is only a setting (spec D94).
     */
    public static readonly CLOSE_LINGER_DURATION_PROP_NAME = 'aeron.client.close.linger.duration';

    /**
     * Default duration to linger after the client is closed.
     */
    public static readonly CLOSE_LINGER_DURATION_DEFAULT_NS = 0;

    /**
     * Should memory-mapped files be pre-touched so that they are already faulted into a process to avoid latency
     * on first use?
     */
    public static readonly PRE_TOUCH_MAPPED_MEMORY_PROP_NAME = 'aeron.pre.touch.mapped.memory';

    /**
     * Default for if a memory-mapped filed should be pre-touched to fault it into a process.
     */
    public static readonly PRE_TOUCH_MAPPED_MEMORY_DEFAULT = false;

    /**
     * The name of the client, used in the label of the heartbeat counter.
     */
    public static readonly CLIENT_NAME_PROP_NAME = 'aeron.client.name';

    /**
     * Maximum length of a client name.
     */
    public static readonly MAX_CLIENT_NAME_LENGTH = 100;

    /**
     * The default handler for errors: it prints the error to the standard error stream. For a
     * {@link DriverTimeoutException} Java also exits the process (`Runtime.exit(-1)`); a library here does not (spec D93).
     */
    public static readonly DEFAULT_ERROR_HANDLER: ErrorHandler = {
        onError(throwable: Error): void {
            SystemErr.println(Date.now() + ' Exception:');
            printStackTrace(throwable, SystemErr);

            if (throwable instanceof DriverTimeoutException) {
                SystemErr.println('');
                SystemErr.println('***');
                SystemErr.println('*** Media Driver timeout - is it running?');
                SystemErr.println('***');
            }
        },
    };

    /**
     * The duration in nanoseconds for which the conductor will sleep when idle.
     *
     * @return the duration in nanoseconds.
     */
    public static idleSleepDurationNs(): number {
        return SystemUtil.getDurationInNanos(
            AeronConfiguration.IDLE_SLEEP_DURATION_PROP_NAME,
            AeronConfiguration.IDLE_SLEEP_DEFAULT_NS,
        );
    }

    /**
     * The duration to wait while lingering an entity such as an {@link Image} before deleting resources.
     *
     * @return the duration in nanoseconds.
     */
    public static resourceLingerDurationNs(): number {
        return SystemUtil.getDurationInNanos(
            AeronConfiguration.RESOURCE_LINGER_DURATION_PROP_NAME,
            AeronConfiguration.RESOURCE_LINGER_DURATION_DEFAULT_NS,
        );
    }

    /**
     * The duration to linger after the client is closed.
     *
     * @return the duration in nanoseconds.
     */
    public static closeLingerDurationNs(): number {
        return SystemUtil.getDurationInNanos(
            AeronConfiguration.CLOSE_LINGER_DURATION_PROP_NAME,
            AeronConfiguration.CLOSE_LINGER_DURATION_DEFAULT_NS,
        );
    }

    /**
     * Should the memory of the logs be pre-touched?
     *
     * @return true if the {@link PRE_TOUCH_MAPPED_MEMORY_PROP_NAME} property says so.
     */
    public static preTouchMappedMemory(): boolean {
        const value = System.getProperty(AeronConfiguration.PRE_TOUCH_MAPPED_MEMORY_PROP_NAME);
        if (null !== value) {
            return 'true' === value.toLowerCase();
        }

        return AeronConfiguration.PRE_TOUCH_MAPPED_MEMORY_DEFAULT;
    }

    /**
     * The name of the client.
     *
     * @return the {@link CLIENT_NAME_PROP_NAME} property, or an empty string.
     */
    public static clientName(): string {
        return System.getProperty(AeronConfiguration.CLIENT_NAME_PROP_NAME, '');
    }
}

/**
 * This class provides the Media Driver and client with common configuration for the Aeron directory: the nested class
 * `Aeron.Context`, which specifies the parameters for the {@link Aeron} client. It is for a client that runs in the
 * process of the driver (spec D15, D93): the CnC comes from the {@link MediaDriver} given to {@link mediaDriver} and
 * there is no directory.
 * <p>
 * The package-private members of the Java class are public here. A getter and its fluent setter are one overloaded
 * method.
 */
export class AeronContext extends CommonContext {
    private _clientId = 0;
    private _clientName: string = AeronConfiguration.clientName();
    private _useConductorAgentInvoker = false;
    private _preTouchMappedMemory: boolean = AeronConfiguration.preTouchMappedMemory();
    private _driverAgentInvoker: AgentInvoker | null = null;
    private _isDriverAgentInvokerOfDriver = false;
    private _clientLock: Lock | null = null;
    private _epochClock: EpochClock | null = null;
    private _nanoClock: NanoClock | null = null;
    private _idleStrategy: IdleStrategy | null = null;
    private _awaitingIdleStrategy: IdleStrategy | null = null;
    private _toClientBuffer: CopyBroadcastReceiver | null = null;
    private _toDriverBuffer: RingBuffer | null = null;
    private _driverProxy: DriverProxy | null = null;
    private _cncByteBuffer: SharedArrayBuffer | null = null;
    private _cncMetaDataBuffer: UnsafeBuffer | null = null;
    private _mediaDriver: MediaDriver | null = null;
    private _logBuffersFactory: LogBuffersFactory | null = null;
    private _errorHandler: ErrorHandler | null = null;
    private _subscriberErrorHandler: ErrorHandler | null = null;
    private _availableImageHandler: AvailableImageHandler | null = null;
    private _unavailableImageHandler: UnavailableImageHandler | null = null;
    private _publicationErrorFrameHandler: PublicationErrorFrameHandler = PublicationErrorFrameHandler.NO_OP;
    private _closeHandler: (() => void) | null = null;
    private _keepAliveIntervalNs: number = AeronConfiguration.KEEPALIVE_INTERVAL_NS;
    private _interServiceTimeoutNs = 0;
    private _idleSleepDurationNs: number = AeronConfiguration.idleSleepDurationNs();
    private _resourceLingerDurationNs: number = AeronConfiguration.resourceLingerDurationNs();
    private _closeLingerDurationNs: number = AeronConfiguration.closeLingerDurationNs();
    private _filePageSize = 0;

    public constructor() {
        super();
    }

    /**
     * This is called automatically by {@link Aeron.connect}. If you are not using {@link Aeron.connect} then call
     * this method before use.
     * <p>
     * The CnC is taken from the {@link MediaDriver} given to {@link mediaDriver} (or from {@link cncByteBuffer}),
     * where Java maps the file of the Aeron directory; the driver must be running (it must have set its heartbeat).
     *
     * @return this for a fluent API.
     */
    public override conclude(): this {
        super.conclude();

        if (null === this._clientLock) {
            this._clientLock = new ReentrantLock();
        } else if (this._clientLock instanceof NoOpLock && !this._useConductorAgentInvoker) {
            throw new ConfigurationException(
                'Must use Aeron.Context.useConductorAgentInvoker(true) when Aeron.Context.clientLock(...) ' +
                    'is using a NoOpLock',
            );
        }

        if (
            null !== this._driverAgentInvoker &&
            !this._useConductorAgentInvoker &&
            !this._isDriverAgentInvokerOfDriver
        ) {
            throw new ConfigurationException(
                'Must use Aeron.Context.useConductorAgentInvoker(true) when Aeron.Context.driverAgentInvoker() ' +
                    'is set',
            );
        }

        if (this._clientName.length > AeronConfiguration.MAX_CLIENT_NAME_LENGTH) {
            throw new ConfigurationException('clientName length must <= ' + AeronConfiguration.MAX_CLIENT_NAME_LENGTH);
        }

        if (null === this._epochClock) {
            this._epochClock = SystemEpochClock.INSTANCE;
        }

        if (null === this._nanoClock) {
            this._nanoClock = SystemNanoClock.INSTANCE;
        }

        if (this._idleSleepDurationNs < 0 || this._idleSleepDurationNs > TimeUnit.SECONDS.toNanos(1)) {
            throw new ConfigurationException('Invalid idle sleep duration: ' + this._idleSleepDurationNs + 'ns');
        }

        if (null === this._idleStrategy) {
            this._idleStrategy = new SleepingMillisIdleStrategy(
                TimeUnit.NANOSECONDS.toMillis(this._idleSleepDurationNs),
            );
        }

        if (null === this._awaitingIdleStrategy) {
            this._awaitingIdleStrategy = new SleepingMillisIdleStrategy(AeronConfiguration.AWAITING_IDLE_SLEEP_MS);
        }

        this.connectToDriver();

        const cncMetaDataBuffer = this._cncMetaDataBuffer as UnsafeBuffer;
        const cncByteBuffer = this._cncByteBuffer as SharedArrayBuffer;
        this._filePageSize = CncFileDescriptor.filePageSize(cncMetaDataBuffer);
        this._interServiceTimeoutNs = CncFileDescriptor.clientLivenessTimeoutNs(cncMetaDataBuffer);

        if (this._interServiceTimeoutNs <= this._keepAliveIntervalNs) {
            throw new ConfigurationException(
                'interServiceTimeoutNs=' +
                    this._interServiceTimeoutNs +
                    ' <= keepAliveIntervalNs=' +
                    this._keepAliveIntervalNs,
            );
        }

        if (null === this._toDriverBuffer) {
            this._toDriverBuffer = new ManyToOneRingBuffer(
                CncFileDescriptor.createToDriverBuffer(cncByteBuffer, cncMetaDataBuffer),
            );
        }

        if (null === this._toClientBuffer) {
            this._toClientBuffer = new CopyBroadcastReceiver(
                new BroadcastReceiver(CncFileDescriptor.createToClientsBuffer(cncByteBuffer, cncMetaDataBuffer)),
                new ExpandableArrayBuffer(CopyBroadcastReceiver.SCRATCH_BUFFER_LENGTH),
            );
        }

        if (this.countersMetaDataBuffer() === null) {
            this.countersMetaDataBuffer(
                CncFileDescriptor.createCountersMetaDataBuffer(cncByteBuffer, cncMetaDataBuffer),
            );
        }

        if (this.countersValuesBuffer() === null) {
            this.countersValuesBuffer(CncFileDescriptor.createCountersValuesBuffer(cncByteBuffer, cncMetaDataBuffer));
        }

        if (null === this._logBuffersFactory) {
            const logFactory = (this._mediaDriver as MediaDriver | null)?.context().logFactory() ?? null;
            if (null === logFactory || 'function' !== typeof (logFactory as unknown as LogLookup).lookup) {
                throw new ConfigurationException(
                    'Aeron.Context needs the logs of the driver: give it the MediaDriver with mediaDriver(...), ' +
                        'or a logBuffersFactory(...)',
                );
            }
            this._logBuffersFactory = new MemoryLogBuffersFactory(logFactory as unknown as LogLookup);
        }

        if (null === this._errorHandler) {
            this._errorHandler = AeronConfiguration.DEFAULT_ERROR_HANDLER;
        }

        if (null === this._subscriberErrorHandler) {
            this._subscriberErrorHandler = this._errorHandler;
        }

        if (null === this._driverProxy) {
            this._clientId = this._toDriverBuffer.nextCorrelationId();
            this._driverProxy = new DriverProxy(this._toDriverBuffer, this._clientId);
        }

        return this;
    }

    /**
     * Get the client id of this client: the id by which the driver knows it.
     *
     * @return the client id.
     */
    public clientId(): number {
        return this._clientId;
    }

    /**
     * Set the name of the client, which is added to the label of its heartbeat counter. At most 100 characters.
     *
     * @param clientName to set; null or empty is the empty name.
     * @return this for a fluent API.
     */
    public clientName(clientName: string | null): this;
    /**
     * The name of the client.
     *
     * @return the name of the client.
     */
    public clientName(): string;
    public clientName(clientName?: string | null): string | this {
        if (undefined === clientName) {
            return this._clientName;
        }

        this._clientName = Strings.isEmpty(clientName) ? '' : (clientName as string);
        return this;
    }

    /**
     * Use an {@link AgentInvoker} to invoke the conductor duty cycle rather than running it on an {@link AgentRunner}.
     * It is required when {@link driverAgentInvoker} is set.
     *
     * @param useConductorAgentInvoker true to use an invoker.
     * @return this for a fluent API.
     */
    public useConductorAgentInvoker(useConductorAgentInvoker: boolean): this;
    /**
     * Does the client use an {@link AgentInvoker} for the conductor?
     *
     * @return true if it does.
     */
    public useConductorAgentInvoker(): boolean;
    public useConductorAgentInvoker(useConductorAgentInvoker?: boolean): boolean | this {
        if (undefined === useConductorAgentInvoker) {
            return this._useConductorAgentInvoker;
        }

        this._useConductorAgentInvoker = useConductorAgentInvoker;
        return this;
    }

    /**
     * Should the memory of the logs be pre-touched when they are mapped?
     *
     * @param preTouchMappedMemory true to pre-touch.
     * @return this for a fluent API.
     */
    public preTouchMappedMemory(preTouchMappedMemory: boolean): this;
    /**
     * Is the memory of the logs pre-touched when they are mapped?
     *
     * @return true if it is.
     */
    public preTouchMappedMemory(): boolean;
    public preTouchMappedMemory(preTouchMappedMemory?: boolean): boolean | this {
        if (undefined === preTouchMappedMemory) {
            return this._preTouchMappedMemory;
        }

        this._preTouchMappedMemory = preTouchMappedMemory;
        return this;
    }

    /**
     * The {@link AgentInvoker} of the media driver that the client runs while it waits for the response to a command,
     * for a driver in the same process. It requires {@link useConductorAgentInvoker}.
     *
     * @param driverAgentInvoker to run, or null for none.
     * @return this for a fluent API.
     */
    public driverAgentInvoker(driverAgentInvoker: AgentInvoker | null): this;
    /**
     * The invoker of the driver, if the driver is in the same process.
     *
     * @return the invoker of the driver, or null.
     */
    public driverAgentInvoker(): AgentInvoker | null;
    public driverAgentInvoker(driverAgentInvoker?: AgentInvoker | null): AgentInvoker | null | this {
        if (undefined === driverAgentInvoker) {
            return this._driverAgentInvoker;
        }

        this._driverAgentInvoker = driverAgentInvoker;
        this._isDriverAgentInvokerOfDriver = false;
        return this;
    }

    /**
     * Not in Java (spec D15, D93). The media driver in this process to connect to: its CnC takes the place of the
     * Aeron directory, its logs are where the client finds the log of a publication or an image, and its
     * {@link MediaDriver.sharedAgentInvoker} is the {@link driverAgentInvoker} unless one is set already (the
     * calls that wait for the driver run it, spec D93). A driver that runs itself on the event loop
     * ({@link MediaDriver.runner}) also runs the conductor of the client in its duty cycle, unless the client has
     * {@link useConductorAgentInvoker} (spec D100). The rule of Java, that a `driverAgentInvoker` needs
     * {@link useConductorAgentInvoker}, is for an invoker set with {@link driverAgentInvoker}.
     *
     * @param mediaDriver the driver that was launched in this process.
     * @return this for a fluent API.
     */
    public mediaDriver(mediaDriver: MediaDriver | null): this;
    /**
     * The media driver of this process that the client connects to.
     *
     * @return the driver, or null.
     */
    public mediaDriver(): MediaDriver | null;
    public mediaDriver(mediaDriver?: MediaDriver | null): MediaDriver | null | this {
        if (undefined === mediaDriver) {
            return this._mediaDriver;
        }

        this._mediaDriver = mediaDriver;
        if (null !== mediaDriver && null === this._driverAgentInvoker) {
            this._driverAgentInvoker = mediaDriver.sharedAgentInvoker();
            this._isDriverAgentInvokerOfDriver = true;
        }
        return this;
    }

    /**
     * Not in Java (spec D93). The CnC in memory (Java: the mapped CnC file) to connect to, with {@link cncMetaDataBuffer}
     * made from it, for a client that is not given a {@link MediaDriver}.
     *
     * @param cncByteBuffer the memory of the CnC.
     * @return this for a fluent API.
     */
    public cncByteBuffer(cncByteBuffer: SharedArrayBuffer | null): this;
    /**
     * The memory of the CnC.
     *
     * @return the memory of the CnC, or null.
     */
    public cncByteBuffer(): SharedArrayBuffer | null;
    public cncByteBuffer(cncByteBuffer?: SharedArrayBuffer | null): SharedArrayBuffer | null | this {
        if (undefined === cncByteBuffer) {
            return this._cncByteBuffer;
        }

        this._cncByteBuffer = cncByteBuffer;
        return this;
    }

    /**
     * Not in Java (spec D93). The meta data of the CnC.
     *
     * @return the meta data buffer of the CnC, or null until the context is concluded.
     */
    public cncMetaDataBuffer(): UnsafeBuffer | null {
        return this._cncMetaDataBuffer;
    }

    /**
     * The lock that serialises the calls of the application with the conductor. There is one thread (spec D3), so the
     * default is a lock that is always free; a {@link NoOpLock} requires {@link useConductorAgentInvoker}.
     *
     * @param lock to use.
     * @return this for a fluent API.
     */
    public clientLock(lock: Lock | null): this;
    /**
     * The lock of the client.
     *
     * @return the lock of the client.
     */
    public clientLock(): Lock | null;
    public clientLock(lock?: Lock | null): Lock | null | this {
        if (undefined === lock) {
            return this._clientLock;
        }

        this._clientLock = lock;
        return this;
    }

    /**
     * The source of time in milliseconds for the keepalive of the driver.
     *
     * @param clock to use.
     * @return this for a fluent API.
     */
    public epochClock(clock: EpochClock | null): this;
    /**
     * The clock in milliseconds.
     *
     * @return the clock.
     */
    public epochClock(): EpochClock | null;
    public epochClock(clock?: EpochClock | null): EpochClock | null | this {
        if (undefined === clock) {
            return this._epochClock;
        }

        this._epochClock = clock;
        return this;
    }

    /**
     * The source of time in nanoseconds for the timeouts of the conductor.
     *
     * @param clock to use.
     * @return this for a fluent API.
     */
    public nanoClock(clock: NanoClock | null): this;
    /**
     * The clock in nanoseconds.
     *
     * @return the clock.
     */
    public nanoClock(): NanoClock | null;
    public nanoClock(clock?: NanoClock | null): NanoClock | null | this {
        if (undefined === clock) {
            return this._nanoClock;
        }

        this._nanoClock = clock;
        return this;
    }

    /**
     * The {@link IdleStrategy} of the conductor when it runs on an {@link AgentRunner}.
     *
     * @param idleStrategy to use.
     * @return this for a fluent API.
     */
    public idleStrategy(idleStrategy: IdleStrategy | null): this;
    /**
     * The idle strategy of the conductor.
     *
     * @return the idle strategy.
     */
    public idleStrategy(): IdleStrategy | null;
    public idleStrategy(idleStrategy?: IdleStrategy | null): IdleStrategy | null | this {
        if (undefined === idleStrategy) {
            return this._idleStrategy;
        }

        this._idleStrategy = idleStrategy;
        return this;
    }

    /**
     * The {@link IdleStrategy} for the calls that wait for the driver.
     *
     * @param idleStrategy to use.
     * @return this for a fluent API.
     */
    public awaitingIdleStrategy(idleStrategy: IdleStrategy | null): this;
    /**
     * The idle strategy for the calls that wait for the driver.
     *
     * @return the idle strategy.
     */
    public awaitingIdleStrategy(): IdleStrategy | null;
    public awaitingIdleStrategy(idleStrategy?: IdleStrategy | null): IdleStrategy | null | this {
        if (undefined === idleStrategy) {
            return this._awaitingIdleStrategy;
        }

        this._awaitingIdleStrategy = idleStrategy;
        return this;
    }

    /**
     * The receiver of the to client broadcast buffer.
     *
     * @internal package-private in Java.
     */
    public toClientBuffer(toClientBuffer: CopyBroadcastReceiver | null): this;
    public toClientBuffer(): CopyBroadcastReceiver | null;
    public toClientBuffer(toClientBuffer?: CopyBroadcastReceiver | null): CopyBroadcastReceiver | null | this {
        if (undefined === toClientBuffer) {
            return this._toClientBuffer;
        }

        this._toClientBuffer = toClientBuffer;
        return this;
    }

    /**
     * The ring buffer of commands to the driver.
     *
     * @return the ring buffer, or null until the context is concluded.
     */
    public toDriverBuffer(): RingBuffer | null {
        return this._toDriverBuffer;
    }

    /**
     * The proxy that writes the commands to the driver.
     *
     * @internal package-private in Java.
     */
    public driverProxy(driverProxy: DriverProxy | null): this;
    public driverProxy(): DriverProxy | null;
    public driverProxy(driverProxy?: DriverProxy | null): DriverProxy | null | this {
        if (undefined === driverProxy) {
            return this._driverProxy;
        }

        this._driverProxy = driverProxy;
        return this;
    }

    /**
     * The factory that finds the logs of the driver.
     *
     * @internal package-private in Java.
     */
    public logBuffersFactory(logBuffersFactory: LogBuffersFactory | null): this;
    public logBuffersFactory(): LogBuffersFactory | null;
    public logBuffersFactory(logBuffersFactory?: LogBuffersFactory | null): LogBuffersFactory | null | this {
        if (undefined === logBuffersFactory) {
            return this._logBuffersFactory;
        }

        this._logBuffersFactory = logBuffersFactory;
        return this;
    }

    /**
     * Handle errors of the client: a conductor error, a callback that throws, and so on.
     *
     * @param errorHandler to call.
     * @return this for a fluent API.
     */
    public errorHandler(errorHandler: ErrorHandler | null): this;
    /**
     * The handler for errors of the client.
     *
     * @return the error handler.
     */
    public errorHandler(): ErrorHandler | null;
    public errorHandler(errorHandler?: ErrorHandler | null): ErrorHandler | null | this {
        if (undefined === errorHandler) {
            return this._errorHandler;
        }

        this._errorHandler = errorHandler;
        return this;
    }

    /**
     * Handle errors that a fragment handler of a subscriber throws; the {@link errorHandler} by default.
     *
     * @param errorHandler to call.
     * @return this for a fluent API.
     */
    public subscriberErrorHandler(errorHandler: ErrorHandler | null): this;
    /**
     * The handler for errors of the subscribers.
     *
     * @return the error handler.
     */
    public subscriberErrorHandler(): ErrorHandler | null;
    public subscriberErrorHandler(errorHandler?: ErrorHandler | null): ErrorHandler | null | this {
        if (undefined === errorHandler) {
            return this._subscriberErrorHandler;
        }

        this._subscriberErrorHandler = errorHandler;
        return this;
    }

    /**
     * Set the handler for the availability of an {@link Image} for a subscription added without a handler of its own.
     *
     * @param handler to call.
     * @return this for a fluent API.
     */
    public availableImageHandler(handler: AvailableImageHandler | null): this;
    /**
     * The default handler for a new {@link Image}.
     *
     * @return the handler, or null.
     */
    public availableImageHandler(): AvailableImageHandler | null;
    public availableImageHandler(handler?: AvailableImageHandler | null): AvailableImageHandler | null | this {
        if (undefined === handler) {
            return this._availableImageHandler;
        }

        this._availableImageHandler = handler;
        return this;
    }

    /**
     * Set the handler for the loss of an {@link Image} for a subscription added without a handler of its own.
     *
     * @param handler to call.
     * @return this for a fluent API.
     */
    public unavailableImageHandler(handler: UnavailableImageHandler | null): this;
    /**
     * The default handler for an {@link Image} that goes away.
     *
     * @return the handler, or null.
     */
    public unavailableImageHandler(): UnavailableImageHandler | null;
    public unavailableImageHandler(handler?: UnavailableImageHandler | null): UnavailableImageHandler | null | this {
        if (undefined === handler) {
            return this._unavailableImageHandler;
        }

        this._unavailableImageHandler = handler;
        return this;
    }

    /**
     * Set a handler that runs when the client closes.
     *
     * @param handler to call, or null.
     * @return this for a fluent API.
     */
    public closeHandler(handler: (() => void) | null): this;
    /**
     * The handler that runs when the client closes.
     *
     * @return the handler, or null.
     */
    public closeHandler(): (() => void) | null;
    public closeHandler(handler?: (() => void) | null): (() => void) | null | this {
        if (undefined === handler) {
            return this._closeHandler;
        }

        this._closeHandler = handler;
        return this;
    }

    /**
     * The interval between keepalives to the driver, in nanoseconds.
     *
     * @param value in nanoseconds.
     * @return this for a fluent API.
     */
    public keepAliveIntervalNs(value: number): this;
    /**
     * The interval between keepalives to the driver, in nanoseconds.
     *
     * @return the interval.
     */
    public keepAliveIntervalNs(): number;
    public keepAliveIntervalNs(value?: number): number | this {
        if (undefined === value) {
            return this._keepAliveIntervalNs;
        }

        this._keepAliveIntervalNs = value;
        return this;
    }

    /**
     * The longest time between two duty cycles of the conductor, in nanoseconds: the client liveness timeout of the
     * driver, which {@link conclude} reads from the CnC (it is the setter that tests use).
     *
     * @internal package-private in Java.
     */
    public interServiceTimeoutNs(interServiceTimeout: number): this;
    /**
     * The longest time between two duty cycles of the conductor, as adjusted by {@link checkDebugTimeout}.
     *
     * @return the timeout in nanoseconds.
     */
    public interServiceTimeoutNs(): number;
    public interServiceTimeoutNs(interServiceTimeout?: number): number | this {
        if (undefined === interServiceTimeout) {
            return CommonContext.checkDebugTimeout(this._interServiceTimeoutNs, TimeUnit.NANOSECONDS);
        }

        this._interServiceTimeoutNs = interServiceTimeout;
        return this;
    }

    /**
     * The duration the conductor waits between duty cycles when it has nothing to do, in nanoseconds; it is also the
     * interval at which it checks its timeouts.
     *
     * @param idleSleepDurationNs in nanoseconds.
     * @return this for a fluent API.
     */
    public idleSleepDurationNs(idleSleepDurationNs: number): this;
    /**
     * The idle sleep duration of the conductor.
     *
     * @return the duration in nanoseconds.
     */
    public idleSleepDurationNs(): number;
    public idleSleepDurationNs(idleSleepDurationNs?: number): number | this {
        if (undefined === idleSleepDurationNs) {
            return this._idleSleepDurationNs;
        }

        this._idleSleepDurationNs = idleSleepDurationNs;
        return this;
    }

    /**
     * How long to keep the memory of a log after its last user has released it, in nanoseconds.
     *
     * @param resourceLingerDurationNs in nanoseconds.
     * @return this for a fluent API.
     */
    public resourceLingerDurationNs(resourceLingerDurationNs: number): this;
    /**
     * How long to keep the memory of a log after its last user has released it.
     *
     * @return the duration in nanoseconds.
     */
    public resourceLingerDurationNs(): number;
    public resourceLingerDurationNs(resourceLingerDurationNs?: number): number | this {
        if (undefined === resourceLingerDurationNs) {
            return this._resourceLingerDurationNs;
        }

        this._resourceLingerDurationNs = resourceLingerDurationNs;
        return this;
    }

    /**
     * How long Java lingers after the client is closed; nothing waits here (spec D94).
     *
     * @param closeLingerDurationNs in nanoseconds.
     * @return this for a fluent API.
     */
    public closeLingerDurationNs(closeLingerDurationNs: number): this;
    /**
     * How long Java lingers after the client is closed.
     *
     * @return the duration in nanoseconds.
     */
    public closeLingerDurationNs(): number;
    public closeLingerDurationNs(closeLingerDurationNs?: number): number | this {
        if (undefined === closeLingerDurationNs) {
            return this._closeLingerDurationNs;
        }

        this._closeLingerDurationNs = closeLingerDurationNs;
        return this;
    }

    /**
     * Set the handler for the error frames that publications of this client receive.
     *
     * @param publicationErrorFrameHandler to call.
     * @return this for a fluent API.
     */
    public publicationErrorFrameHandler(publicationErrorFrameHandler: PublicationErrorFrameHandler): this;
    /**
     * The handler for the error frames that publications of this client receive.
     *
     * @return the handler.
     */
    public publicationErrorFrameHandler(): PublicationErrorFrameHandler;
    public publicationErrorFrameHandler(
        publicationErrorFrameHandler?: PublicationErrorFrameHandler,
    ): PublicationErrorFrameHandler | this {
        if (undefined === publicationErrorFrameHandler) {
            return this._publicationErrorFrameHandler;
        }

        if (null === publicationErrorFrameHandler) {
            throw new TypeError('publicationErrorFrameHandler must not be null');
        }
        this._publicationErrorFrameHandler = publicationErrorFrameHandler;
        return this;
    }

    /**
     * The page size of the files of the driver, as its CnC says.
     *
     * @return the page size.
     */
    public filePageSize(): number {
        return this._filePageSize;
    }

    /**
     * Close the context. The CnC belongs to the driver: it is only let go.
     */
    public override close(): void {
        this._cncByteBuffer = null;
        super.close();
    }

    public override toString(): string {
        return (
            'Aeron.Context' +
            '\n{' +
            '\n    isConcluded=' +
            this.isConcluded() +
            '\n    countersMetaDataBuffer=' +
            this.countersMetaDataBuffer() +
            '\n    countersValuesBuffer=' +
            this.countersValuesBuffer() +
            '\n    driverTimeoutMs=' +
            this.driverTimeoutMs() +
            '\n    clientId=' +
            this._clientId +
            '\n    clientName=' +
            this._clientName +
            '\n    useConductorAgentInvoker=' +
            this._useConductorAgentInvoker +
            '\n    preTouchMappedMemory=' +
            this._preTouchMappedMemory +
            '\n    driverAgentInvoker=' +
            this._driverAgentInvoker +
            '\n    clientLock=' +
            this._clientLock +
            '\n    epochClock=' +
            this._epochClock +
            '\n    nanoClock=' +
            this._nanoClock +
            '\n    idleStrategy=' +
            this._idleStrategy +
            '\n    awaitingIdleStrategy=' +
            this._awaitingIdleStrategy +
            '\n    toClientBuffer=' +
            this._toClientBuffer +
            '\n    toDriverBuffer=' +
            this._toDriverBuffer +
            '\n    driverProxy=' +
            this._driverProxy +
            '\n    cncByteBuffer=' +
            this._cncByteBuffer +
            '\n    cncMetaDataBuffer=' +
            this._cncMetaDataBuffer +
            '\n    logBuffersFactory=' +
            this._logBuffersFactory +
            '\n    errorHandler=' +
            this._errorHandler +
            '\n    subscriberErrorHandler=' +
            this._subscriberErrorHandler +
            '\n    availableImageHandler=' +
            this._availableImageHandler +
            '\n    unavailableImageHandler=' +
            this._unavailableImageHandler +
            '\n    closeHandler=' +
            this._closeHandler +
            '\n    keepAliveIntervalNs=' +
            this._keepAliveIntervalNs +
            '\n    interServiceTimeoutNs=' +
            this._interServiceTimeoutNs +
            '\n    resourceLingerDurationNs=' +
            this._resourceLingerDurationNs +
            '\n    closeLingerDurationNs=' +
            this._closeLingerDurationNs +
            '\n}'
        );
    }

    /**
     * Wait for the driver to be there: Java maps the CnC file and waits, sleeping, for the driver to write its
     * heartbeat. Here the CnC is in memory and nothing else runs while this does, so it is checked once, after one
     * duty cycle of the driver if the context has its invoker (spec D93).
     */
    private connectToDriver(): void {
        if (null === this._toDriverBuffer) {
            if (null === this._cncByteBuffer && null !== this._mediaDriver) {
                this._cncByteBuffer = this._mediaDriver.context().cncByteBuffer();
            }

            if (null === this._cncByteBuffer) {
                throw new ConfigurationException(
                    'Aeron.Context needs the CnC of a driver: give it the MediaDriver with mediaDriver(...), ' +
                        'or its memory with cncByteBuffer(...)',
                );
            }

            this._cncMetaDataBuffer = CncFileDescriptor.createMetaDataBuffer(this._cncByteBuffer);
            if (!CncFileDescriptor.isCncFileLengthSufficient(this._cncMetaDataBuffer, this._cncByteBuffer.byteLength)) {
                throw new DriverTimeoutException('no driver heartbeat detected');
            }

            const clock = this._epochClock as EpochClock;
            const ringBuffer = new ManyToOneRingBuffer(
                CncFileDescriptor.createToDriverBuffer(this._cncByteBuffer, this._cncMetaDataBuffer),
            );

            const isAlive = (): boolean => {
                const heartbeatMs = ringBuffer.consumerHeartbeatTime();
                return 0 !== heartbeatMs && heartbeatMs >= clock.time() - this.driverTimeoutMs();
            };

            if (!isAlive()) {
                this._driverAgentInvoker?.invoke();
                if (!isAlive()) {
                    throw new DriverTimeoutException('no driver heartbeat detected');
                }
            }

            this._toDriverBuffer = ringBuffer;
        } else if (null === this._cncByteBuffer) {
            throw new ConfigurationException('toDriverBuffer is set without the CnC of the driver');
        } else if (null === this._cncMetaDataBuffer) {
            this._cncMetaDataBuffer = CncFileDescriptor.createMetaDataBuffer(this._cncByteBuffer);
        }
    }
}

/**
 * Aeron entry point for communicating to the Media Driver for creating {@link Publication}s and {@link Subscription}s.
 * Use an {@link AeronContext} (`Aeron.Context`) to configure the Aeron client; the context of an embedded driver is
 * given the driver with {@link AeronContext.mediaDriver}.
 * <p>
 * A client can be started with an {@link AgentInvoker} for the conductor ({@link AeronContext.useConductorAgentInvoker}),
 * which the application calls to run it, or with an {@link AgentRunner} on the event loop. Both run on the one JS thread
 * (spec D3).
 * <p>
 * The counters API (`addCounter`, `addStaticCounter`, their `async` forms, `getCounter`, `asyncRemoveCounter`, and the
 * counter handlers) is not ported (spec D95). Calls with a channel with a DNS name in it should be the `async` forms, or
 * be preceded by {@link resolveChannelHosts} (spec D7, D92).
 */
export class Aeron implements AutoCloseable {
    /**
     * Used to represent a null value for when some value is not yet set.
     */
    public static readonly NULL_VALUE: number = NULL_VALUE;

    /**
     * The nested class `Aeron.Configuration`.
     */
    public static readonly Configuration = AeronConfiguration;

    /**
     * The nested class `Aeron.Context`.
     */
    public static readonly Context = AeronContext;

    private _isClosed = false;
    private readonly _clientId: number = 0;
    private readonly conductor: ClientConductor;
    private readonly commandBuffer: RingBuffer;
    private readonly conductorInvoker: AgentInvoker | null;
    private readonly conductorRunner: AgentRunner | null;
    private readonly hostedInvoker: AgentInvoker | null;
    private readonly hostingDriver: MediaDriver | null;
    private readonly wakeConductor: () => void;
    private readonly ctx: AeronContext;

    /**
     * Create a client with a concluded context (the context is concluded here). Use {@link Aeron.connect} to also
     * start the conductor.
     *
     * @param ctx for the configuration of the client.
     * @internal package-private in Java.
     */
    public constructor(ctx: AeronContext) {
        try {
            ctx.conclude();

            this.ctx = ctx;
            this._clientId = ctx.clientId();
            this.commandBuffer = ctx.toDriverBuffer() as RingBuffer;
            this.conductor = new ClientConductor(ctx, this);

            const driver = ctx.mediaDriver();
            if (ctx.useConductorAgentInvoker()) {
                this.conductorInvoker = new AgentInvoker(ctx.errorHandler() as ErrorHandler, null, this.conductor);
                this.conductorRunner = null;
                this.hostedInvoker = null;
                this.hostingDriver = null;
            } else if (null !== driver && null !== driver.runner()) {
                // the driver runs itself on the event loop: the conductor shares its duty cycle (spec D100)
                this.conductorInvoker = null;
                this.conductorRunner = null;
                this.hostedInvoker = new AgentInvoker(ctx.errorHandler() as ErrorHandler, null, this.conductor);
                this.hostingDriver = driver;
            } else {
                this.conductorInvoker = null;
                this.conductorRunner = new AgentRunner(
                    ctx.idleStrategy() as IdleStrategy,
                    ctx.errorHandler() as ErrorHandler,
                    null,
                    this.conductor,
                );
                this.hostedInvoker = null;
                this.hostingDriver = null;
            }

            // the commands of the client and the look-ups of host names cut short the idle wait of the runner
            // that runs the driver and the conductor (spec D8, D100)
            this.wakeConductor = (): void => {
                this.conductorRunner?.wake();
                driver?.wake();
            };
            ctx.driverProxy()?.setWakeUp(this.wakeConductor);
            this.conductor.setWakeUp(this.wakeConductor);
        } catch (ex) {
            if (ex instanceof ConcurrentConcludeException) {
                throw ex;
            }

            CloseHelper.quietClose({ close: () => ctx.close() });
            throw ex;
        }
    }

    /**
     * Create an Aeron instance and connect to the media driver of its context, with a default {@link AeronContext}
     * (which has no driver to connect to: this throws until the context is given one, so a driver is given with a
     * context).
     *
     * @return the new Aeron instance connected to the Media Driver.
     */
    public static connect(): Aeron;
    /**
     * Create an Aeron instance and connect to the media driver of the context. A client with an {@link AgentInvoker}
     * for the conductor ({@link AeronContext.useConductorAgentInvoker}) has it started here; otherwise the conductor
     * runs on an {@link AgentRunner}.
     *
     * @param ctx for configuration of the client.
     * @return the new Aeron instance connected to the Media Driver.
     */
    public static connect(ctx: AeronContext): Aeron;
    public static connect(ctx: AeronContext = new AeronContext()): Aeron {
        try {
            const aeron = new Aeron(ctx);

            if (ctx.useConductorAgentInvoker()) {
                (aeron.conductorInvoker as AgentInvoker).start();
            } else if (null !== aeron.hostedInvoker) {
                aeron.hostedInvoker.start();
                (aeron.hostingDriver as MediaDriver).host(aeron.hostedInvoker);
            } else {
                AgentRunner.startOnThread(aeron.conductorRunner as AgentRunner);
            }

            return aeron;
        } catch (ex) {
            if (ex instanceof ConcurrentConcludeException) {
                throw ex;
            }

            ctx.close();
            throw ex;
        }
    }

    /**
     * Print out the values from {@link countersReader} which can be useful for debugging.
     *
     * @param out to where the counters get printed.
     */
    public printCounters(out: PrintStream): void {
        const counters = this.countersReader();
        counters.forEachCounterConsumer((value, id, label) => {
            out.println(String(id).padStart(3) + ': ' + value.toLocaleString('en-US').padStart(20) + ' - ' + label);
        });
    }

    /**
     * Has the client been closed? If not then the {@link CountersReader} may throw exceptions.
     *
     * @return true if it has been closed otherwise false.
     */
    public isClosed(): boolean {
        return this._isClosed;
    }

    /**
     * Get the {@link AeronContext} used to create this instance.
     *
     * @return the {@link AeronContext} used to create this instance.
     */
    public context(): AeronContext {
        return this.ctx;
    }

    /**
     * Get the client identity that has been allocated for communicating with the media driver.
     *
     * @return the client identity that has been allocated for communicating with the media driver.
     */
    public clientId(): number {
        return this._clientId;
    }

    /**
     * Get the {@link AgentInvoker} for the client conductor.
     *
     * @return the {@link AgentInvoker} for the client conductor, or null if it runs on an {@link AgentRunner}.
     */
    public conductorAgentInvoker(): AgentInvoker | null {
        return this.conductorInvoker;
    }

    /**
     * Is the command still active for a given correlation id.
     *
     * @param correlationId of the command to check.
     * @return true if the command is still in progress.
     */
    public isCommandActive(correlationId: number): boolean {
        return this.conductor.isCommandActive(correlationId);
    }

    /**
     * Does the client have any active asynchronous commands?
     *
     * @return true if there are active commands.
     */
    public hasActiveCommands(): boolean {
        return this.conductor.hasActiveCommands();
    }

    /**
     * Clean up and release all Aeron client resources and shutdown conductor thread if not using
     * {@link AeronContext.useConductorAgentInvoker}.
     * <p>
     * This will close all currently open {@link Publication}s, {@link Subscription}s and {@link Counter}s created
     * from this client. It does not close the media driver.
     */
    public close(): void {
        if (!this._isClosed) {
            this._isClosed = true;

            const errorHandler = this.ctx.errorHandler();
            if (null !== this.conductorRunner) {
                CloseHelper.close(errorHandler, this.conductorRunner);
            } else if (null !== this.hostedInvoker) {
                this.hostingDriver?.unhost(this.hostedInvoker);
                CloseHelper.close(errorHandler, this.hostedInvoker);
            } else {
                CloseHelper.close(errorHandler, this.conductorInvoker);
            }
        }
    }

    /**
     * Not in Java (spec D7, D92). Look up the host names in a channel (the `endpoint`, `interface` and `control`
     * parameters of a UDP channel) so that the driver's name resolver finds them: the synchronous calls
     * ({@link addPublication}, {@link addSubscription}, {@link ConcurrentPublication.addDestination}, ...) can then use
     * them. The `async` calls do it themselves.
     *
     * @param channel the channel URI that is to be added.
     * @return a promise that is fulfilled when every look-up is over, whether or not it found the host.
     */
    public resolveChannelHosts(channel: string): Promise<void> {
        const hosts = hostsToLookUp(channel);

        return Promise.all(
            hosts.map(
                (host) =>
                    new Promise<void>((resolve) => {
                        try {
                            lookUpHost(host, resolve, () => {}); // resolve never throws
                        } catch (ex) {
                            // an argument that dns refuses: the name stays unresolved
                            void ex;
                            resolve();
                        }
                    }),
            ),
        ).then(() => undefined);
    }

    /**
     * Not in Java (spec D92, D8). Call a function when a look-up of a host name for an `async` call is over, so that a
     * runner that is idle can be woken. The client sets one for the runner that runs its conductor (and the driver, for
     * a driver of this process that runs itself); this replaces it.
     *
     * @param wakeUp to call, or null for none.
     */
    public setWakeUp(wakeUp: (() => void) | null): void {
        this.conductor.setWakeUp(wakeUp);
    }

    /**
     * Add a {@link Publication} for publishing messages to subscribers. The publication returned is threadsafe.
     *
     * @param channel  for receiving the messages known to the media layer.
     * @param streamId within the channel scope.
     * @return the new Publication.
     */
    public addPublication(channel: string, streamId: number): ConcurrentPublication | null {
        return this.conductor.addPublication(channel, streamId);
    }

    /**
     * Add an {@link ExclusivePublication} for publishing messages to subscribers from a single thread.
     *
     * @param channel  for receiving the messages known to the media layer.
     * @param streamId within the channel scope.
     * @return the new ExclusivePublication.
     */
    public addExclusivePublication(channel: string, streamId: number): ExclusivePublication | null {
        return this.conductor.addExclusivePublication(channel, streamId);
    }

    /**
     * Asynchronously add a {@link Publication} for publishing messages to subscribers. A DNS name in the channel is
     * looked up first and the command written when that is done (spec D92).
     *
     * @param channel  for receiving the messages known to the media layer.
     * @param streamId within the channel scope.
     * @return the registration id of the publication, to poll for with {@link getPublication}.
     */
    public asyncAddPublication(channel: string, streamId: number): number {
        return this.conductor.asyncAddPublication(channel, streamId);
    }

    /**
     * Asynchronously add an {@link ExclusivePublication}. A DNS name in the channel is looked up first (spec D92).
     *
     * @param channel  for receiving the messages known to the media layer.
     * @param streamId within the channel scope.
     * @return the registration id of the publication, to poll for with {@link getExclusivePublication}.
     */
    public asyncAddExclusivePublication(channel: string, streamId: number): number {
        return this.conductor.asyncAddExclusivePublication(channel, streamId);
    }

    /**
     * Asynchronously remove a publication by its registration id (also while the add is still in progress).
     *
     * @param registrationId of the publication.
     */
    public asyncRemovePublication(registrationId: number): void {
        this.conductor.removePublication(registrationId);
    }

    /**
     * Get a publication for a registration id that {@link asyncAddPublication} returned.
     *
     * @param registrationId of the publication.
     * @return the publication, or null if the driver has not answered yet.
     * @throws RegistrationException if the driver refused the publication.
     */
    public getPublication(registrationId: number): ConcurrentPublication | null {
        return this.conductor.getPublication(registrationId);
    }

    /**
     * Get an exclusive publication for a registration id that {@link asyncAddExclusivePublication} returned.
     *
     * @param registrationId of the publication.
     * @return the publication, or null if the driver has not answered yet.
     * @throws RegistrationException if the driver refused the publication.
     */
    public getExclusivePublication(registrationId: number): ExclusivePublication | null {
        return this.conductor.getExclusivePublication(registrationId);
    }

    /**
     * Add a new {@link Subscription} for subscribing to messages from publishers, with the image handlers of the
     * context, or (Java's second overload) with handlers for this subscription. A `null` handler is none.
     *
     * @param channel                 for receiving the messages known to the media layer.
     * @param streamId                within the channel scope.
     * @param availableImageHandler   called when an {@link Image} is available, if not omitted.
     * @param unavailableImageHandler called when an {@link Image} is lost, if not omitted.
     * @return the {@link Subscription} for the channel and streamId pair.
     */
    public addSubscription(
        channel: string,
        streamId: number,
        availableImageHandler?: AvailableImageHandler | null,
        unavailableImageHandler?: UnavailableImageHandler | null,
    ): Subscription {
        return this.conductor.addSubscription(channel, streamId, availableImageHandler, unavailableImageHandler);
    }

    /**
     * Asynchronously add a {@link Subscription}, with the image handlers of the context, or (Java's other overload)
     * with handlers for this subscription. A DNS name in the channel is looked up first (spec D92).
     *
     * @param channel                 for receiving the messages known to the media layer.
     * @param streamId                within the channel scope.
     * @param availableImageHandler   called when an {@link Image} is available, if not omitted.
     * @param unavailableImageHandler called when an {@link Image} is lost, if not omitted.
     * @return the registration id of the subscription, to poll for with {@link getSubscription}.
     */
    public asyncAddSubscription(
        channel: string,
        streamId: number,
        availableImageHandler?: AvailableImageHandler | null,
        unavailableImageHandler?: UnavailableImageHandler | null,
    ): number {
        return this.conductor.asyncAddSubscription(channel, streamId, availableImageHandler, unavailableImageHandler);
    }

    /**
     * Asynchronously remove a subscription by its registration id (also while the add is still in progress).
     *
     * @param registrationId of the subscription.
     */
    public asyncRemoveSubscription(registrationId: number): void {
        this.conductor.removeSubscription(registrationId);
    }

    /**
     * Get a subscription for a registration id that {@link asyncAddSubscription} returned.
     *
     * @param registrationId of the subscription.
     * @return the subscription, or null if the driver has not answered yet.
     * @throws RegistrationException if the driver refused the subscription.
     */
    public getSubscription(registrationId: number): Subscription | null {
        return this.conductor.getSubscription(registrationId);
    }

    /**
     * Generate the next correlation id that is unique for the connected Media Driver.
     * <p>
     * This is useful generating correlation identifiers for pairing requests with responses in a clients own
     * application protocol.
     * <p>
     * This method is thread safe and will work across processes that all use the same media driver.
     *
     * @return next correlation id that is unique for the Media Driver.
     */
    public nextCorrelationId(): number {
        if (this._isClosed) {
            throw new AeronException('client is closed');
        }

        return this.commandBuffer.nextCorrelationId();
    }

    /**
     * Allocate the next available session id: here a randomised id (the driver command is not ported, spec D95).
     *
     * @param streamId for the session id to be allocated in.
     * @return the session id.
     */
    public nextSessionId(streamId: number): number {
        if (this._isClosed) {
            throw new AeronException('client is closed');
        }

        return this.conductor.nextSessionId(streamId);
    }

    /**
     * Get the {@link CountersReader} for the Aeron media driver counters.
     *
     * @return new {@link CountersReader} for the Aeron media driver in use.
     */
    public countersReader(): CountersReader {
        if (this._isClosed) {
            throw new AeronException('client is closed');
        }

        return this.conductor.countersReader();
    }

    /**
     * Add a handler to be called when the client closes.
     *
     * @param handler to be called.
     * @return the registration id to remove it with.
     */
    public addCloseHandler(handler: () => void): number {
        return this.conductor.addCloseHandler(handler);
    }

    /**
     * Remove a close handler by the registration id that adding it returned, or (Java's deprecated overload) by the
     * handler itself.
     *
     * @param registrationIdOrHandler to remove.
     * @return true if it was removed.
     */
    public removeCloseHandler(registrationIdOrHandler: number | (() => void)): boolean {
        return this.conductor.removeCloseHandler(registrationIdOrHandler);
    }

    public toString(): string {
        return 'Aeron{isClosed=' + this._isClosed + ', clientId=' + this._clientId + '}';
    }

    /** @internal package-private in Java */
    public internalClose(): void {
        this._isClosed = true;
    }
}

type AeronContextType = AeronContext;
type AeronConfigurationType = AeronConfiguration;

// Declaration merging: `Aeron.Context` and `Aeron.Configuration` are types as well as values, as the nested Java
// classes are.
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Aeron {
    export type Context = AeronContextType;
    export type Configuration = AeronConfigurationType;
}
