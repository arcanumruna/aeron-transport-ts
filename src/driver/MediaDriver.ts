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
// Port of io/aeron/driver/MediaDriver.java @ 1.53.3 (the nested class `MediaDriver.Context`)
import dgram from 'node:dgram';
import { BitUtil } from '../agrona/BitUtil.js';
import { CloseHelper } from '../agrona/CloseHelper.js';
import type { ErrorHandler } from '../agrona/ErrorHandler.js';
import type { MutableDirectBuffer } from '../agrona/MutableDirectBuffer.js';
import { CachedEpochClock } from '../agrona/concurrent/CachedEpochClock.js';
import { CachedNanoClock } from '../agrona/concurrent/CachedNanoClock.js';
import { CountedErrorHandler } from '../agrona/concurrent/CountedErrorHandler.js';
import type { EpochClock } from '../agrona/concurrent/EpochClock.js';
import type { EpochNanoClock } from '../agrona/concurrent/EpochNanoClock.js';
import type { IdleStrategy } from '../agrona/concurrent/IdleStrategy.js';
import { OneToOneConcurrentArrayQueue } from '../agrona/concurrent/OneToOneConcurrentArrayQueue.js';
import type { NanoClock } from '../agrona/concurrent/NanoClock.js';
import { SystemEpochClock } from '../agrona/concurrent/SystemEpochClock.js';
import { SystemEpochNanoClock } from '../agrona/concurrent/SystemEpochNanoClock.js';
import { SystemNanoClock } from '../agrona/concurrent/SystemNanoClock.js';
import { UnsafeBuffer } from '../agrona/concurrent/UnsafeBuffer.js';
import { DistinctErrorLog } from '../agrona/concurrent/errors/DistinctErrorLog.js';
import { ManyToOneConcurrentLinkedQueue } from '../agrona/concurrent/ManyToOneConcurrentLinkedQueue.js';
import { BroadcastTransmitter } from '../agrona/concurrent/broadcast/BroadcastTransmitter.js';
import { ManyToOneRingBuffer } from '../agrona/concurrent/ringbuffer/ManyToOneRingBuffer.js';
import type { RingBuffer } from '../agrona/concurrent/ringbuffer/RingBuffer.js';
import { ConcurrentCountersManager } from '../agrona/concurrent/status/ConcurrentCountersManager.js';
import { CountersManager } from '../agrona/concurrent/status/CountersManager.js';
import { CountersReader } from '../agrona/concurrent/status/CountersReader.js';
import { UnsafeBufferStatusIndicator } from '../agrona/concurrent/status/UnsafeBufferStatusIndicator.js';
import { ByteOrder, IllegalArgumentException, Integer, Long, multiplyExact, TimeUnit } from '../agrona/jdk.js';
import { StandardCharsets, type AutoCloseable } from '../agrona/jdkLang.js';
import { SystemOut } from '../agrona/jdkThrowable.js';
import { SemanticVersion } from '../agrona/SemanticVersion.js';
import { Strings } from '../agrona/Strings.js';
import { SystemUtil } from '../agrona/SystemUtil.js';
import { Aeron } from '../client/Aeron.js';
import { CncFileDescriptor } from '../client/CncFileDescriptor.js';
import { CommonContext, type InferableBoolean } from '../client/CommonContext.js';
import { ControlProtocolEvents } from '../client/command/ControlProtocolEvents.js';
import { AeronException } from '../client/exceptions/AeronException.js';
import { ConfigurationException } from '../client/exceptions/ConfigurationException.js';
import { LogBufferDescriptor } from '../client/logbuffer/LogBufferDescriptor.js';
import { MemoryLogFactory } from './buffer/MemoryLogFactory.js';
import type { LogFactory } from './buffer/LogFactory.js';
import { AgentInvoker } from '../agrona/concurrent/AgentInvoker.js';
import { AgentRunner } from '../agrona/concurrent/AgentRunner.js';
import { CompositeAgent } from '../agrona/concurrent/CompositeAgent.js';
import { ConcurrentConcludeException } from '../client/exceptions/ConcurrentConcludeException.js';
import { ClientProxy } from './ClientProxy.js';
import { DriverConductor } from './DriverConductor.js';
import { NativeResourceAgent } from './NativeResourceAgent.js';
import { Receiver } from './Receiver.js';
import { Sender } from './Sender.js';
import type { Runnable } from './CommandProxy.js';
import { Configuration } from './Configuration.js';
import { DriverConductorProxy } from './DriverConductorProxy.js';
import { EmbeddedAgent } from './EmbeddedAgent.js';
import { DefaultNameResolver } from './DefaultNameResolver.js';
import type { DutyCycleTracker } from './DutyCycleTracker.js';
import { MediaDriverVersion } from './MediaDriverVersion.js';
import type { NameResolverAgent } from './NameResolverAgent.js';
import type { CongestionControlSupplier } from './CongestionControlSupplier.js';
import type { FeedbackDelayGenerator } from './FeedbackDelayGenerator.js';
import type { FlowControlSupplier } from './FlowControlSupplier.js';
import { NativeResourceAgentProxy } from './NativeResourceAgentProxy.js';
import { OptimalMulticastDelayGenerator } from './OptimalMulticastDelayGenerator.js';
import { StaticDelayGenerator } from './StaticDelayGenerator.js';
import type { TerminationValidator } from './TerminationValidator.js';
import { ReceiverProxy } from './ReceiverProxy.js';
import { SenderProxy } from './SenderProxy.js';
import { DutyCycleStallTracker } from './status/DutyCycleStallTracker.js';
import { SystemCounterDescriptor } from './status/SystemCounterDescriptor.js';
import { SystemCounters } from './status/SystemCounters.js';
import { ControlTransportPoller } from './media/ControlTransportPoller.js';
import { DataTransportPoller } from './media/DataTransportPoller.js';
import type { PortManager } from './media/PortManager.js';
import { ReceiveChannelEndpointThreadLocals } from './media/ReceiveChannelEndpointThreadLocals.js';
import type { LossReport } from './reports/LossReport.js';
import { WildcardPortManager } from './media/WildcardPortManager.js';
import type { ReceiveChannelEndpointSupplier } from './ReceiveChannelEndpointSupplier.js';
import type { SendChannelEndpointSupplier } from './SendChannelEndpointSupplier.js';
import { ThreadingMode } from './ThreadingMode.js';

function isAutoCloseable(value: unknown): value is AutoCloseable {
    return typeof (value as AutoCloseable | null)?.close === 'function';
}

/** `Arrays.toString(byte[])`: `null`, or the signed bytes in brackets. */
function bytesToString(bytes: Uint8Array | null): string {
    return null === bytes ? 'null' : '[' + Array.from(bytes, (b) => (b << 24) >> 24).join(', ') + ']';
}

/**
 * Context for the {@link MediaDriver} that can be used to override the defaults: the Java class
 * `MediaDriver.Context`, also reachable as `MediaDriver.Context`.
 * <p>
 * Only `ThreadingMode.INVOKER` is supported by this port (spec D3). The CnC is one `SharedArrayBuffer`, sized as the
 * CnC file is and never a file (spec D4). The members that name a type not ported yet, or a directory, file or thread,
 * are left out and added by the task that ports the type (see `docs/mapping.md`).
 * <p>
 * The package-private members of the Java class are public here. The fields have the Java names with a leading `_`,
 * because the accessors have the Java names.
 */
export class MediaDriverContext extends CommonContext {
    private _isClosed = false;
    private _printConfigurationOnStart: boolean = CommonContext.shouldPrintConfigurationOnStart();
    private _termBufferSparseFile: boolean = Configuration.termBufferSparseFile();
    private _performStorageChecks: boolean = Configuration.performStorageChecks();
    private _spiesSimulateConnection: boolean = Configuration.spiesSimulateConnection();
    private _reliableStream: boolean = Configuration.reliableStream();
    private _tetherSubscriptions: boolean = Configuration.tetherSubscriptions();
    private _rejoinStream: boolean = Configuration.rejoinStream();
    private _lowStorageWarningThreshold: number = Configuration.lowStorageWarningThreshold();
    private _timerIntervalNs: number = Configuration.timerIntervalNs();
    private _clientLivenessTimeoutNs: number = Configuration.clientLivenessTimeoutNs();
    private _imageLivenessTimeoutNs: number = Configuration.imageLivenessTimeoutNs();
    private _publicationUnblockTimeoutNs: number = Configuration.publicationUnblockTimeoutNs();
    private _publicationConnectionTimeoutNs: number = Configuration.publicationConnectionTimeoutNs();
    private _publicationLingerTimeoutNs: number = Configuration.publicationLingerTimeoutNs();
    private _untetheredWindowLimitTimeoutNs: number = Configuration.untetheredWindowLimitTimeoutNs();
    private _untetheredLingerTimeoutNs: number = Configuration.untetheredLingerTimeoutNs();
    private _untetheredRestingTimeoutNs: number = Configuration.untetheredRestingTimeoutNs();
    private _statusMessageTimeoutNs: number = Configuration.statusMessageTimeoutNs();
    private _counterFreeToReuseTimeoutNs: number = Configuration.counterFreeToReuseTimeoutNs();
    private _retransmitUnicastDelayNs: number = Configuration.retransmitUnicastDelayNs();
    private _retransmitUnicastLingerNs: number = Configuration.retransmitUnicastLingerNs();
    private _nakUnicastDelayNs: number = Configuration.nakUnicastDelayNs();
    private _nakUnicastRetryDelayRatio: number = Configuration.nakUnicastRetryDelayRatio();
    private _nakMulticastMaxBackoffNs: number = Configuration.nakMulticastMaxBackoffNs();
    private _flowControlReceiverTimeoutNs: number = Configuration.flowControlReceiverTimeoutNs();
    private _unicastFlowControlRetransmitReceiverWindowMultiple: number =
        Configuration.unicastFlowControlRetransmitReceiverWindowMultiple();
    private _multicastFlowControlRetransmitReceiverWindowMultiple: number =
        Configuration.multicastFlowControlRetransmitReceiverWindowMultiple();
    private _reResolutionCheckIntervalNs: number = Configuration.reResolutionCheckIntervalNs();
    private _conductorCycleThresholdNs: number = Configuration.conductorCycleThresholdNs();
    private _senderCycleThresholdNs: number = Configuration.senderCycleThresholdNs();
    private _receiverCycleThresholdNs: number = Configuration.receiverCycleThresholdNs();
    private _nameResolverThresholdNs: number = Configuration.nameResolverThresholdNs();
    private _conductorBufferLength: number = Configuration.conductorBufferLength();
    private _toClientsBufferLength: number = Configuration.toClientsBufferLength();
    private _counterValuesBufferLength: number = Configuration.counterValuesBufferLength();
    private _errorBufferLength: number = Configuration.errorBufferLength();
    private _nakMulticastGroupSize: number = Configuration.nakMulticastGroupSize();
    private _publicationTermBufferLength: number = Configuration.termBufferLength();
    private _ipcTermBufferLength: number = Configuration.ipcTermBufferLength();
    private _publicationTermWindowLength: number = Configuration.publicationTermWindowLength();
    private _ipcPublicationTermWindowLength: number = Configuration.ipcPublicationTermWindowLength();
    private _initialWindowLength: number = Configuration.initialWindowLength();
    private _socketSndbufLength: number = Configuration.socketSndbufLength();
    private _socketRcvbufLength: number = Configuration.socketRcvbufLength();
    private _socketMulticastTtl: number = Configuration.socketMulticastTtl();
    private _mtuLength: number = Configuration.mtuLength();
    private _ipcMtuLength: number = Configuration.ipcMtuLength();
    private _filePageSize: number = Configuration.filePageSize();
    private _publicationReservedSessionIdLow: number = Configuration.publicationReservedSessionIdLow();
    private _publicationReservedSessionIdHigh: number = Configuration.publicationReservedSessionIdHigh();
    private _lossReportBufferLength: number = Configuration.lossReportBufferLength();
    private _sendToStatusMessagePollRatio: number = Configuration.sendToStatusMessagePollRatio();
    private _resourceFreeLimit: number = Configuration.resourceFreeLimit();
    private _maxResend: number = Configuration.maxResend();
    private _receiverGroupTag: number | null = Configuration.groupTag();
    private _flowControlGroupMinSize: number = Configuration.flowControlGroupMinSize();
    private _receiverGroupConsideration: InferableBoolean = Configuration.receiverGroupConsideration();
    private _resolverName: string | null = Configuration.resolverName();
    private _resolverInterface: string | null = Configuration.resolverInterface();
    private _resolverBootstrapNeighbor: string | null = Configuration.resolverBootstrapNeighbor();
    private _senderWildcardPortRange: string | null = Configuration.senderWildcardPortRange();
    private _receiverWildcardPortRange: string | null = Configuration.receiverWildcardPortRange();
    private _osDefaultSocketRcvbufLength = Aeron.NULL_VALUE;
    private _osMaxSocketRcvbufLength = Aeron.NULL_VALUE;
    private _osDefaultSocketSndbufLength = Aeron.NULL_VALUE;
    private _osMaxSocketSndbufLength = Aeron.NULL_VALUE;
    private _senderPortManager: PortManager | null = null;
    private _receiverPortManager: PortManager | null = null;
    private _sendChannelEndpointSupplier: SendChannelEndpointSupplier | null = null;
    private _receiveChannelEndpointSupplier: ReceiveChannelEndpointSupplier | null = null;
    private _receiveChannelEndpointThreadLocals: ReceiveChannelEndpointThreadLocals | null = null;
    private _dataTransportPoller: DataTransportPoller | null = null;
    private _controlTransportPoller: ControlTransportPoller | null = null;
    private _logFactory: LogFactory | null = null;
    private _unicastFlowControlSupplier: FlowControlSupplier | null = null;
    private _multicastFlowControlSupplier: FlowControlSupplier | null = null;
    private _congestionControlSupplier: CongestionControlSupplier | null = null;
    private _retransmitUnicastDelayGenerator: FeedbackDelayGenerator | null = null;
    private _retransmitUnicastLingerGenerator: FeedbackDelayGenerator | null = null;
    private _unicastFeedbackDelayGenerator: FeedbackDelayGenerator | null = null;
    private _multicastFeedbackDelayGenerator: FeedbackDelayGenerator | null = null;
    private _terminationValidator: TerminationValidator | null = null;
    private _nativeResourceAgentCommandQueue: OneToOneConcurrentArrayQueue<() => void> | null = null;
    private _nativeResourceAgentProxy: NativeResourceAgentProxy | null = null;
    private _receiverCommandQueue: OneToOneConcurrentArrayQueue<() => void> | null = null;
    private _senderCommandQueue: OneToOneConcurrentArrayQueue<() => void> | null = null;
    private _receiverProxy: ReceiverProxy | null = null;
    private _senderProxy: SenderProxy | null = null;
    private _lossReport: LossReport | null = null;
    private _epochClock: EpochClock | null = null;
    private _nanoClock: NanoClock | null = null;
    private _cachedEpochClock: CachedEpochClock | null = null;
    private _cachedNanoClock: CachedNanoClock | null = null;
    private _senderCachedNanoClock: CachedNanoClock | null = null;
    private _receiverCachedNanoClock: CachedNanoClock | null = null;
    private _threadingMode: ThreadingMode | null = null;
    private _wakeUp: (() => void) | null = null;
    private _conductorIdleStrategy: IdleStrategy | null = null;
    private _senderIdleStrategy: IdleStrategy | null = null;
    private _receiverIdleStrategy: IdleStrategy | null = null;
    private _sharedNetworkIdleStrategy: IdleStrategy | null = null;
    private _sharedIdleStrategy: IdleStrategy | null = null;
    private _tempBuffer: MutableDirectBuffer | null = null;
    private _applicationSpecificFeedback: Uint8Array | null = null;
    private _terminationHook: (() => void) | null = null;
    private _nameResolver: NameResolverAgent | null = null;
    private _errorLog: DistinctErrorLog | null = null;
    private _errorHandler: ErrorHandler | null = null;
    private _countedErrorHandler: CountedErrorHandler | null = null;
    private _useConcurrentCountersManager = false;
    private _countersManager: CountersManager | null = null;
    private _systemCounters: SystemCounters | null = null;
    private _driverCommandQueue: ManyToOneConcurrentLinkedQueue<Runnable> | null = null;
    private _driverConductorProxy: DriverConductorProxy | null = null;
    private _clientProxy: ClientProxy | null = null;
    private _toDriverCommands: RingBuffer | null = null;
    private _cncByteBuffer: SharedArrayBuffer | null = null;
    private _cncMetaDataBuffer: UnsafeBuffer | null = null;
    private _channelReceiveTimestampClock: EpochNanoClock | null = null;
    private _channelSendTimestampClock: EpochNanoClock | null = null;
    private _conductorDutyCycleTracker: DutyCycleTracker | null = null;
    private _senderDutyCycleTracker: DutyCycleTracker | null = null;
    private _receiverDutyCycleTracker: DutyCycleTracker | null = null;
    private _nameResolverTimeTracker: DutyCycleTracker | null = null;
    private _streamSessionLimit: number = Configuration.streamSessionLimit();
    private _resolverNeighbourTimeoutNs: number = Configuration.resolverNeighborTimeoutNs();
    private _resolverSelfResolutionIntervalNs: number = Configuration.resolverSelfResolutionIntervalNs();
    private _resolverNeighborResolutionIntervalNs: number = Configuration.resolverNeighborResolutionIntervalNs();
    private _resolverBootstrapNeighborResolutionIntervalNs: number =
        Configuration.resolverBootstrapNeighborResolutionIntervalNs();

    public override close(): void {
        if (!this._isClosed) {
            this._isClosed = true;

            CloseHelper.close(this._errorHandler, this._logFactory);
            CloseHelper.close(this._errorHandler, this._countedErrorHandler);

            if (null !== this._systemCounters) {
                const errorCounter = this._systemCounters.get(SystemCounterDescriptor.ERRORS);
                errorCounter.disconnectCountersManager();
                errorCounter.close();
            }

            if (isAutoCloseable(this._errorHandler)) {
                CloseHelper.quietClose(this._errorHandler);
            }

            // BufferUtil.free(cncByteBuffer): the CnC is garbage collected (spec D4)
            this._cncByteBuffer = null;

            super.close();
        }
    }

    public override conclude(): this {
        super.conclude();

        // Java wraps the body in try / catch (Exception) and rethrows it unchecked: JS has no checked exceptions.
        this.concludeNullProperties();
        this.resolveOsSocketBufLengths();

        Configuration.validateMtuLength(this._mtuLength);
        Configuration.validateMtuLength(this._ipcMtuLength);
        Configuration.validatePageSize(this._filePageSize);
        Configuration.validateValueRange(
            this._conductorBufferLength,
            Configuration.CONDUCTOR_BUFFER_LENGTH_DEFAULT,
            Integer.MAX_VALUE,
            'conductorBufferLength',
        );
        Configuration.validateValueRange(
            this._toClientsBufferLength,
            Configuration.TO_CLIENTS_BUFFER_LENGTH_DEFAULT,
            Integer.MAX_VALUE,
            'toClientsBufferLength',
        );
        Configuration.validateValueRange(
            this._counterValuesBufferLength,
            Configuration.COUNTERS_VALUES_BUFFER_LENGTH_MIN,
            Configuration.COUNTERS_VALUES_BUFFER_LENGTH_MAX,
            'counterValuesBufferLength',
        );
        Configuration.validateValueRange(
            this._errorBufferLength,
            Configuration.ERROR_BUFFER_LENGTH_DEFAULT,
            Integer.MAX_VALUE,
            'errorBufferLength',
        );
        Configuration.validateValueRange(
            this._publicationTermWindowLength,
            0,
            LogBufferDescriptor.TERM_MAX_LENGTH,
            'publicationTermWindowLength',
        );
        Configuration.validateValueRange(
            this._ipcPublicationTermWindowLength,
            0,
            LogBufferDescriptor.TERM_MAX_LENGTH,
            'ipcPublicationTermWindowLength',
        );
        Configuration.validateValueRange(
            this._nakUnicastDelayNs,
            Configuration.NAK_UNICAST_DELAY_MIN_VALUE_NS,
            Long.MAX_VALUE,
            'nakUnicastDelayNs',
        );
        Configuration.validateValueRange(
            this._nakUnicastRetryDelayRatio,
            1,
            Long.MAX_VALUE,
            'nakUnicastRetryDelayRatio',
        );
        multiplyExact(this._nakUnicastDelayNs, this._nakUnicastRetryDelayRatio);

        Configuration.validateSessionIdRange(
            this._publicationReservedSessionIdLow,
            this._publicationReservedSessionIdHigh,
        );

        LogBufferDescriptor.checkTermLength(this._publicationTermBufferLength);
        LogBufferDescriptor.checkTermLength(this._ipcTermBufferLength);

        Configuration.validateInitialWindowLength(this._initialWindowLength, this._mtuLength);

        Configuration.validateUnblockTimeout(
            this.publicationUnblockTimeoutNs(),
            this.clientLivenessTimeoutNs(),
            this._timerIntervalNs,
        );

        Configuration.validateUntetheredTimeouts(
            this._untetheredWindowLimitTimeoutNs,
            this._untetheredLingerTimeoutNs,
            this._untetheredRestingTimeoutNs,
            this._timerIntervalNs,
        );

        Configuration.validateValueRange(
            this._unicastFlowControlRetransmitReceiverWindowMultiple,
            1,
            Integer.MAX_VALUE,
            'unicastFlowControlRetransmitReceiverWindowMultiple',
        );

        Configuration.validateValueRange(
            this._multicastFlowControlRetransmitReceiverWindowMultiple,
            1,
            Integer.MAX_VALUE,
            'multicastFControlRetransmitReceiverWindowMultiple',
        );

        // The CnC is one SharedArrayBuffer (spec D4), sized as Java sizes the CnC file and aligned to filePageSize.
        const cncFileLength = BitUtil.alignLong(
            CncFileDescriptor.META_DATA_LENGTH +
                this._conductorBufferLength +
                this._toClientsBufferLength +
                Configuration.countersMetadataBufferLength(this._counterValuesBufferLength) +
                this._counterValuesBufferLength +
                this._errorBufferLength,
            this._filePageSize,
        );

        Configuration.validateValueRange(cncFileLength, 0, Integer.MAX_VALUE, 'CnC file length');

        this._cncByteBuffer = new SharedArrayBuffer(cncFileLength);
        this._cncMetaDataBuffer = CncFileDescriptor.createMetaDataBuffer(this._cncByteBuffer);

        CncFileDescriptor.fillMetaData(
            this._cncMetaDataBuffer,
            this._conductorBufferLength,
            this._toClientsBufferLength,
            Configuration.countersMetadataBufferLength(this._counterValuesBufferLength),
            this._counterValuesBufferLength,
            this._clientLivenessTimeoutNs,
            this._errorBufferLength,
            (this._epochClock as EpochClock).time(),
            process.pid,
            this._filePageSize,
        );

        this.concludeCounters();

        this.concludeDependantProperties();

        this.concludeIdleStrategies();

        // Java adds lossReportBufferLength: there is no loss report file here (spec section 3).
        (this._systemCounters as SystemCounters)
            .get(SystemCounterDescriptor.BYTES_CURRENTLY_MAPPED)
            .setRelease(cncFileLength);

        const toDriverCommands = this._toDriverCommands as RingBuffer;
        toDriverCommands.nextCorrelationId();
        toDriverCommands.consumerHeartbeatTime((this._epochClock as EpochClock).time());

        CncFileDescriptor.signalCncReady(this._cncMetaDataBuffer);

        if (this._printConfigurationOnStart) {
            SystemOut.println(this.toString());
        }

        return this;
    }

    /**
     * Should the driver print its configuration on start to {@link System#out} at the end of {@link #conclude()}.
     *
     * @return true if the configuration should be printed on start.
     * @see CommonContext#PRINT_CONFIGURATION_ON_START_PROP_NAME
     */
    public printConfigurationOnStart(): boolean;
    /**
     * Should the driver print its configuration on start to {@link System#out} at the end of {@link #conclude()}.
     *
     * @param printConfigurationOnStart if the configuration should be printed on start.
     * @return this for a fluent API.
     * @see CommonContext#PRINT_CONFIGURATION_ON_START_PROP_NAME
     */
    public printConfigurationOnStart(printConfigurationOnStart: boolean): this;
    public printConfigurationOnStart(printConfigurationOnStart?: boolean): boolean | this {
        if (undefined === printConfigurationOnStart) {
            return this._printConfigurationOnStart;
        }

        this._printConfigurationOnStart = printConfigurationOnStart;
        return this;
    }

    /**
     * Should the term buffers be created with sparse files?
     *
     * @return should the term buffers be created with sparse files?
     * @see Configuration#TERM_BUFFER_SPARSE_FILE_PROP_NAME
     */
    public termBufferSparseFile(): boolean;
    /**
     * Should the term buffer be created with sparse files?
     *
     * @param termBufferSparseFile should the term buffers be created with sparse files?
     * @return this for a fluent API.
     * @see Configuration#TERM_BUFFER_SPARSE_FILE_PROP_NAME
     */
    public termBufferSparseFile(termBufferSparseFile: boolean): this;
    public termBufferSparseFile(termBufferSparseFile?: boolean): boolean | this {
        if (undefined === termBufferSparseFile) {
            return this._termBufferSparseFile;
        }

        this._termBufferSparseFile = termBufferSparseFile;
        return this;
    }

    /**
     * Length of the {@link RingBuffer} for sending commands to the driver conductor from clients.
     *
     * @return length of the {@link RingBuffer} for sending commands to the driver conductor from clients.
     * @see Configuration#CONDUCTOR_BUFFER_LENGTH_PROP_NAME
     */
    public conductorBufferLength(): number;
    /**
     * Length of the {@link RingBuffer} for sending commands to the driver conductor from clients.
     *
     * @param length of the {@link RingBuffer} for sending commands to the driver conductor from clients.
     * @return this for a fluent API.
     * @see Configuration#CONDUCTOR_BUFFER_LENGTH_PROP_NAME
     */
    public conductorBufferLength(length: number): this;
    public conductorBufferLength(length?: number): number | this {
        if (undefined === length) {
            return this._conductorBufferLength;
        }

        this._conductorBufferLength = length;
        return this;
    }

    /**
     * Length of the {@link BroadcastTransmitter} buffer for sending events to the clients.
     *
     * @return length of the {@link BroadcastTransmitter} buffer for sending events to the clients.
     * @see Configuration#TO_CLIENTS_BUFFER_LENGTH_PROP_NAME
     */
    public toClientsBufferLength(): number;
    /**
     * Length of the {@link BroadcastTransmitter} buffer for sending events to the clients.
     *
     * @param length of the {@link BroadcastTransmitter} buffer for sending events to the clients.
     * @return this for a fluent API.
     * @see Configuration#TO_CLIENTS_BUFFER_LENGTH_PROP_NAME
     */
    public toClientsBufferLength(length: number): this;
    public toClientsBufferLength(length?: number): number | this {
        if (undefined === length) {
            return this._toClientsBufferLength;
        }

        this._toClientsBufferLength = length;
        return this;
    }

    /**
     * Length of the buffer for storing values by the {@link CountersManager}.
     *
     * @return length of the buffer for storing values by the {@link CountersManager}.
     * @see Configuration#COUNTERS_VALUES_BUFFER_LENGTH_PROP_NAME
     */
    public counterValuesBufferLength(): number;
    /**
     * Length of the buffer for storing values by the {@link CountersManager}.
     *
     * @param length of the buffer for storing values by the {@link CountersManager}.
     * @return this for a fluent API.
     * @see Configuration#COUNTERS_VALUES_BUFFER_LENGTH_PROP_NAME
     */
    public counterValuesBufferLength(length: number): this;
    public counterValuesBufferLength(length?: number): number | this {
        if (undefined === length) {
            return this._counterValuesBufferLength;
        }

        this._counterValuesBufferLength = length;
        return this;
    }

    /**
     * Length of the {@link DistinctErrorLog} buffer for recording exceptions.
     *
     * @return length of the {@link DistinctErrorLog} buffer for recording exceptions.
     * @see Configuration#ERROR_BUFFER_LENGTH_PROP_NAME
     */
    public errorBufferLength(): number;
    /**
     * Length of the {@link DistinctErrorLog} buffer for recording exceptions.
     *
     * @param length of the {@link DistinctErrorLog} buffer for recording exceptions.
     * @return this for a fluent API.
     * @see Configuration#ERROR_BUFFER_LENGTH_PROP_NAME
     */
    public errorBufferLength(length: number): this;
    public errorBufferLength(length?: number): number | this {
        if (undefined === length) {
            return this._errorBufferLength;
        }

        this._errorBufferLength = length;
        return this;
    }

    /**
     * Should the driver perform storage checks when allocating files.
     *
     * @return true if the driver should perform storage checks when allocating files.
     * @see Configuration#PERFORM_STORAGE_CHECKS_PROP_NAME
     */
    public performStorageChecks(): boolean;
    /**
     * Should the driver perform storage checks when allocating files.
     *
     * @param performStorageChecks true if the driver should perform storage checks when allocating files.
     * @return this for a fluent API.
     * @see Configuration#PERFORM_STORAGE_CHECKS_PROP_NAME
     */
    public performStorageChecks(performStorageChecks: boolean): this;
    public performStorageChecks(performStorageChecks?: boolean): boolean | this {
        if (undefined === performStorageChecks) {
            return this._performStorageChecks;
        }

        this._performStorageChecks = performStorageChecks;
        return this;
    }

    /**
     * Get the threshold in bytes below which storage warnings are issued.
     *
     * @return the threshold below which storage warnings are issued.
     * @see Configuration#LOW_FILE_STORE_WARNING_THRESHOLD_PROP_NAME
     */
    public lowStorageWarningThreshold(): number;
    /**
     * Get the threshold in bytes below which storage warnings are issued.
     *
     * @param lowStorageWarningThreshold to be set in bytes.
     * @return this for a fluent API.
     * @see Configuration#LOW_FILE_STORE_WARNING_THRESHOLD_PROP_NAME
     */
    public lowStorageWarningThreshold(lowStorageWarningThreshold: number): this;
    public lowStorageWarningThreshold(lowStorageWarningThreshold?: number): number | this {
        if (undefined === lowStorageWarningThreshold) {
            return this._lowStorageWarningThreshold;
        }

        this._lowStorageWarningThreshold = lowStorageWarningThreshold;
        return this;
    }

    /**
     * The length in bytes of the loss report buffer.
     *
     * @return the length in bytes of the loss report buffer.
     * @see Configuration#LOSS_REPORT_BUFFER_LENGTH_PROP_NAME
     */
    public lossReportBufferLength(): number;
    /**
     * The length in bytes of the loss report buffer.
     *
     * @param length of the buffer to be used for the loss report.
     * @return this for a fluent API.
     * @see Configuration#LOSS_REPORT_BUFFER_LENGTH_PROP_NAME
     */
    public lossReportBufferLength(length: number): this;
    public lossReportBufferLength(length?: number): number | this {
        if (undefined === length) {
            return this._lossReportBufferLength;
        }

        this._lossReportBufferLength = length;
        return this;
    }

    /**
     * Page size for alignment of all files.
     *
     * @return page size for alignment of all files.
     * @see Configuration#FILE_PAGE_SIZE_PROP_NAME
     */
    public filePageSize(): number;
    /**
     * Page size for alignment of all files.
     *
     * @param filePageSize for alignment of file sizes.
     * @return this for a fluent API.
     * @see Configuration#FILE_PAGE_SIZE_PROP_NAME
     */
    public filePageSize(filePageSize: number): this;
    public filePageSize(filePageSize?: number): number | this {
        if (undefined === filePageSize) {
            return this._filePageSize;
        }

        this._filePageSize = filePageSize;
        return this;
    }

    /**
     * Interval in nanoseconds between checks for timers and timeouts.
     *
     * @return nanoseconds between checks for timers and timeouts.
     * @see Configuration#TIMER_INTERVAL_PROP_NAME
     */
    public timerIntervalNs(): number;
    /**
     * Interval in nanoseconds between checks for timers and timeouts.
     *
     * @param timerIntervalNs nanoseconds between checks for timers and timeouts.
     * @return this for a fluent API.
     * @see Configuration#TIMER_INTERVAL_PROP_NAME
     */
    public timerIntervalNs(timerIntervalNs: number): this;
    public timerIntervalNs(timerIntervalNs?: number): number | this {
        if (undefined === timerIntervalNs) {
            return this._timerIntervalNs;
        }

        this._timerIntervalNs = timerIntervalNs;
        return this;
    }

    /**
     * Time in nanoseconds an Image will be kept alive for its subscribers to consume it once disconnected.
     *
     * @return nanoseconds that an Image will be kept alive for its subscribers to consume it.
     * @see Configuration#IMAGE_LIVENESS_TIMEOUT_PROP_NAME
     */
    public imageLivenessTimeoutNs(): number;
    /**
     * Time in nanoseconds an Image will be kept alive after for its subscribers to consume it once disconnected.
     *
     * @param timeout for keeping an image alive for its subscribers to consume it.
     * @return this for a fluent API.
     * @see Configuration#IMAGE_LIVENESS_TIMEOUT_PROP_NAME
     */
    public imageLivenessTimeoutNs(timeout: number): this;
    public imageLivenessTimeoutNs(timeout?: number): number | this {
        if (undefined === timeout) {
            return this._imageLivenessTimeoutNs;
        }

        this._imageLivenessTimeoutNs = timeout;
        return this;
    }

    /**
     * Time in nanoseconds a publication will linger once it is drained to recover potential tail loss.
     *
     * @return nanoseconds that a publication will linger once it is drained.
     * @see Configuration#PUBLICATION_LINGER_PROP_NAME
     */
    public publicationLingerTimeoutNs(): number;
    /**
     * Time in nanoseconds a publication will linger once it is drained to recover potential tail loss.
     *
     * @param timeoutNs for keeping a publication once it is drained.
     * @return this for a fluent API.
     * @see Configuration#PUBLICATION_LINGER_PROP_NAME
     */
    public publicationLingerTimeoutNs(timeoutNs: number): this;
    public publicationLingerTimeoutNs(timeoutNs?: number): number | this {
        if (undefined === timeoutNs) {
            return this._publicationLingerTimeoutNs;
        }

        this._publicationLingerTimeoutNs = timeoutNs;
        return this;
    }

    /**
     * The timeout for when an untethered subscription that is outside the window will participate
     * in local flow control.
     *
     * @return timeout that an untethered subscription outside the window limit will participate in flow control.
     * @see Configuration#UNTETHERED_WINDOW_LIMIT_TIMEOUT_PROP_NAME
     */
    public untetheredWindowLimitTimeoutNs(): number;
    /**
     * The timeout for when an untethered subscription that is outside the window will participate
     * in local flow control.
     *
     * @param timeoutNs that an untethered subscription outside the window limit will participate in flow control.
     * @return this for a fluent API.
     * @see Configuration#UNTETHERED_WINDOW_LIMIT_TIMEOUT_PROP_NAME
     */
    public untetheredWindowLimitTimeoutNs(timeoutNs: number): this;
    public untetheredWindowLimitTimeoutNs(timeoutNs?: number): number | this {
        if (undefined === timeoutNs) {
            return this._untetheredWindowLimitTimeoutNs;
        }

        this._untetheredWindowLimitTimeoutNs = timeoutNs;
        return this;
    }

    /**
     * The linger timeout for an untethered subscription.
     *
     * @return timeout that an untethered subscription will linger.
     * @see Configuration#UNTETHERED_LINGER_TIMEOUT_PROP_NAME
     * @since 1.48.0
     */
    public untetheredLingerTimeoutNs(): number;
    /**
     * The timeout for when an untethered subscription that is outside the window will participate
     * in local flow control.
     *
     * @param timeoutNs that an untethered subscription to linger.
     * @return this for a fluent API.
     * @see Configuration#UNTETHERED_LINGER_TIMEOUT_PROP_NAME
     */
    public untetheredLingerTimeoutNs(timeoutNs: number): this;
    public untetheredLingerTimeoutNs(timeoutNs?: number): number | this {
        if (undefined === timeoutNs) {
            return this._untetheredLingerTimeoutNs;
        }

        this._untetheredLingerTimeoutNs = timeoutNs;
        return this;
    }

    /**
     * Timeout for when an untethered subscription is resting after not being able to keep up before it is allowed
     * to rejoin a stream.
     *
     * @return timeout that an untethered subscription is resting before being allowed to rejoin a stream.
     * @see Configuration#UNTETHERED_RESTING_TIMEOUT_PROP_NAME
     */
    public untetheredRestingTimeoutNs(): number;
    /**
     * Timeout for when an untethered subscription is resting after not being able to keep up before it is allowed
     * to rejoin a stream.
     *
     * @param timeoutNs that an untethered subscription is resting before being allowed to rejoin a stream.
     * @return this for a fluent API.
     * @see Configuration#UNTETHERED_RESTING_TIMEOUT_PROP_NAME
     */
    public untetheredRestingTimeoutNs(timeoutNs: number): this;
    public untetheredRestingTimeoutNs(timeoutNs?: number): number | this {
        if (undefined === timeoutNs) {
            return this._untetheredRestingTimeoutNs;
        }

        this._untetheredRestingTimeoutNs = timeoutNs;
        return this;
    }

    /**
     * The delay before retransmitting after a NAK.
     *
     * @return delay before retransmitting after a NAK.
     * @see Configuration#RETRANSMIT_UNICAST_DELAY_PROP_NAME
     */
    public retransmitUnicastDelayNs(): number;
    /**
     * The delay before retransmitting after a NAK.
     *
     * @param retransmitUnicastDelayNs delay before retransmitting after a NAK.
     * @return this for a fluent API.
     * @see Configuration#RETRANSMIT_UNICAST_DELAY_PROP_NAME
     */
    public retransmitUnicastDelayNs(retransmitUnicastDelayNs: number): this;
    public retransmitUnicastDelayNs(retransmitUnicastDelayNs?: number): number | this {
        if (undefined === retransmitUnicastDelayNs) {
            return this._retransmitUnicastDelayNs;
        }

        this._retransmitUnicastDelayNs = retransmitUnicastDelayNs;
        return this;
    }

    /**
     * How long to linger after delay on a NAK before responding to another NAK.
     *
     * @return how long to linger after delay on a NAK before responding to another NAK.
     * @see Configuration#RETRANSMIT_UNICAST_LINGER_PROP_NAME
     */
    public retransmitUnicastLingerNs(): number;
    /**
     * How long to linger after delay on a NAK before responding to another NAK.
     *
     * @param retransmitUnicastLingerNs how long to linger after delay on a NAK before responding to another NAK.
     * @return this for a fluent API.
     * @see Configuration#RETRANSMIT_UNICAST_LINGER_PROP_NAME
     */
    public retransmitUnicastLingerNs(retransmitUnicastLingerNs: number): this;
    public retransmitUnicastLingerNs(retransmitUnicastLingerNs?: number): number | this {
        if (undefined === retransmitUnicastLingerNs) {
            return this._retransmitUnicastLingerNs;
        }

        this._retransmitUnicastLingerNs = retransmitUnicastLingerNs;
        return this;
    }

    /**
     * The delay before retransmission after an NAK on unicast.
     *
     * @return delay before retransmitting after a NAK.
     * @see Configuration#NAK_UNICAST_DELAY_PROP_NAME
     */
    public nakUnicastDelayNs(): number;
    /**
     * The delay before retransmission after an NAK on unicast.
     *
     * @param nakUnicastDelayNs delay before retransmission after an NAK on unicast.
     * @return this for a fluent API.
     * @see Configuration#NAK_UNICAST_DELAY_PROP_NAME
     * @see Configuration#NAK_UNICAST_DELAY_DEFAULT_NS
     */
    public nakUnicastDelayNs(nakUnicastDelayNs: number): this;
    public nakUnicastDelayNs(nakUnicastDelayNs?: number): number | this {
        if (undefined === nakUnicastDelayNs) {
            return this._nakUnicastDelayNs;
        }

        this._nakUnicastDelayNs = nakUnicastDelayNs;
        return this;
    }

    /**
     * The ratio to apply to the retry delay for unicast.
     *
     * @return ratio to apply to the retry delay for unicast
     * @see #nakUnicastRetryDelayRatio(long)
     */
    public nakUnicastRetryDelayRatio(): number;
    /**
     * The ratio to apply to the retry delay for unicast. This will be a multiplier applied to the
     * {@link #nakUnicastDelayNs} when constructing the {@link StaticDelayGenerator} used for handling delays on
     * unicast NAKs.
     *
     * @param nakUnicastRetryDelayRatio to multiply the {@link #nakUnicastDelayNs} by to calculate the retry delay.
     * @return this for a fluent API.
     * @see Configuration#NAK_UNICAST_RETRY_DELAY_RATIO_PROP_NAME
     * @see Configuration#NAK_UNICAST_RETRY_DELAY_RATIO_DEFAULT
     */
    public nakUnicastRetryDelayRatio(nakUnicastRetryDelayRatio: number): this;
    public nakUnicastRetryDelayRatio(nakUnicastRetryDelayRatio?: number): number | this {
        if (undefined === nakUnicastRetryDelayRatio) {
            return this._nakUnicastRetryDelayRatio;
        }

        this._nakUnicastRetryDelayRatio = nakUnicastRetryDelayRatio;
        return this;
    }

    /**
     * The maximum time to backoff before sending a NAK on multicast.
     *
     * @return maximum time to backoff before sending a NAK on multicast.
     * @see Configuration#NAK_MULTICAST_MAX_BACKOFF_PROP_NAME
     */
    public nakMulticastMaxBackoffNs(): number;
    /**
     * The maximum time to backoff before sending a NAK on multicast.
     *
     * @param nakMulticastMaxBackoffNs maximum time to backoff before sending a NAK on multicast.
     * @return this for a fluent API.
     * @see Configuration#NAK_MULTICAST_MAX_BACKOFF_PROP_NAME
     */
    public nakMulticastMaxBackoffNs(nakMulticastMaxBackoffNs: number): this;
    public nakMulticastMaxBackoffNs(nakMulticastMaxBackoffNs?: number): number | this {
        if (undefined === nakMulticastMaxBackoffNs) {
            return this._nakMulticastMaxBackoffNs;
        }

        this._nakMulticastMaxBackoffNs = nakMulticastMaxBackoffNs;
        return this;
    }

    /**
     * Estimate of the multicast receiver group size on a stream.
     *
     * @return estimate of the multicast receiver group size on a stream.
     * @see Configuration#NAK_MULTICAST_GROUP_SIZE_PROP_NAME
     */
    public nakMulticastGroupSize(): number;
    /**
     * Estimate of the multicast receiver group size on a stream.
     *
     * @param nakMulticastGroupSize estimate of the multicast receiver group size on a stream.
     * @return this for a fluent API.
     * @see Configuration#NAK_MULTICAST_GROUP_SIZE_PROP_NAME
     */
    public nakMulticastGroupSize(nakMulticastGroupSize: number): this;
    public nakMulticastGroupSize(nakMulticastGroupSize?: number): number | this {
        if (undefined === nakMulticastGroupSize) {
            return this._nakMulticastGroupSize;
        }

        this._nakMulticastGroupSize = nakMulticastGroupSize;
        return this;
    }

    /**
     * Time in nanoseconds after which a client is considered dead if a keep alive is not received.
     *
     * @return time in nanoseconds after which a client is considered dead if a keep alive is not received.
     * @see Configuration#CLIENT_LIVENESS_TIMEOUT_PROP_NAME
     */
    public clientLivenessTimeoutNs(): number;
    /**
     * Time in nanoseconds after which a client is considered dead if a keep alive is not received.
     *
     * @param timeoutNs in nanoseconds after which a client is considered dead if a keep alive is not received.
     * @return this for a fluent API.
     * @see Configuration#CLIENT_LIVENESS_TIMEOUT_PROP_NAME
     */
    public clientLivenessTimeoutNs(timeoutNs: number): this;
    public clientLivenessTimeoutNs(timeoutNs?: number): number | this {
        if (undefined === timeoutNs) {
            return CommonContext.checkDebugTimeout(this._clientLivenessTimeoutNs, TimeUnit.NANOSECONDS);
        }

        this._clientLivenessTimeoutNs = timeoutNs;
        return this;
    }

    /**
     * Time in nanoseconds after which a status message will be sent if data is flowing slowly.
     *
     * @return time in nanoseconds after which a status message will be sent if data is flowing slowly.
     * @see Configuration#STATUS_MESSAGE_TIMEOUT_PROP_NAME
     */
    public statusMessageTimeoutNs(): number;
    /**
     * Time in nanoseconds after which a status message will be sent if data is flowing slowly.
     *
     * @param statusMessageTimeoutNs after which a status message will be sent if data is flowing slowly.
     * @return this for a fluent API.
     * @see Configuration#STATUS_MESSAGE_TIMEOUT_PROP_NAME
     */
    public statusMessageTimeoutNs(statusMessageTimeoutNs: number): this;
    public statusMessageTimeoutNs(statusMessageTimeoutNs?: number): number | this {
        if (undefined === statusMessageTimeoutNs) {
            return this._statusMessageTimeoutNs;
        }

        this._statusMessageTimeoutNs = statusMessageTimeoutNs;
        return this;
    }

    /**
     * Time in nanoseconds after which a freed counter may be reused.
     *
     * @return time in nanoseconds after which a freed counter may be reused.
     * @see Configuration#COUNTER_FREE_TO_REUSE_TIMEOUT_PROP_NAME
     */
    public counterFreeToReuseTimeoutNs(): number;
    /**
     * Time in nanoseconds after which a freed counter may be reused.
     *
     * @param counterFreeToReuseTimeoutNs after which a freed counter may be reused.
     * @return this for a fluent API.
     * @see Configuration#COUNTER_FREE_TO_REUSE_TIMEOUT_PROP_NAME
     */
    public counterFreeToReuseTimeoutNs(counterFreeToReuseTimeoutNs: number): this;
    public counterFreeToReuseTimeoutNs(counterFreeToReuseTimeoutNs?: number): number | this {
        if (undefined === counterFreeToReuseTimeoutNs) {
            return this._counterFreeToReuseTimeoutNs;
        }

        this._counterFreeToReuseTimeoutNs = counterFreeToReuseTimeoutNs;
        return this;
    }

    /**
     * Timeout in nanoseconds after which a publication will be unblocked if an offer is partially complete to allow
     * other publishers to make progress.
     * <p>
     * A publication can become blocked if the client crashes while publishing or if
     * {@link io.aeron.Publication#tryClaim(int, BufferClaim)} is used without following up by calling
     * {@link BufferClaim#commit()} or {@link BufferClaim#abort()}.
     *
     * @return timeout in nanoseconds after which a publication will be unblocked.
     * @see Configuration#PUBLICATION_UNBLOCK_TIMEOUT_PROP_NAME
     */
    public publicationUnblockTimeoutNs(): number;
    /**
     * Timeout in nanoseconds after which a publication will be unblocked if an offer is partially complete to allow
     * other publishers to make progress.
     * <p>
     * A publication can become blocked if the client crashes while publishing or if
     * {@link io.aeron.Publication#tryClaim(int, BufferClaim)} is used without following up by calling
     * {@link BufferClaim#commit()} or {@link BufferClaim#abort()}.
     *
     * @param timeoutNs in nanoseconds after which a publication will be unblocked.
     * @return this for a fluent API.
     * @see Configuration#PUBLICATION_UNBLOCK_TIMEOUT_PROP_NAME
     */
    public publicationUnblockTimeoutNs(timeoutNs: number): this;
    public publicationUnblockTimeoutNs(timeoutNs?: number): number | this {
        if (undefined === timeoutNs) {
            return CommonContext.checkDebugTimeout(this._publicationUnblockTimeoutNs, TimeUnit.NANOSECONDS, 1.5);
        }

        this._publicationUnblockTimeoutNs = timeoutNs;
        return this;
    }

    /**
     * Timeout in nanoseconds after which a publication will be considered not connected if no status messages are
     * received.
     *
     * @return timeout in nanoseconds after which a publication is considered not connected.
     * @see Configuration#PUBLICATION_CONNECTION_TIMEOUT_PROP_NAME
     */
    public publicationConnectionTimeoutNs(): number;
    /**
     * Timeout in nanoseconds after which a publication will be considered not connected if no status messages are
     * received.
     *
     * @param timeoutNs in nanoseconds after which a publication will be considered not connected.
     * @return this for a fluent API.
     * @see Configuration#PUBLICATION_CONNECTION_TIMEOUT_PROP_NAME
     */
    public publicationConnectionTimeoutNs(timeoutNs: number): this;
    public publicationConnectionTimeoutNs(timeoutNs?: number): number | this {
        if (undefined === timeoutNs) {
            return this._publicationConnectionTimeoutNs;
        }

        this._publicationConnectionTimeoutNs = timeoutNs;
        return this;
    }

    /**
     * Does a spy subscription simulate a connection to a network publication.
     * <p>
     * If true then this will override the min group size of the min and tagged flow control strategies.
     *
     * @return true if a spy subscription should simulate a connection to a network publication.
     * @see Configuration#SPIES_SIMULATE_CONNECTION_PROP_NAME
     */
    public spiesSimulateConnection(): boolean;
    /**
     * Does a spy subscription simulate a connection to a network publication.
     * <p>
     * If true then this will override the min group size of the min and tagged flow control strategies.
     *
     * @param spiesSimulateConnection true if a spy subscription simulates a connection to a network publication.
     * @return this for a fluent API.
     * @see Configuration#SPIES_SIMULATE_CONNECTION_PROP_NAME
     */
    public spiesSimulateConnection(spiesSimulateConnection: boolean): this;
    public spiesSimulateConnection(spiesSimulateConnection?: boolean): boolean | this {
        if (undefined === spiesSimulateConnection) {
            return this._spiesSimulateConnection;
        }

        this._spiesSimulateConnection = spiesSimulateConnection;
        return this;
    }

    /**
     * Does a stream NAK when loss is detected, reliable=true, or gap fill, reliable=false.
     * <p>
     * The default can be overridden with a channel param.
     *
     * @return true if NAK on loss to be reliable otherwise false for gap fill.
     * @see Configuration#RELIABLE_STREAM_PROP_NAME
     * @see CommonContext#RELIABLE_STREAM_PARAM_NAME
     */
    public reliableStream(): boolean;
    /**
     * Does a stream NAK when loss is detected, reliable=true, or gap fill, reliable=false.
     * <p>
     * The default can be overridden with a channel param.
     *
     * @param reliableStream true if a stream should NAK on loss otherwise gap fill.
     * @return this for a fluent API.
     * @see Configuration#RELIABLE_STREAM_PROP_NAME
     * @see CommonContext#RELIABLE_STREAM_PARAM_NAME
     */
    public reliableStream(reliableStream: boolean): this;
    public reliableStream(reliableStream?: boolean): boolean | this {
        if (undefined === reliableStream) {
            return this._reliableStream;
        }

        this._reliableStream = reliableStream;
        return this;
    }

    /**
     * Do subscriptions have a tether, so they participate in local flow control when more than one.
     * <p>
     * The default can be overridden with a channel param.
     *
     * @return true if subscriptions should have a tether for local flow control.
     * @see Configuration#TETHER_SUBSCRIPTIONS_PROP_NAME
     * @see CommonContext#TETHER_PARAM_NAME
     */
    public tetherSubscriptions(): boolean;
    /**
     * Do subscriptions have a tether so, they participate in local flow control when more than one.
     * <p>
     * The default can be overridden with a channel param.
     *
     * @param tetherSubscription true if subscriptions should have a tether for local flow control.
     * @return this for a fluent API.
     * @see Configuration#TETHER_SUBSCRIPTIONS_PROP_NAME
     * @see CommonContext#TETHER_PARAM_NAME
     */
    public tetherSubscriptions(tetherSubscription: boolean): this;
    public tetherSubscriptions(tetherSubscription?: boolean): boolean | this {
        if (undefined === tetherSubscription) {
            return this._tetherSubscriptions;
        }

        this._tetherSubscriptions = tetherSubscription;
        return this;
    }

    /**
     * Should network subscriptions be considered part of a group even if using a unicast endpoint, should it be
     * considered an individual even if using a multicast endpoint, or should the use of a unicast/multicast
     * endpoint infer the usage.
     * <p>
     * The default can be overridden with a channel param.
     *
     * @return FORCE_TRUE if subscriptions should be considered a group member, FORCE_FALSE if not, or depends
     * on endpoint.
     * @see Configuration#GROUP_RECEIVER_CONSIDERATION_PROP_NAME
     * @see CommonContext#GROUP_PARAM_NAME
     */
    public receiverGroupConsideration(): InferableBoolean;
    /**
     * Should network subscriptions be considered part of a group even if using a unicast endpoint, should it be
     * considered an individual even if using a multicast endpoint, or should the use of a unicast/multicast
     * endpoint infer the usage.
     * <p>
     * The default can be overridden with a channel param.
     *
     * @param receiverGroupConsideration true if subscriptions should be considered a group member,
     *                                   false if not, or infer from endpoint.
     * @return this for a fluent API.
     * @see Configuration#GROUP_RECEIVER_CONSIDERATION_PROP_NAME
     * @see CommonContext#GROUP_PARAM_NAME
     */
    public receiverGroupConsideration(receiverGroupConsideration: InferableBoolean): this;
    public receiverGroupConsideration(receiverGroupConsideration?: InferableBoolean): InferableBoolean | this {
        if (undefined === receiverGroupConsideration) {
            return this._receiverGroupConsideration;
        }

        this._receiverGroupConsideration = receiverGroupConsideration;
        return this;
    }

    /**
     * Does a subscription attempt to rejoin an unavailable stream after a cooldown or not.
     * <p>
     * The default can be overridden with a channel param.
     *
     * @return true if subscription will rejoin after cooldown or false if not.
     * @see Configuration#REJOIN_STREAM_PROP_NAME
     * @see CommonContext#REJOIN_PARAM_NAME
     */
    public rejoinStream(): boolean;
    /**
     * Does a subscription attempt to rejoin an unavailable stream after a cooldown or not.
     * <p>
     * The default can be overridden with a channel param.
     *
     * @param rejoinStream true if subscription will rejoin after cooldown or false if not.
     * @return this for a fluent API.
     * @see Configuration#REJOIN_STREAM_PROP_NAME
     * @see CommonContext#REJOIN_PARAM_NAME
     */
    public rejoinStream(rejoinStream: boolean): this;
    public rejoinStream(rejoinStream?: boolean): boolean | this {
        if (undefined === rejoinStream) {
            return this._rejoinStream;
        }

        this._rejoinStream = rejoinStream;
        return this;
    }

    /**
     * Default length for a term buffer on a network publication.
     *
     * @return default length for a term buffer on a network publication.
     * @see Configuration#TERM_BUFFER_LENGTH_PROP_NAME
     */
    public publicationTermBufferLength(): number;
    /**
     * Default length for a term buffer on a network publication.
     * <p>
     * This can be overridden on publication by using channel URI params.
     *
     * @param termBufferLength default length for a term buffer on a network publication.
     * @return this for a fluent API.
     * @see Configuration#TERM_BUFFER_LENGTH_PROP_NAME
     */
    public publicationTermBufferLength(termBufferLength: number): this;
    public publicationTermBufferLength(termBufferLength?: number): number | this {
        if (undefined === termBufferLength) {
            return this._publicationTermBufferLength;
        }

        this._publicationTermBufferLength = termBufferLength;
        return this;
    }

    /**
     * Default length for a term buffer on an IPC publication.
     *
     * @return default length for a term buffer on an IPC publication.
     * @see Configuration#IPC_TERM_BUFFER_LENGTH_PROP_NAME
     */
    public ipcTermBufferLength(): number;
    /**
     * Default length for a term buffer on an IPC publication.
     * <p>
     * This can be overridden on publication by using channel URI params.
     *
     * @param termBufferLength default length for a term buffer on an IPC publication.
     * @return this for a fluent API.
     * @see Configuration#IPC_TERM_BUFFER_LENGTH_PROP_NAME
     */
    public ipcTermBufferLength(termBufferLength: number): this;
    public ipcTermBufferLength(termBufferLength?: number): number | this {
        if (undefined === termBufferLength) {
            return this._ipcTermBufferLength;
        }

        this._ipcTermBufferLength = termBufferLength;
        return this;
    }

    /**
     * Default length for a term buffer window on a network publication.
     *
     * @return default length for a term buffer window on a network publication.
     * @see Configuration#PUBLICATION_TERM_WINDOW_LENGTH_PROP_NAME
     */
    public publicationTermWindowLength(): number;
    /**
     * Default length for a term buffer window on a network publication.
     *
     * @param termWindowLength default length for a term buffer window on a network publication.
     * @return this for a fluent API.
     * @see Configuration#PUBLICATION_TERM_WINDOW_LENGTH_PROP_NAME
     */
    public publicationTermWindowLength(termWindowLength: number): this;
    public publicationTermWindowLength(termWindowLength?: number): number | this {
        if (undefined === termWindowLength) {
            return this._publicationTermWindowLength;
        }

        this._publicationTermWindowLength = termWindowLength;
        return this;
    }

    /**
     * Default length for a term buffer window on an IPC publication.
     *
     * @return default length for a term buffer window on an IPC publication.
     * @see Configuration#IPC_PUBLICATION_TERM_WINDOW_LENGTH_PROP_NAME
     */
    public ipcPublicationTermWindowLength(): number;
    /**
     * Default length for a term buffer window on an IPC publication.
     *
     * @param termWindowLength default length for a term buffer window on an IPC publication.
     * @return this for a fluent API.
     * @see Configuration#IPC_PUBLICATION_TERM_WINDOW_LENGTH_PROP_NAME
     */
    public ipcPublicationTermWindowLength(termWindowLength: number): this;
    public ipcPublicationTermWindowLength(termWindowLength?: number): number | this {
        if (undefined === termWindowLength) {
            return this._ipcPublicationTermWindowLength;
        }

        this._ipcPublicationTermWindowLength = termWindowLength;
        return this;
    }

    /**
     * The initial window for in flight data on a connection which must be less than
     * {@link Configuration#SOCKET_RCVBUF_LENGTH_PROP_NAME}. This needs to be configured for throughput respecting
     * BDP.
     *
     * @return The initial window for in flight data on a connection
     * @see Configuration#INITIAL_WINDOW_LENGTH_PROP_NAME
     */
    public initialWindowLength(): number;
    /**
     * The initial window for in flight data on a connection which must be less than
     * {@link Configuration#SOCKET_RCVBUF_LENGTH_PROP_NAME}. This needs to be configured for throughput respecting
     * BDP.
     *
     * @param initialWindowLength The initial window for in flight data on a connection
     * @return this for a fluent API.
     * @see Configuration#INITIAL_WINDOW_LENGTH_PROP_NAME
     */
    public initialWindowLength(initialWindowLength: number): this;
    public initialWindowLength(initialWindowLength?: number): number | this {
        if (undefined === initialWindowLength) {
            return this._initialWindowLength;
        }

        this._initialWindowLength = initialWindowLength;
        return this;
    }

    /**
     * The socket send buffer length which is the OS SO_SNDBUF.
     *
     * @return the socket send buffer length.
     * @see Configuration#SOCKET_SNDBUF_LENGTH_PROP_NAME
     */
    public socketSndbufLength(): number;
    /**
     * The socket send buffer length which is the OS SO_SNDBUF.
     *
     * @param socketSndbufLength which is the OS SO_SNDBUF.
     * @return this for a fluent API.
     * @see Configuration#SOCKET_SNDBUF_LENGTH_PROP_NAME
     */
    public socketSndbufLength(socketSndbufLength: number): this;
    public socketSndbufLength(socketSndbufLength?: number): number | this {
        if (undefined === socketSndbufLength) {
            return this._socketSndbufLength;
        }

        this._socketSndbufLength = socketSndbufLength;
        return this;
    }

    /**
     * The socket send buffer length which is the OS SO_RCVBUF.
     *
     * @return the socket send buffer length.
     * @see Configuration#SOCKET_RCVBUF_LENGTH_PROP_NAME
     */
    public socketRcvbufLength(): number;
    /**
     * The socket send buffer length which is the OS SO_RCVBUF.
     *
     * @param socketRcvbufLength which is the OS SO_RCVBUF.
     * @return this for a fluent API.
     * @see Configuration#SOCKET_RCVBUF_LENGTH_PROP_NAME
     */
    public socketRcvbufLength(socketRcvbufLength: number): this;
    public socketRcvbufLength(socketRcvbufLength?: number): number | this {
        if (undefined === socketRcvbufLength) {
            return this._socketRcvbufLength;
        }

        this._socketRcvbufLength = socketRcvbufLength;
        return this;
    }

    /**
     * The TTL value to be used for multicast sockets.
     *
     * @return TTL value to be used for multicast sockets.
     * @see Configuration#SOCKET_MULTICAST_TTL_PROP_NAME
     */
    public socketMulticastTtl(): number;
    /**
     * TTL value to be used for multicast sockets.
     *
     * @param ttl value to be used for multicast sockets.
     * @return this for a fluent API.
     * @see Configuration#SOCKET_MULTICAST_TTL_PROP_NAME
     */
    public socketMulticastTtl(ttl: number): this;
    public socketMulticastTtl(ttl?: number): number | this {
        if (undefined === ttl) {
            return this._socketMulticastTtl;
        }

        this._socketMulticastTtl = ttl;
        return this;
    }

    /**
     * MTU in bytes for datagrams sent to the network. Messages larger than this are fragmented.
     * <p>
     * Larger MTUs reduce system call overhead at the expense of possible increase in loss which
     * will need to be recovered. If this is greater than the network MTU for UDP then the packet will be
     * fragmented and can amplify the impact of loss.
     *
     * @return MTU in bytes for datagrams sent to the network.
     * @see Configuration#MTU_LENGTH_PROP_NAME
     */
    public mtuLength(): number;
    /**
     * MTU in bytes for datagrams sent to the network. Messages larger than this are fragmented.
     * <p>
     * Larger MTUs reduce system call overhead at the expense of possible increase in loss which
     * will need to be recovered. If this is greater than the network MTU for UDP then the packet will be
     * fragmented and can amplify the impact of loss.
     *
     * @param mtuLength in bytes for datagrams sent to the network.
     * @return this for a fluent API.
     * @see Configuration#MTU_LENGTH_PROP_NAME
     */
    public mtuLength(mtuLength: number): this;
    public mtuLength(mtuLength?: number): number | this {
        if (undefined === mtuLength) {
            return this._mtuLength;
        }

        this._mtuLength = mtuLength;
        return this;
    }

    /**
     * MTU in bytes for datagrams sent over shared memory. Messages larger than this are fragmented.
     * <p>
     * Larger MTUs reduce fragmentation. If an IPC stream is recorded to be later sent over the network then
     * a large MTU may be an issue.
     *
     * @return MTU in bytes for message fragments.
     * @see Configuration#IPC_MTU_LENGTH_PROP_NAME
     */
    public ipcMtuLength(): number;
    /**
     * MTU in bytes for datagrams sent over shared memory. Messages larger than this are fragmented.
     * <p>
     * Larger MTUs reduce fragmentation. If an IPC stream is recorded to be later sent over the network then
     * a large MTU may be an issue.
     *
     * @param ipcMtuLength in bytes for message fragments.
     * @return this for a fluent API.
     * @see Configuration#IPC_MTU_LENGTH_PROP_NAME
     */
    public ipcMtuLength(ipcMtuLength: number): this;
    public ipcMtuLength(ipcMtuLength?: number): number | this {
        if (undefined === ipcMtuLength) {
            return this._ipcMtuLength;
        }

        this._ipcMtuLength = ipcMtuLength;
        return this;
    }

    /**
     * The {@link EpochClock} as a source of time in milliseconds for wall clock time.
     *
     * @return the {@link EpochClock} as a source of time in milliseconds for wall clock time.
     */
    public epochClock(): EpochClock | null;
    /**
     * The {@link EpochClock} as a source of time in milliseconds for wall clock time.
     *
     * @param clock to be used.
     * @return this for a fluent API.
     */
    public epochClock(clock: EpochClock | null): this;
    public epochClock(clock?: EpochClock | null): EpochClock | null | this {
        if (undefined === clock) {
            return this._epochClock;
        }

        this._epochClock = clock;
        return this;
    }

    /**
     * The {@link NanoClock} as a source of time in nanoseconds for measuring duration.
     *
     * @return the {@link NanoClock} as a source of time in nanoseconds for measuring duration.
     */
    public nanoClock(): NanoClock | null;
    /**
     * The {@link NanoClock} as a source of time in nanoseconds for measuring duration.
     *
     * @param clock to be used.
     * @return this for a fluent API.
     */
    public nanoClock(clock: NanoClock | null): this;
    public nanoClock(clock?: NanoClock | null): NanoClock | null | this {
        if (undefined === clock) {
            return this._nanoClock;
        }

        this._nanoClock = clock;
        return this;
    }

    /**
     * The {@link CachedEpochClock} as a source of time in milliseconds for wall clock time.
     *
     * @return the {@link CachedEpochClock} as a source of time in milliseconds for wall clock time.
     */
    public cachedEpochClock(): CachedEpochClock | null;
    /**
     * The {@link CachedEpochClock} as a source of time in milliseconds for wall clock time.
     *
     * @param clock to be used.
     * @return this for a fluent API.
     */
    public cachedEpochClock(clock: CachedEpochClock | null): this;
    public cachedEpochClock(clock?: CachedEpochClock | null): CachedEpochClock | null | this {
        if (undefined === clock) {
            return this._cachedEpochClock;
        }

        this._cachedEpochClock = clock;
        return this;
    }

    /**
     * The {@link CachedNanoClock} as a source of time in nanoseconds for measuring duration. This is updated
     * once per work cycle of the {@link DriverConductor}.
     *
     * @return the {@link CachedNanoClock} as a source of time in nanoseconds for measuring duration.
     */
    public cachedNanoClock(): CachedNanoClock | null;
    /**
     * The {@link CachedNanoClock} as a source of time in nanoseconds for measuring duration for the
     * {@link DriverConductor}.
     *
     * @param clock to be used.
     * @return this for a fluent API.
     */
    public cachedNanoClock(clock: CachedNanoClock | null): this;
    public cachedNanoClock(clock?: CachedNanoClock | null): CachedNanoClock | null | this {
        if (undefined === clock) {
            return this._cachedNanoClock;
        }

        this._cachedNanoClock = clock;
        return this;
    }

    /**
     * The {@link CachedNanoClock} as a source of time in nanoseconds for measuring duration. This is updated
     * once per work cycle of the {@link Sender}.
     *
     * @return the {@link CachedNanoClock} as a source of time in nanoseconds for measuring duration.
     */
    public senderCachedNanoClock(): CachedNanoClock | null;
    /**
     * The {@link CachedNanoClock} as a source of time in nanoseconds for measuring duration for the
     * {@link Sender}.
     *
     * @param clock to be used.
     * @return this for a fluent API.
     */
    public senderCachedNanoClock(clock: CachedNanoClock | null): this;
    public senderCachedNanoClock(clock?: CachedNanoClock | null): CachedNanoClock | null | this {
        if (undefined === clock) {
            return this._senderCachedNanoClock;
        }

        this._senderCachedNanoClock = clock;
        return this;
    }

    /**
     * The {@link CachedNanoClock} as a source of time in nanoseconds for measuring duration. This is updated
     * once per work cycle of the {@link Receiver}.
     *
     * @return the {@link CachedNanoClock} as a source of time in nanoseconds for measuring duration.
     */
    public receiverCachedNanoClock(): CachedNanoClock | null;
    /**
     * The {@link CachedNanoClock} as a source of time in nanoseconds for measuring duration for the
     * {@link Receiver}.
     *
     * @param clock to be used.
     * @return this for a fluent API.
     */
    public receiverCachedNanoClock(clock: CachedNanoClock | null): this;
    public receiverCachedNanoClock(clock?: CachedNanoClock | null): CachedNanoClock | null | this {
        if (undefined === clock) {
            return this._receiverCachedNanoClock;
        }

        this._receiverCachedNanoClock = clock;
        return this;
    }

    /**
     * {@link ThreadingMode} that should be used for the driver.
     *
     * @return {@link ThreadingMode} that should be used for the driver.
     * @see Configuration#THREADING_MODE_PROP_NAME
     */
    public threadingMode(): ThreadingMode | null;
    /**
     * {@link ThreadingMode} that should be used for the driver.
     *
     * @param threadingMode that should be used for the driver.
     * @return this for a fluent API.
     * @see Configuration#THREADING_MODE_PROP_NAME
     */
    public threadingMode(threadingMode: ThreadingMode | null): this;
    public threadingMode(threadingMode?: ThreadingMode | null): ThreadingMode | null | this {
        if (undefined === threadingMode) {
            return this._threadingMode;
        }

        this._threadingMode = threadingMode;
        return this;
    }

    /**
     * Not in Java (spec D8, D100). The function that the transports of the driver call, from the event loop, when a
     * datagram has arrived or a full send queue has drained, so that a runner that is idle does not sleep through it.
     * {@link MediaDriver.launch} sets the wake up of its own runner (after the one set here, which it calls too); an
     * application that steps the driver itself ({@link ThreadingMode.INVOKER}) sets its own. It is read when a
     * transport is made, so it is set before the first channel is added.
     *
     * @return the function, or null for none.
     */
    public wakeUp(): (() => void) | null;
    /**
     * Not in Java (spec D8, D100). See {@link wakeUp}.
     *
     * @param wakeUp to call, or null for none.
     * @return this for a fluent API.
     */
    public wakeUp(wakeUp: (() => void) | null): this;
    public wakeUp(wakeUp?: (() => void) | null): (() => void) | null | this {
        if (undefined === wakeUp) {
            return this._wakeUp;
        }

        this._wakeUp = wakeUp;
        return this;
    }

    /**
     * Returns the number of outstanding retransmits.
     *
     * @return number of outstanding retransmits.
     * @see Configuration#MAX_RESEND_PROP_NAME
     * @since 1.45.0
     */
    public maxResend(): number;
    /**
     * Sets the number of outstanding retransmits.
     *
     * @param maxResend number of outstanding retransmits allowed.
     * @return this for a fluent API.
     * @since 1.45.0
     */
    public maxResend(maxResend: number): this;
    public maxResend(maxResend?: number): number | this {
        if (undefined === maxResend) {
            return this._maxResend;
        }

        this._maxResend = maxResend;
        return this;
    }

    /**
     * {@link IdleStrategy} to be used by the {@link Sender} when in {@link ThreadingMode#DEDICATED}.
     *
     * @return {@link IdleStrategy} to be used by the {@link Sender} when in {@link ThreadingMode#DEDICATED}.
     * @see Configuration#SENDER_IDLE_STRATEGY_PROP_NAME
     */
    public senderIdleStrategy(): IdleStrategy | null;
    /**
     * {@link IdleStrategy} to be used by the {@link Sender} when in {@link ThreadingMode#DEDICATED}.
     *
     * @param strategy to be used by the {@link Sender} when in {@link ThreadingMode#DEDICATED}.
     * @return this for a fluent API.
     * @see Configuration#SENDER_IDLE_STRATEGY_PROP_NAME
     */
    public senderIdleStrategy(strategy: IdleStrategy | null): this;
    public senderIdleStrategy(strategy?: IdleStrategy | null): IdleStrategy | null | this {
        if (undefined === strategy) {
            return this._senderIdleStrategy;
        }

        this._senderIdleStrategy = strategy;
        return this;
    }

    /**
     * {@link IdleStrategy} to be used by the {@link Receiver} when in {@link ThreadingMode#DEDICATED}.
     *
     * @return {@link IdleStrategy} used by the {@link Receiver} when in {@link ThreadingMode#DEDICATED}.
     * @see Configuration#RECEIVER_IDLE_STRATEGY_PROP_NAME
     */
    public receiverIdleStrategy(): IdleStrategy | null;
    /**
     * {@link IdleStrategy} to be used by the {@link Receiver} when in {@link ThreadingMode#DEDICATED}.
     *
     * @param strategy to be used by the {@link Receiver} when in {@link ThreadingMode#DEDICATED}.
     * @return this for a fluent API.
     * @see Configuration#RECEIVER_IDLE_STRATEGY_PROP_NAME
     */
    public receiverIdleStrategy(strategy: IdleStrategy | null): this;
    public receiverIdleStrategy(strategy?: IdleStrategy | null): IdleStrategy | null | this {
        if (undefined === strategy) {
            return this._receiverIdleStrategy;
        }

        this._receiverIdleStrategy = strategy;
        return this;
    }

    /**
     * {@link IdleStrategy} to be used by the {@link DriverConductor} when in {@link ThreadingMode#DEDICATED}
     * or {@link ThreadingMode#SHARED_NETWORK}.
     *
     * @return {@link IdleStrategy} used by the {@link DriverConductor}
     * @see Configuration#CONDUCTOR_IDLE_STRATEGY_PROP_NAME
     */
    public conductorIdleStrategy(): IdleStrategy | null;
    /**
     * {@link IdleStrategy} to be used by the {@link DriverConductor} when in {@link ThreadingMode#DEDICATED}
     * or {@link ThreadingMode#SHARED_NETWORK}.
     *
     * @param strategy to be used by the {@link DriverConductor}.
     * @return this for a fluent API.
     * @see Configuration#CONDUCTOR_IDLE_STRATEGY_PROP_NAME
     */
    public conductorIdleStrategy(strategy: IdleStrategy | null): this;
    public conductorIdleStrategy(strategy?: IdleStrategy | null): IdleStrategy | null | this {
        if (undefined === strategy) {
            return this._conductorIdleStrategy;
        }

        this._conductorIdleStrategy = strategy;
        return this;
    }

    /**
     * {@link IdleStrategy} to be used by the {@link Sender} and {@link Receiver} agents when in
     * {@link ThreadingMode#SHARED_NETWORK}.
     *
     * @return {@link IdleStrategy} used by the {@link Sender} and {@link Receiver}.
     * @see Configuration#SHARED_NETWORK_IDLE_STRATEGY_PROP_NAME
     */
    public sharedNetworkIdleStrategy(): IdleStrategy | null;
    /**
     * {@link IdleStrategy} to be used by the {@link Sender} and {@link Receiver} agents when in
     * {@link ThreadingMode#SHARED_NETWORK}.
     *
     * @param strategy to be used by the {@link Sender} and {@link Receiver}.
     * @return this for a fluent API.
     * @see Configuration#SHARED_NETWORK_IDLE_STRATEGY_PROP_NAME
     */
    public sharedNetworkIdleStrategy(strategy: IdleStrategy | null): this;
    public sharedNetworkIdleStrategy(strategy?: IdleStrategy | null): IdleStrategy | null | this {
        if (undefined === strategy) {
            return this._sharedNetworkIdleStrategy;
        }

        this._sharedNetworkIdleStrategy = strategy;
        return this;
    }

    /**
     * {@link IdleStrategy} to be used by the {@link Sender}, {@link Receiver} and {@link DriverConductor}
     * agents when in {@link ThreadingMode#SHARED}.
     *
     * @return {@link IdleStrategy} used by the {@link Sender}, {@link Receiver} and {@link DriverConductor}.
     * @see Configuration#SHARED_IDLE_STRATEGY_PROP_NAME
     */
    public sharedIdleStrategy(): IdleStrategy | null;
    /**
     * {@link IdleStrategy} to be used by the {@link Sender}, {@link Receiver} and {@link DriverConductor}
     * agents when in {@link ThreadingMode#SHARED}.
     *
     * @param strategy to be used by the {@link Sender}, {@link Receiver} and {@link DriverConductor}.
     * @return this for a fluent API.
     * @see Configuration#SHARED_IDLE_STRATEGY_PROP_NAME
     */
    public sharedIdleStrategy(strategy: IdleStrategy | null): this;
    public sharedIdleStrategy(strategy?: IdleStrategy | null): IdleStrategy | null | this {
        if (undefined === strategy) {
            return this._sharedIdleStrategy;
        }

        this._sharedIdleStrategy = strategy;
        return this;
    }

    /**
     * The temporary buffer than can be used to build up counter labels to avoid allocation.
     *
     * @return the temporary buffer than can be used to build up counter labels to avoid allocation.
     */
    public tempBuffer(): MutableDirectBuffer | null;
    /**
     * Set the temporary buffer than can be used to build up counter labels to avoid allocation.
     *
     * @param tempBuffer to be used to avoid allocation.
     * @return the temporary buffer than can be used to build up counter labels to avoid allocation.
     */
    public tempBuffer(tempBuffer: MutableDirectBuffer | null): this;
    public tempBuffer(tempBuffer?: MutableDirectBuffer | null): MutableDirectBuffer | null | this {
        if (undefined === tempBuffer) {
            return this._tempBuffer;
        }

        this._tempBuffer = tempBuffer;
        return this;
    }

    /**
     * Timeout for min multicast flow control strategy.
     *
     * @return timeout in ns.
     * @see Configuration#FLOW_CONTROL_RECEIVER_TIMEOUT_PROP_NAME
     */
    public flowControlReceiverTimeoutNs(): number;
    /**
     * Timeout for min multicast flow control strategy.
     *
     * @param timeoutNs in ns.
     * @return this for a fluent API.
     * @see Configuration#FLOW_CONTROL_RECEIVER_TIMEOUT_PROP_NAME
     */
    public flowControlReceiverTimeoutNs(timeoutNs: number): this;
    public flowControlReceiverTimeoutNs(timeoutNs?: number): number | this {
        if (undefined === timeoutNs) {
            return this._flowControlReceiverTimeoutNs;
        }

        this._flowControlReceiverTimeoutNs = timeoutNs;
        return this;
    }

    /**
     * Flow control strategies may limit how much data is sent during a retransmission to
     * avoid saturating the network and potentially causing more loss. The maximum
     * retransmission size will be based on a multiple of the receiver window size.
     * <p>
     * See @{@link FlowControl#calculateRetransmissionLength(int, int, int, int)}
     *
     * @return window size multiple for the unicast strategy.
     */
    public unicastFlowControlRetransmitReceiverWindowMultiple(): number;
    /**
     * Flow control strategies may limit how much data is sent during a retransmission to
     * avoid saturating the network and potentially causing more loss. The maximum
     * retransmission size will be based on a multiple of the receiver window size.
     * <p>
     * See @{@link FlowControl#calculateRetransmissionLength(int, int, int, int)}
     *
     * @param unicastFlowControlRetransmitReceiverWindowMultiple window size multiple for the unicast strategy.
     * @return this for a fluent API.
     */
    public unicastFlowControlRetransmitReceiverWindowMultiple(
        unicastFlowControlRetransmitReceiverWindowMultiple: number,
    ): this;
    public unicastFlowControlRetransmitReceiverWindowMultiple(
        unicastFlowControlRetransmitReceiverWindowMultiple?: number,
    ): number | this {
        if (undefined === unicastFlowControlRetransmitReceiverWindowMultiple) {
            return this._unicastFlowControlRetransmitReceiverWindowMultiple;
        }

        this._unicastFlowControlRetransmitReceiverWindowMultiple = unicastFlowControlRetransmitReceiverWindowMultiple;
        return this;
    }

    /**
     * Flow control strategies may limit how much data is sent during a retransmission to
     * avoid saturating the network and potentially causing more loss. The maximum
     * retransmission size will be based on a multiple of the receiver window size.
     * <p>
     * See @{@link FlowControl#calculateRetransmissionLength(int, int, int, int)}
     *
     * @return window size multiple for multicast strategies.
     */
    public multicastFlowControlRetransmitReceiverWindowMultiple(): number;
    /**
     * Flow control strategies may limit how much data is sent during a retransmission to
     * avoid saturating the network and potentially causing more loss. The maximum
     * retransmission size will be based on a multiple of the receiver window size.
     * <p>
     * See @{@link FlowControl#calculateRetransmissionLength(int, int, int, int)}
     *
     * @param multicastFlowControlRetransmitReceiverWindowMultiple window size multiple for multicast strategies.
     * @return this for a fluent API.
     */
    public multicastFlowControlRetransmitReceiverWindowMultiple(
        multicastFlowControlRetransmitReceiverWindowMultiple: number,
    ): this;
    public multicastFlowControlRetransmitReceiverWindowMultiple(
        multicastFlowControlRetransmitReceiverWindowMultiple?: number,
    ): number | this {
        if (undefined === multicastFlowControlRetransmitReceiverWindowMultiple) {
            return this._multicastFlowControlRetransmitReceiverWindowMultiple;
        }

        this._multicastFlowControlRetransmitReceiverWindowMultiple =
            multicastFlowControlRetransmitReceiverWindowMultiple;
        return this;
    }

    /**
     * Application specific feedback used to identify a receiver group when using a
     * {@link TaggedMulticastFlowControl} strategy which is added to Status Messages (SMs).
     * <p>
     * Replaced by {@link #receiverGroupTag()}.
     *
     * @return Application specific feedback used to identify receiver group for flow control.
     * @see Configuration#SM_APPLICATION_SPECIFIC_FEEDBACK_PROP_NAME
     */
    public applicationSpecificFeedback(): Uint8Array | null;
    /**
     * Application specific feedback used to identify a receiver group when using a
     * {@link TaggedMulticastFlowControl} strategy which is added to Status Messages (SMs).
     * <p>
     * Replaced by {@link #receiverGroupTag(Long)}.
     *
     * @param asfBytes for identifying a receiver group.
     * @return this for a fluent API.
     * @see Configuration#SM_APPLICATION_SPECIFIC_FEEDBACK_PROP_NAME
     */
    public applicationSpecificFeedback(asfBytes: Uint8Array | null): this;
    public applicationSpecificFeedback(asfBytes?: Uint8Array | null): Uint8Array | null | this {
        if (undefined === asfBytes) {
            return this._applicationSpecificFeedback;
        }

        this._applicationSpecificFeedback = asfBytes;
        return this;
    }

    /**
     * {@link ErrorHandler} to be used for reporting errors during {@link Agent}s operations.
     *
     * @return the {@link ErrorHandler} to be used for reporting errors during {@link Agent}s operations.
     */
    public errorHandler(): ErrorHandler | null;
    /**
     * {@link ErrorHandler} to be used for reporting errors during {@link Agent}s operations.
     * <p>
     * The default {@link ErrorHandler} will delegate to the {@link #errorLog()} and output to {@link System#err}
     * if the log is full.
     * <p>
     * <b>Note:</b> {@link ErrorHandler} should be thread safe.
     *
     * @param errorHandler to be used for reporting errors during {@link Agent}s operations.
     * @return this for a fluent API.
     */
    public errorHandler(errorHandler: ErrorHandler | null): this;
    public errorHandler(errorHandler?: ErrorHandler | null): ErrorHandler | null | this {
        if (undefined === errorHandler) {
            return this._errorHandler;
        }

        this._errorHandler = errorHandler;
        return this;
    }

    /**
     * Log to which exceptions are recorded.
     *
     * @return log to which exceptions are recorded.
     */
    public errorLog(): DistinctErrorLog | null;
    /**
     * Log to which exceptions are recorded.
     *
     * @param errorLog to which exceptions are recorded.
     * @return this for a fluent API.
     */
    public errorLog(errorLog: DistinctErrorLog | null): this;
    public errorLog(errorLog?: DistinctErrorLog | null): DistinctErrorLog | null | this {
        if (undefined === errorLog) {
            return this._errorLog;
        }

        this._errorLog = errorLog;
        return this;
    }

    /**
     * Should a {@link ConcurrentCountersManager} be used to allow for cross thread usage.
     *
     * @return true if a {@link ConcurrentCountersManager} should be used otherwise false.
     */
    public useConcurrentCountersManager(): boolean;
    /**
     * Should a {@link ConcurrentCountersManager} be used to allow for cross thread usage.
     * <p>
     * The default is to use a normal {@link CountersManager} from only the {@link DriverConductor}. If the
     * {@link MediaDriver} is to be composed into another services that allocates counters then this should be
     * concurrent.
     *
     * @param useConcurrentCountersManager true if a {@link ConcurrentCountersManager} should be used.
     * @return this for a fluent API.
     */
    public useConcurrentCountersManager(useConcurrentCountersManager: boolean): this;
    public useConcurrentCountersManager(useConcurrentCountersManager?: boolean): boolean | this {
        if (undefined === useConcurrentCountersManager) {
            return this._useConcurrentCountersManager;
        }

        this._useConcurrentCountersManager = useConcurrentCountersManager;
        return this;
    }

    /**
     * Get the {@link CountersManager} that has been concluded for this context.
     *
     * @return the {@link CountersManager} that has been concluded for this context.
     */
    public countersManager(): CountersManager | null;
    /**
     * Set the {@link CountersManager} to override the one that would have been concluded.
     *
     * @param countersManager to override the one that would have been concluded.
     * @return this for a fluent API.
     */
    public countersManager(countersManager: CountersManager | null): this;
    public countersManager(countersManager?: CountersManager | null): CountersManager | null | this {
        if (undefined === countersManager) {
            return this._countersManager;
        }

        this._countersManager = countersManager;
        return this;
    }

    /**
     * The {@link SystemCounters} for the driver for recording aggregate events of system status.
     *
     * @return the {@link SystemCounters} for the driver for recording aggregate events of system status.
     */
    public systemCounters(): SystemCounters | null;
    /**
     * The {@link SystemCounters} for the driver for recording aggregate events of system status.
     * <p>
     * The default should only be overridden for testing.
     *
     * @param systemCounters for the driver for recording aggregate events of system status.
     * @return this for a fluent API.
     */
    public systemCounters(systemCounters: SystemCounters | null): this;
    public systemCounters(systemCounters?: SystemCounters | null): SystemCounters | null | this {
        if (undefined === systemCounters) {
            return this._systemCounters;
        }

        this._systemCounters = systemCounters;
        return this;
    }

    /**
     * Low end of the publication reserved session id range which will not be automatically assigned.
     *
     * @return low end of the publication reserved session id range which will not be automatically assigned.
     * @see #publicationReservedSessionIdHigh()
     * @see Configuration#PUBLICATION_RESERVED_SESSION_ID_LOW_PROP_NAME
     */
    public publicationReservedSessionIdLow(): number;
    /**
     * Low end of the publication reserved session id range which will not be automatically assigned.
     *
     * @param sessionId for low end of the publication reserved session id range which will not be automatically
     *                  assigned.
     * @return this for fluent API.
     * @see #publicationReservedSessionIdHigh(int)
     * @see Configuration#PUBLICATION_RESERVED_SESSION_ID_LOW_PROP_NAME
     */
    public publicationReservedSessionIdLow(sessionId: number): this;
    public publicationReservedSessionIdLow(sessionId?: number): number | this {
        if (undefined === sessionId) {
            return this._publicationReservedSessionIdLow;
        }

        this._publicationReservedSessionIdLow = sessionId;
        return this;
    }

    /**
     * High end of the publication reserved session id range which will not be automatically assigned.
     *
     * @return high end of the publication reserved session id range which will not be automatically assigned.
     * @see #publicationReservedSessionIdLow()
     * @see Configuration#PUBLICATION_RESERVED_SESSION_ID_HIGH_PROP_NAME
     */
    public publicationReservedSessionIdHigh(): number;
    /**
     * High end of the publication reserved session id range which will not be automatically assigned.
     *
     * @param sessionId for high end of the publication reserved session id range which will not be automatically
     *                  assigned.
     * @return this for fluent API.
     * @see #publicationReservedSessionIdLow(int)
     * @see Configuration#PUBLICATION_RESERVED_SESSION_ID_HIGH_PROP_NAME
     */
    public publicationReservedSessionIdHigh(sessionId: number): this;
    public publicationReservedSessionIdHigh(sessionId?: number): number | this {
        if (undefined === sessionId) {
            return this._publicationReservedSessionIdHigh;
        }

        this._publicationReservedSessionIdHigh = sessionId;
        return this;
    }

    /**
     * Get the {@link Runnable} that is called when the {@link MediaDriver} processes a valid termination request.
     * <p>
     * The default action is nothing.
     *
     * @return the {@link Runnable} that can be used to terminate a consensus module.
     */
    public terminationHook(): (() => void) | null;
    /**
     * Set the {@link Runnable} that is called when the {@link MediaDriver} processes a valid termination request.
     *
     * @param terminationHook that can be used to terminate a driver.
     * @return this for a fluent API.
     */
    public terminationHook(terminationHook: (() => void) | null): this;
    public terminationHook(terminationHook?: (() => void) | null): (() => void) | null | this {
        if (undefined === terminationHook) {
            return this._terminationHook;
        }

        this._terminationHook = terminationHook;
        return this;
    }

    /**
     * Get the ratio for sending data to polling status messages in the Sender.
     *
     * @return ratio for sending data to polling status messages in the Sender.
     */
    public sendToStatusMessagePollRatio(): number;
    /**
     * Set the ratio for sending data to polling status messages in the Sender.
     *
     * @param ratio to use.
     * @return this for fluent API.
     */
    public sendToStatusMessagePollRatio(ratio: number): this;
    public sendToStatusMessagePollRatio(ratio?: number): number | this {
        if (undefined === ratio) {
            return this._sendToStatusMessagePollRatio;
        }

        this._sendToStatusMessagePollRatio = ratio;
        return this;
    }

    /**
     * The report of the loss that the images observe, for identifying loss issues on specific connections. It is
     * {@code null} unless the application sets one: Java makes it over the memory-mapped loss report file in
     * {@code conclude}, which the port does not have (spec section 3, D50). Added by T16.
     *
     * @return the loss report, or {@code null} if there is none.
     * @internal package-private in Java
     */
    public lossReport(): LossReport | null;
    /**
     * Set the report of the loss that the images observe, for identifying loss issues on specific connections.
     *
     * @param lossReport for identifying loss issues on specific connections.
     * @return this for a fluent API.
     */
    public lossReport(lossReport: LossReport | null): this;
    public lossReport(lossReport?: LossReport | null): LossReport | null | this {
        if (undefined === lossReport) {
            return this._lossReport;
        }

        this._lossReport = lossReport;
        return this;
    }

    /**
     * Get the group tag (gtag) to be sent in Status Messages from the Receiver.
     *
     * @return group tag value or null if not set.
     * @see Configuration#RECEIVER_GROUP_TAG_PROP_NAME
     */
    public receiverGroupTag(): number | null;
    /**
     * Set the group tag (gtag) to be sent in Status Messages from the Receiver.
     *
     * @param groupTag value to sent in Status Messages from the receiver or null if not set.
     * @return this for fluent API.
     * @see Configuration#RECEIVER_GROUP_TAG_PROP_NAME
     */
    public receiverGroupTag(groupTag: number | null): this;
    public receiverGroupTag(groupTag?: number | null): number | null | this {
        if (undefined === groupTag) {
            return this._receiverGroupTag;
        }

        this._receiverGroupTag = groupTag;
        return this;
    }

    /**
     * Get the default min group size used by flow control strategies to indicate connectivity.
     *
     * @return required group size.
     * @see Configuration#FLOW_CONTROL_GROUP_MIN_SIZE_PROP_NAME
     */
    public flowControlGroupMinSize(): number;
    /**
     * Set the default min group size used by flow control strategies to indicate connectivity.
     *
     * @param groupSize minimum required group size used by the tagged flow control strategy.
     * @return this for fluent API.
     * @see Configuration#FLOW_CONTROL_GROUP_MIN_SIZE_PROP_NAME
     */
    public flowControlGroupMinSize(groupSize: number): this;
    public flowControlGroupMinSize(groupSize?: number): number | this {
        if (undefined === groupSize) {
            return this._flowControlGroupMinSize;
        }

        this._flowControlGroupMinSize = groupSize;
        return this;
    }

    /**
     * Get the {@link NameResolver} to use for resolving endpoints and control names.
     *
     * @return {@link NameResolver} to use for resolving endpoints and control names.
     */
    public nameResolver(): NameResolverAgent | null;
    /**
     * Set the {@link NameResolver} to use for resolving endpoints and control names.
     *
     * @param nameResolver to use for resolving endpoints and control names.
     * @return this for fluent API.
     */
    public nameResolver(nameResolver: NameResolverAgent | null): this;
    public nameResolver(nameResolver?: NameResolverAgent | null): NameResolverAgent | null | this {
        if (undefined === nameResolver) {
            return this._nameResolver;
        }

        this._nameResolver = nameResolver;
        return this;
    }

    /**
     * Get the name of the {@link MediaDriver} for name resolver purposes.
     *
     * @return name of the {@link MediaDriver}.
     * @see Configuration#RESOLVER_NAME_PROP_NAME
     */
    public resolverName(): string | null;
    /**
     * Set the name of the {@link MediaDriver} for name resolver purposes.
     *
     * @param resolverName for the driver.
     * @return this for a fluent API.
     * @see Configuration#RESOLVER_NAME_PROP_NAME
     */
    public resolverName(resolverName: string | null): this;
    public resolverName(resolverName?: string | null): string | null | this {
        if (undefined === resolverName) {
            return this._resolverName;
        }

        this._resolverName = resolverName;
        return this;
    }

    /**
     * Get the interface of the {@link MediaDriver} for name resolver purposes.
     * <p>
     * The format is {@code hostname:port}. If set to null, then the name resolver will not be used.
     *
     * @return interface of the {@link MediaDriver}.
     * @see Configuration#RESOLVER_INTERFACE_PROP_NAME
     */
    public resolverInterface(): string | null;
    /**
     * Set the interface of the {@link MediaDriver} for name resolver purposes.
     * <p>
     * The format is {@code hostname:port}. If set to null, then the name resolver will not be used.
     *
     * @param resolverInterface to use for the name resolver.
     * @return this for fluent API.
     * @see Configuration#RESOLVER_INTERFACE_PROP_NAME
     */
    public resolverInterface(resolverInterface: string | null): this;
    public resolverInterface(resolverInterface?: string | null): string | null | this {
        if (undefined === resolverInterface) {
            return this._resolverInterface;
        }

        this._resolverInterface = resolverInterface;
        return this;
    }

    /**
     * Get the bootstrap neighbor of the {@link MediaDriver} for name resolver purposes.
     * <p>
     * The format is comma separated list of {@code hostname:port} pairs and follows the URI format for the
     * endpoint parameter.
     *
     * @return bootstrap neighbor of the {@link MediaDriver}.
     * @see Configuration#RESOLVER_BOOTSTRAP_NEIGHBOR_PROP_NAME
     * @see CommonContext#ENDPOINT_PARAM_NAME
     */
    public resolverBootstrapNeighbor(): string | null;
    /**
     * Set the bootstrap neighbor of the {@link MediaDriver} for name resolver purposes.
     * <p>
     * The format is comma separated list of {@code hostname:port} pairs and follows the URI format for the
     * endpoint parameter.
     *
     * @param resolverBootstrapNeighbor to use for the name resolver.
     * @return this for fluent API.
     * @see Configuration#RESOLVER_BOOTSTRAP_NEIGHBOR_PROP_NAME
     * @see CommonContext#ENDPOINT_PARAM_NAME
     */
    public resolverBootstrapNeighbor(resolverBootstrapNeighbor: string | null): this;
    public resolverBootstrapNeighbor(resolverBootstrapNeighbor?: string | null): string | null | this {
        if (undefined === resolverBootstrapNeighbor) {
            return this._resolverBootstrapNeighbor;
        }

        this._resolverBootstrapNeighbor = resolverBootstrapNeighbor;
        return this;
    }

    /**
     * Get the time to wait before removing a neighbor entry from the cache if an update for that neighbor has not
     * been received.
     *
     * @return the time to wait before removing a neighbor entry from the cache if an update for that neighbor has
     * not been received.
     * @see #resolverNeighborTimeoutNs(long)
     */
    public resolverNeighborTimeoutNs(): number;
    /**
     * Set the time to wait before removing a neighbor entry from the cache if an update for that neighbor has not
     * been received.
     *
     * @param timeoutNs to wait before removing a neighbor entry from the cache.
     * @return this for a fluent API.
     *
     */
    public resolverNeighborTimeoutNs(timeoutNs: number): this;
    public resolverNeighborTimeoutNs(timeoutNs?: number): number | this {
        if (undefined === timeoutNs) {
            return this._resolverNeighbourTimeoutNs;
        }

        this._resolverNeighbourTimeoutNs = timeoutNs;
        return this;
    }

    /**
     * Get the interval between sending name to address messages for this driver to its neighbors.
     *
     * @return the interval between sending name to address messages for this driver to its neighbors.
     * @see #resolverSelfResolutionIntervalNs(long)
     */
    public resolverSelfResolutionIntervalNs(): number;
    /**
     * Set the interval between sending name to address messages for this driver to its neighbors.
     *
     * @param intervalNs between sending name to address messages for this driver.
     * @return this for a fluent API.
     */
    public resolverSelfResolutionIntervalNs(intervalNs: number): this;
    public resolverSelfResolutionIntervalNs(intervalNs?: number): number | this {
        if (undefined === intervalNs) {
            return this._resolverSelfResolutionIntervalNs;
        }

        this._resolverSelfResolutionIntervalNs = intervalNs;
        return this;
    }

    /**
     * Get the interval between sending name to address messages for all known neighbors.
     *
     * @return the interval between sending name to address messages for all known neighbors.
     * @see #resolverNeighborResolutionIntervalNs(long)
     */
    public resolverNeighborResolutionIntervalNs(): number;
    /**
     * Set the interval between sending name to address messages for all known neighbors.
     *
     * @param intervalNs between sending name to address messages for all known neighbors.
     * @return this for a fluent API.
     */
    public resolverNeighborResolutionIntervalNs(intervalNs: number): this;
    public resolverNeighborResolutionIntervalNs(intervalNs?: number): number | this {
        if (undefined === intervalNs) {
            return this._resolverNeighborResolutionIntervalNs;
        }

        this._resolverNeighborResolutionIntervalNs = intervalNs;
        return this;
    }

    /**
     * Get the interval between resolutions of bootstrap neighbors that are not active.
     *
     * @return the interval between resolutions of bootstrap neighbors that are not active.
     * @see #resolverBootstrapNeighborResolutionIntervalNs(long)
     */
    public resolverBootstrapNeighborResolutionIntervalNs(): number;
    /**
     * Set the interval between resolutions of bootstrap neighbors that are not active.
     *
     * @param intervalNs between resolutions of bootstrap neighbors that are not active.
     * @return this for a fluent API.
     */
    public resolverBootstrapNeighborResolutionIntervalNs(intervalNs: number): this;
    public resolverBootstrapNeighborResolutionIntervalNs(intervalNs?: number): number | this {
        if (undefined === intervalNs) {
            return this._resolverBootstrapNeighborResolutionIntervalNs;
        }

        this._resolverBootstrapNeighborResolutionIntervalNs = intervalNs;
        return this;
    }

    /**
     * Get the interval for checking if a re-resolution for endpoints and controls should be done.
     * <p>
     * A value of 0 turns off checks and re-resolutions.
     *
     * @return timeout in ns.
     * @see Configuration#RE_RESOLUTION_CHECK_INTERVAL_PROP_NAME
     * @see Configuration#RE_RESOLUTION_CHECK_INTERVAL_DEFAULT_NS
     */
    public reResolutionCheckIntervalNs(): number;
    /**
     * Set the interval for checking if a re-resolution for endpoints and controls should be done.
     * <p>
     * A value of 0 turns off checks and re-resolutions.
     *
     * @param reResolutionCheckIntervalNs to use for check
     * @return this for fluent API.
     * @see Configuration#RE_RESOLUTION_CHECK_INTERVAL_PROP_NAME
     * @see Configuration#RE_RESOLUTION_CHECK_INTERVAL_DEFAULT_NS
     */
    public reResolutionCheckIntervalNs(reResolutionCheckIntervalNs: number): this;
    public reResolutionCheckIntervalNs(reResolutionCheckIntervalNs?: number): number | this {
        if (undefined === reResolutionCheckIntervalNs) {
            return this._reResolutionCheckIntervalNs;
        }

        this._reResolutionCheckIntervalNs = reResolutionCheckIntervalNs;
        return this;
    }

    /**
     * Threshold for the conductor work cycle time which when exceed it will increment the
     * {@link io.aeron.driver.status.SystemCounterDescriptor#CONDUCTOR_CYCLE_TIME_THRESHOLD_EXCEEDED} counter.
     *
     * @return threshold to track for the conductor work cycle time.
     */
    public conductorCycleThresholdNs(): number;
    /**
     * Set a threshold for the conductor work cycle time which when exceed it will increment the
     * {@link io.aeron.driver.status.SystemCounterDescriptor#CONDUCTOR_CYCLE_TIME_THRESHOLD_EXCEEDED} counter.
     *
     * @param thresholdNs value in nanoseconds
     * @return this for fluent API.
     * @see Configuration#CONDUCTOR_CYCLE_THRESHOLD_PROP_NAME
     * @see Configuration#CONDUCTOR_CYCLE_THRESHOLD_DEFAULT_NS
     */
    public conductorCycleThresholdNs(thresholdNs: number): this;
    public conductorCycleThresholdNs(thresholdNs?: number): number | this {
        if (undefined === thresholdNs) {
            return this._conductorCycleThresholdNs;
        }

        this._conductorCycleThresholdNs = thresholdNs;
        return this;
    }

    /**
     * Clock used record channel receive timestamps.
     *
     * @return a clock instance.
     */
    public channelReceiveTimestampClock(): EpochNanoClock | null;
    /**
     * Set the clock to be used to record channel receive timestamps.
     *
     * @param clock to provide ns-resolution timestamps since the epoch.
     * @return this for a fluent API.
     */
    public channelReceiveTimestampClock(clock: EpochNanoClock | null): this;
    public channelReceiveTimestampClock(clock?: EpochNanoClock | null): EpochNanoClock | null | this {
        if (undefined === clock) {
            return this._channelReceiveTimestampClock;
        }

        this._channelReceiveTimestampClock = clock;
        return this;
    }

    /**
     * Threshold for the sender work cycle time which when exceed it will increment the
     * {@link io.aeron.driver.status.SystemCounterDescriptor#SENDER_CYCLE_TIME_THRESHOLD_EXCEEDED} counter.
     *
     * @return threshold to track for the sender work cycle time.
     */
    public senderCycleThresholdNs(): number;
    /**
     * Set a threshold for the sender work cycle time which when exceed it will increment the
     * {@link io.aeron.driver.status.SystemCounterDescriptor#SENDER_CYCLE_TIME_THRESHOLD_EXCEEDED} counter.
     *
     * @param thresholdNs value in nanoseconds
     * @return this for fluent API.
     * @see Configuration#SENDER_CYCLE_THRESHOLD_PROP_NAME
     * @see Configuration#SENDER_CYCLE_THRESHOLD_DEFAULT_NS
     */
    public senderCycleThresholdNs(thresholdNs: number): this;
    public senderCycleThresholdNs(thresholdNs?: number): number | this {
        if (undefined === thresholdNs) {
            return this._senderCycleThresholdNs;
        }

        this._senderCycleThresholdNs = thresholdNs;
        return this;
    }

    /**
     * Threshold for the receiver work cycle time which when exceed it will increment the
     * {@link io.aeron.driver.status.SystemCounterDescriptor#RECEIVER_CYCLE_TIME_THRESHOLD_EXCEEDED} counter.
     *
     * @return threshold to track for the receiver work cycle time.
     */
    public receiverCycleThresholdNs(): number;
    /**
     * Set a threshold for the receiver work cycle time which when exceed it will increment the
     * {@link io.aeron.driver.status.SystemCounterDescriptor#RECEIVER_CYCLE_TIME_THRESHOLD_EXCEEDED} counter.
     *
     * @param thresholdNs value in nanoseconds
     * @return this for fluent API.
     * @see Configuration#RECEIVER_CYCLE_THRESHOLD_PROP_NAME
     * @see Configuration#RECEIVER_CYCLE_THRESHOLD_DEFAULT_NS
     */
    public receiverCycleThresholdNs(thresholdNs: number): this;
    public receiverCycleThresholdNs(thresholdNs?: number): number | this {
        if (undefined === thresholdNs) {
            return this._receiverCycleThresholdNs;
        }

        this._receiverCycleThresholdNs = thresholdNs;
        return this;
    }

    /**
     * Threshold for the {@link NameResolver} which when exceed it will increment the
     * {@link io.aeron.driver.status.SystemCounterDescriptor#NAME_RESOLVER_TIME_THRESHOLD_EXCEEDED} counter.
     *
     * @return threshold to track for the name resolution.
     */
    public nameResolverThresholdNs(): number;
    /**
     * Set a threshold for the {@link NameResolver} which when exceed it will increment the
     * {@link io.aeron.driver.status.SystemCounterDescriptor#NAME_RESOLVER_TIME_THRESHOLD_EXCEEDED} counter.
     *
     * @param thresholdNs value in nanoseconds
     * @return this for fluent API.
     * @see Configuration#NAME_RESOLVER_THRESHOLD_PROP_NAME
     * @see Configuration#NAME_RESOLVER_THRESHOLD_DEFAULT_NS
     */
    public nameResolverThresholdNs(thresholdNs: number): this;
    public nameResolverThresholdNs(thresholdNs?: number): number | this {
        if (undefined === thresholdNs) {
            return this._nameResolverThresholdNs;
        }

        this._nameResolverThresholdNs = thresholdNs;
        return this;
    }

    /**
     * Maximum number of {@link DriverManagedResource}s to free within a single duty cycle of the conductor.
     *
     * @return limit on the number of resources that can be freed.
     * @since 1.41.0
     */
    public resourceFreeLimit(): number;
    /**
     * Maximum number of {@link DriverManagedResource}s to free within a single duty cycle of the conductor.
     *
     * @param resourceFreeLimit number of resources to limit to.
     * @return this for a fluent API.
     * @see Configuration#resourceFreeLimit()
     * @see Configuration#RESOURCE_FREE_LIMIT_PROP_NAME
     * @see Configuration#RESOURCE_FREE_LIMIT_DEFAULT
     * @since 1.41.0
     */
    public resourceFreeLimit(resourceFreeLimit: number): this;
    public resourceFreeLimit(resourceFreeLimit?: number): number | this {
        if (undefined === resourceFreeLimit) {
            return this._resourceFreeLimit;
        }

        this._resourceFreeLimit = resourceFreeLimit;
        return this;
    }

    /**
     * Clock used record channel send timestamps.
     *
     * @return a clock instance.
     */
    public channelSendTimestampClock(): EpochNanoClock | null;
    /**
     * Set the clock to be used to record channel send timestamps.
     *
     * @param clock to provide ns-resolution timestamps since the epoch.
     * @return this for a fluent API.
     */
    public channelSendTimestampClock(clock: EpochNanoClock | null): this;
    public channelSendTimestampClock(clock?: EpochNanoClock | null): EpochNanoClock | null | this {
        if (undefined === clock) {
            return this._channelSendTimestampClock;
        }

        this._channelSendTimestampClock = clock;
        return this;
    }

    /**
     * Duty cycle tracker used for the conductor.
     *
     * @return conductor duty cycle tracker.
     */
    public conductorDutyCycleTracker(): DutyCycleTracker | null;
    /**
     * Set the duty cycle tracker used for the conductor.
     *
     * @param dutyCycleTracker for the conductor.
     * @return this for a fluent API.
     */
    public conductorDutyCycleTracker(dutyCycleTracker: DutyCycleTracker | null): this;
    public conductorDutyCycleTracker(dutyCycleTracker?: DutyCycleTracker | null): DutyCycleTracker | null | this {
        if (undefined === dutyCycleTracker) {
            return this._conductorDutyCycleTracker;
        }

        this._conductorDutyCycleTracker = dutyCycleTracker;
        return this;
    }

    /**
     * Duty cycle tracker used for the sender.
     *
     * @return sender duty cycle tracker.
     */
    public senderDutyCycleTracker(): DutyCycleTracker | null;
    /**
     * Set the duty cycle tracker used for the sender.
     *
     * @param dutyCycleTracker for the sender.
     * @return this for a fluent API.
     */
    public senderDutyCycleTracker(dutyCycleTracker: DutyCycleTracker | null): this;
    public senderDutyCycleTracker(dutyCycleTracker?: DutyCycleTracker | null): DutyCycleTracker | null | this {
        if (undefined === dutyCycleTracker) {
            return this._senderDutyCycleTracker;
        }

        this._senderDutyCycleTracker = dutyCycleTracker;
        return this;
    }

    /**
     * Duty cycle tracker used for the receiver.
     *
     * @return receiver duty cycle tracker.
     */
    public receiverDutyCycleTracker(): DutyCycleTracker | null;
    /**
     * Set the duty cycle tracker used for the receiver.
     *
     * @param dutyCycleTracker for the receiver.
     * @return this for a fluent API.
     */
    public receiverDutyCycleTracker(dutyCycleTracker: DutyCycleTracker | null): this;
    public receiverDutyCycleTracker(dutyCycleTracker?: DutyCycleTracker | null): DutyCycleTracker | null | this {
        if (undefined === dutyCycleTracker) {
            return this._receiverDutyCycleTracker;
        }

        this._receiverDutyCycleTracker = dutyCycleTracker;
        return this;
    }

    /**
     * Duty cycle tracker used for the {@link NameResolver}.
     *
     * @return {@link NameResolver} duty cycle tracker.
     */
    public nameResolverTimeTracker(): DutyCycleTracker | null;
    /**
     * Set the duty cycle tracker used for the {@link NameResolver}.
     *
     * @param dutyCycleTracker for the {@link NameResolver}.
     * @return this for a fluent API.
     */
    public nameResolverTimeTracker(dutyCycleTracker: DutyCycleTracker | null): this;
    public nameResolverTimeTracker(dutyCycleTracker?: DutyCycleTracker | null): DutyCycleTracker | null | this {
        if (undefined === dutyCycleTracker) {
            return this._nameResolverTimeTracker;
        }

        this._nameResolverTimeTracker = dutyCycleTracker;
        return this;
    }

    /**
     * Wildcard port range used for the Sender.
     *
     * @return port range as a string in the format "low high".
     */
    public senderWildcardPortRange(): string | null;
    /**
     * Set the wildcard port range to be used for the Sender.
     * <p>
     * Format is a string in "low high". With low being the low port value and high being the high port value. For
     * example, "100 200". A null value or a value of "0 0" will use OS wildcard functionality.
     *
     * @param portRange as a string in the format "low high".
     * @return this for fluent API.
     * @see Configuration#SENDER_WILDCARD_PORT_RANGE_PROP_NAME
     */
    public senderWildcardPortRange(portRange: string | null): this;
    public senderWildcardPortRange(portRange?: string | null): string | null | this {
        if (undefined === portRange) {
            return this._senderWildcardPortRange;
        }

        this._senderWildcardPortRange = portRange;
        return this;
    }

    /**
     * Wildcard port range used for the Receiver.
     *
     * @return port range as a string in the format "low high".
     */
    public receiverWildcardPortRange(): string | null;
    /**
     * Set the wildcard port range to be used for the Receiver.
     * <p>
     * Format is a string in "low high". With low being the low port value and high being the high port value. For
     * example, "100 200". A null value or a value of "0 0" will use OS wildcard functionality.
     *
     * @param portRange as a string in the format "low high".
     * @return this for fluent API.
     * @see Configuration#RECEIVER_WILDCARD_PORT_RANGE_PROP_NAME
     */
    public receiverWildcardPortRange(portRange: string | null): this;
    public receiverWildcardPortRange(portRange?: string | null): string | null | this {
        if (undefined === portRange) {
            return this._receiverWildcardPortRange;
        }

        this._receiverWildcardPortRange = portRange;
        return this;
    }

    /**
     * The {@link PortManager} used for the Sender.
     *
     * @return Sender {@link PortManager}.
     */
    public senderPortManager(): PortManager | null;
    /**
     * Set the {@link PortManager} used for the Sender.
     *
     * @param portManager to use.
     * @return this for a fluent API.
     */
    public senderPortManager(portManager: PortManager | null): this;
    public senderPortManager(portManager?: PortManager | null): PortManager | null | this {
        if (undefined === portManager) {
            return this._senderPortManager;
        }

        this._senderPortManager = portManager;
        return this;
    }

    /**
     * The {@link PortManager} used for the Receiver.
     *
     * @return Receiver {@link PortManager}.
     */
    public receiverPortManager(): PortManager | null;
    /**
     * Set the {@link PortManager} used for the Receiver.
     *
     * @param portManager to use.
     * @return this for a fluent API.
     */
    public receiverPortManager(portManager: PortManager | null): this;
    public receiverPortManager(portManager?: PortManager | null): PortManager | null | this {
        if (undefined === portManager) {
            return this._receiverPortManager;
        }

        this._receiverPortManager = portManager;
        return this;
    }

    /**
     * Supplier of the send channel endpoints.
     *
     * @return the supplier of the send channel endpoints.
     */
    public sendChannelEndpointSupplier(): SendChannelEndpointSupplier | null;
    /**
     * Supplier of the send channel endpoints, which can be used for debugging, monitoring, or modifying the behaviour
     * when sending to the channel.
     *
     * @param supplier to be used.
     * @return this for a fluent API.
     */
    public sendChannelEndpointSupplier(supplier: SendChannelEndpointSupplier | null): this;
    public sendChannelEndpointSupplier(
        supplier?: SendChannelEndpointSupplier | null,
    ): SendChannelEndpointSupplier | null | this {
        if (undefined === supplier) {
            return this._sendChannelEndpointSupplier;
        }

        this._sendChannelEndpointSupplier = supplier;
        return this;
    }

    /**
     * Supplier of the receive channel endpoints.
     *
     * @return the supplier of the receive channel endpoints.
     */
    public receiveChannelEndpointSupplier(): ReceiveChannelEndpointSupplier | null;
    /**
     * Supplier of the receive channel endpoints, which can be used for debugging, monitoring, or modifying the
     * behaviour when receiving from the channel.
     *
     * @param supplier to be used.
     * @return this for a fluent API.
     */
    public receiveChannelEndpointSupplier(supplier: ReceiveChannelEndpointSupplier | null): this;
    public receiveChannelEndpointSupplier(
        supplier?: ReceiveChannelEndpointSupplier | null,
    ): ReceiveChannelEndpointSupplier | null | this {
        if (undefined === supplier) {
            return this._receiveChannelEndpointSupplier;
        }

        this._receiveChannelEndpointSupplier = supplier;
        return this;
    }

    /**
     * The state that only the receiver uses, and that the receive channel endpoints share.
     *
     * @return the thread locals of the receive channel endpoints.
     */
    public receiveChannelEndpointThreadLocals(): ReceiveChannelEndpointThreadLocals | null;
    /**
     * The state that only the receiver uses, and that the receive channel endpoints share.
     *
     * @param threadLocals to be used.
     * @return this for a fluent API.
     */
    public receiveChannelEndpointThreadLocals(threadLocals: ReceiveChannelEndpointThreadLocals | null): this;
    public receiveChannelEndpointThreadLocals(
        threadLocals?: ReceiveChannelEndpointThreadLocals | null,
    ): ReceiveChannelEndpointThreadLocals | null | this {
        if (undefined === threadLocals) {
            return this._receiveChannelEndpointThreadLocals;
        }

        this._receiveChannelEndpointThreadLocals = threadLocals;
        return this;
    }

    /**
     * The poller of the data transports of the receive channel endpoints.
     *
     * @return the data transport poller.
     * @internal package-private in Java
     */
    public dataTransportPoller(): DataTransportPoller | null;
    public dataTransportPoller(transportPoller: DataTransportPoller | null): this;
    public dataTransportPoller(transportPoller?: DataTransportPoller | null): DataTransportPoller | null | this {
        if (undefined === transportPoller) {
            return this._dataTransportPoller;
        }

        this._dataTransportPoller = transportPoller;
        return this;
    }

    /**
     * The poller of the control transports of the send channel endpoints. `conclude` creates it with the counted error
     * handler and the {@link DriverConductorProxy}.
     *
     * @return the control transport poller.
     * @internal package-private in Java
     */
    public controlTransportPoller(): ControlTransportPoller | null;
    public controlTransportPoller(transportPoller: ControlTransportPoller | null): this;
    public controlTransportPoller(
        transportPoller?: ControlTransportPoller | null,
    ): ControlTransportPoller | null | this {
        if (undefined === transportPoller) {
            return this._controlTransportPoller;
        }

        this._controlTransportPoller = transportPoller;
        return this;
    }

    /**
     * The factory of the log buffers of publications and images (a {@link MemoryLogFactory} unless set, spec D4). Added
     * by T15.
     *
     * @return the log factory.
     * @internal package-private in Java
     */
    public logFactory(): LogFactory | null;
    public logFactory(logFactory: LogFactory | null): this;
    public logFactory(logFactory?: LogFactory | null): LogFactory | null | this {
        if (undefined === logFactory) {
            return this._logFactory;
        }

        this._logFactory = logFactory;
        return this;
    }

    /**
     * The queue of the commands for the receiver. A command is a closure (Java: a `Runnable`). Added by T16.
     *
     * @return the receiver command queue.
     * @internal package-private in Java
     */
    public receiverCommandQueue(): OneToOneConcurrentArrayQueue<() => void> | null;
    public receiverCommandQueue(receiverCommandQueue: OneToOneConcurrentArrayQueue<() => void> | null): this;
    public receiverCommandQueue(
        receiverCommandQueue?: OneToOneConcurrentArrayQueue<() => void> | null,
    ): OneToOneConcurrentArrayQueue<() => void> | null | this {
        if (undefined === receiverCommandQueue) {
            return this._receiverCommandQueue;
        }

        this._receiverCommandQueue = receiverCommandQueue;
        return this;
    }

    /**
     * The queue of the commands for the sender. A command is a closure (Java: a `Runnable`). Added by T15.
     *
     * @return the sender command queue.
     * @internal package-private in Java
     */
    public senderCommandQueue(): OneToOneConcurrentArrayQueue<() => void> | null;
    public senderCommandQueue(senderCommandQueue: OneToOneConcurrentArrayQueue<() => void> | null): this;
    public senderCommandQueue(
        senderCommandQueue?: OneToOneConcurrentArrayQueue<() => void> | null,
    ): OneToOneConcurrentArrayQueue<() => void> | null | this {
        if (undefined === senderCommandQueue) {
            return this._senderCommandQueue;
        }

        this._senderCommandQueue = senderCommandQueue;
        return this;
    }

    /**
     * The proxy that the conductor offers its commands to the receiver through. Added by T16.
     *
     * @return the receiver proxy.
     * @internal package-private in Java
     */
    public receiverProxy(): ReceiverProxy | null;
    public receiverProxy(receiverProxy: ReceiverProxy | null): this;
    public receiverProxy(receiverProxy?: ReceiverProxy | null): ReceiverProxy | null | this {
        if (undefined === receiverProxy) {
            return this._receiverProxy;
        }

        this._receiverProxy = receiverProxy;
        return this;
    }

    /**
     * The proxy that the conductor offers its commands to the sender through. Added by T15.
     *
     * @return the sender proxy.
     * @internal package-private in Java
     */
    public senderProxy(): SenderProxy | null;
    public senderProxy(senderProxy: SenderProxy | null): this;
    public senderProxy(senderProxy?: SenderProxy | null): SenderProxy | null | this {
        if (undefined === senderProxy) {
            return this._senderProxy;
        }

        this._senderProxy = senderProxy;
        return this;
    }

    /**
     * The default `SO_RCVBUF` of a datagram socket of this OS, probed once.
     *
     * @return the length in bytes.
     * @internal package-private in Java
     */
    public osDefaultSocketRcvbufLength(): number {
        this.resolveOsSocketBufLengths();
        return this._osDefaultSocketRcvbufLength;
    }

    /**
     * The largest `SO_RCVBUF` that this OS gives a datagram socket, probed once.
     *
     * @return the length in bytes.
     * @internal package-private in Java
     */
    public osMaxSocketRcvbufLength(): number {
        this.resolveOsSocketBufLengths();
        return this._osMaxSocketRcvbufLength;
    }

    /**
     * The default `SO_SNDBUF` of a datagram socket of this OS, probed once.
     *
     * @return the length in bytes.
     * @internal package-private in Java
     */
    public osDefaultSocketSndbufLength(): number {
        this.resolveOsSocketBufLengths();
        return this._osDefaultSocketSndbufLength;
    }

    /**
     * The largest `SO_SNDBUF` that this OS gives a datagram socket, probed once.
     *
     * @return the length in bytes.
     * @internal package-private in Java
     */
    public osMaxSocketSndbufLength(): number {
        this.resolveOsSocketBufLengths();
        return this._osMaxSocketSndbufLength;
    }

    /**
     * Read the default and the largest socket buffer lengths of the OS from a probe socket, once. Node can read a
     * buffer size only from a bound socket, so the probe is bound to the loopback address on an ephemeral port.
     *
     * @internal package-private in Java
     */
    public resolveOsSocketBufLengths(): void {
        if (Aeron.NULL_VALUE !== this._osMaxSocketRcvbufLength) {
            return;
        }

        const probe = dgram.createSocket({
            type: 'udp4',
            lookup: (hostname, _options, callback) => {
                (callback as (err: Error | null, address: string, family: number) => void)(null, hostname, 4);
            },
        });
        probe.on('error', () => {});
        try {
            probe.bind(0, '127.0.0.1');
            this._osDefaultSocketSndbufLength = probe.getSendBufferSize();

            probe.setSendBufferSize(Integer.MAX_VALUE);
            this._osMaxSocketSndbufLength = probe.getSendBufferSize();

            this._osDefaultSocketRcvbufLength = probe.getRecvBufferSize();

            probe.setRecvBufferSize(Integer.MAX_VALUE);
            this._osMaxSocketRcvbufLength = probe.getRecvBufferSize();
        } catch (ex) {
            throw new AeronException('probe socket: ' + ex, ex as Error);
        } finally {
            try {
                probe.close();
            } catch {
                // not open
            }
        }
    }

    /**
     * Get the limit on the number of sessions allow per stream for subscriptions.
     *
     * @return the limit of sessions per stream
     * @see Context#streamSessionLimit(int)
     */
    public streamSessionLimit(): number;
    /**
     * Set the limit on the number of sessions allow per stream for subscriptions.
     *
     * @param sessionLimit the limit of sessions per stream
     * @return this for a fluent API.
     * @see Configuration#STREAM_SESSION_LIMIT_PROP_NAME
     * @see Configuration#STREAM_SESSION_LIMIT_DEFAULT
     * @see Configuration#streamSessionLimit()
     */
    public streamSessionLimit(sessionLimit: number): this;
    public streamSessionLimit(sessionLimit?: number): number | this {
        if (undefined === sessionLimit) {
            return this._streamSessionLimit;
        }

        this._streamSessionLimit = sessionLimit;
        return this;
    }

    /**
     * Counted error handler that wraps {@link #errorHandler()} and
     * {@link io.aeron.driver.status.SystemCounterDescriptor#ERRORS} counter.
     *
     * @return counted error handler.
     */
    public countedErrorHandler(): CountedErrorHandler | null;
    public countedErrorHandler(countedErrorHandler: CountedErrorHandler | null): this;
    public countedErrorHandler(countedErrorHandler?: CountedErrorHandler | null): CountedErrorHandler | null | this {
        if (undefined === countedErrorHandler) {
            return this._countedErrorHandler;
        }

        this._countedErrorHandler = countedErrorHandler;
        return this;
    }

    /**
     * The queue of the commands for the driver conductor.
     *
     * @return the queue.
     * @internal package-private in Java
     */
    public driverCommandQueue(): ManyToOneConcurrentLinkedQueue<Runnable> | null;
    public driverCommandQueue(queue: ManyToOneConcurrentLinkedQueue<Runnable> | null): this;
    public driverCommandQueue(
        queue?: ManyToOneConcurrentLinkedQueue<Runnable> | null,
    ): ManyToOneConcurrentLinkedQueue<Runnable> | null | this {
        if (undefined === queue) {
            return this._driverCommandQueue;
        }

        this._driverCommandQueue = queue;
        return this;
    }

    /**
     * The proxy for the responses to the clients. `conclude` creates it over the to-clients buffer of the CnC.
     *
     * @return the proxy.
     * @internal package-private in Java
     */
    public clientProxy(): ClientProxy | null;
    public clientProxy(clientProxy: ClientProxy | null): this;
    public clientProxy(clientProxy?: ClientProxy | null): ClientProxy | null | this {
        if (undefined === clientProxy) {
            return this._clientProxy;
        }

        this._clientProxy = clientProxy;
        return this;
    }

    /**
     * The proxy for the commands to the driver conductor. `conclude` creates it over the driver command queue.
     *
     * @return the proxy.
     * @internal package-private in Java
     */
    public driverConductorProxy(): DriverConductorProxy | null;
    public driverConductorProxy(driverConductorProxy: DriverConductorProxy | null): this;
    public driverConductorProxy(
        driverConductorProxy?: DriverConductorProxy | null,
    ): DriverConductorProxy | null | this {
        if (undefined === driverConductorProxy) {
            return this._driverConductorProxy;
        }

        this._driverConductorProxy = driverConductorProxy;
        return this;
    }

    public toDriverCommands(): RingBuffer | null;
    public toDriverCommands(toDriverCommands: RingBuffer | null): this;
    public toDriverCommands(toDriverCommands?: RingBuffer | null): RingBuffer | null | this {
        if (undefined === toDriverCommands) {
            return this._toDriverCommands;
        }

        this._toDriverCommands = toDriverCommands;
        return this;
    }

    public cncByteBuffer(): SharedArrayBuffer | null;
    public cncByteBuffer(cncByteBuffer: SharedArrayBuffer | null): this;
    public cncByteBuffer(cncByteBuffer?: SharedArrayBuffer | null): SharedArrayBuffer | null | this {
        if (undefined === cncByteBuffer) {
            return this._cncByteBuffer;
        }

        this._cncByteBuffer = cncByteBuffer;
        return this;
    }

    /**
     * The supplier of the flow control of unicast publications. Added by T18.
     *
     * @internal package-private in Java
     */
    public unicastFlowControlSupplier(): FlowControlSupplier | null;
    public unicastFlowControlSupplier(unicastFlowControlSupplier: FlowControlSupplier | null): this;
    public unicastFlowControlSupplier(
        unicastFlowControlSupplier?: FlowControlSupplier | null,
    ): FlowControlSupplier | null | this {
        if (undefined === unicastFlowControlSupplier) {
            return this._unicastFlowControlSupplier;
        }

        this._unicastFlowControlSupplier = unicastFlowControlSupplier;
        return this;
    }

    /**
     * The supplier of the flow control of multicast and multi-destination publications. Added by T18.
     *
     * @internal package-private in Java
     */
    public multicastFlowControlSupplier(): FlowControlSupplier | null;
    public multicastFlowControlSupplier(multicastFlowControlSupplier: FlowControlSupplier | null): this;
    public multicastFlowControlSupplier(
        multicastFlowControlSupplier?: FlowControlSupplier | null,
    ): FlowControlSupplier | null | this {
        if (undefined === multicastFlowControlSupplier) {
            return this._multicastFlowControlSupplier;
        }

        this._multicastFlowControlSupplier = multicastFlowControlSupplier;
        return this;
    }

    /**
     * The supplier of the congestion control of images. Added by T18.
     *
     * @internal package-private in Java
     */
    public congestionControlSupplier(): CongestionControlSupplier | null {
        return this._congestionControlSupplier;
    }

    /**
     * Set the supplier. Java's name for the setter is `congestControlSupplier`.
     */
    public congestControlSupplier(congestionControlSupplier: CongestionControlSupplier | null): this {
        this._congestionControlSupplier = congestionControlSupplier;
        return this;
    }

    /**
     * The delay generator of unicast retransmits. Added by T18.
     *
     * @internal package-private in Java
     */
    public retransmitUnicastDelayGenerator(): FeedbackDelayGenerator | null;
    public retransmitUnicastDelayGenerator(retransmitUnicastDelayGenerator: FeedbackDelayGenerator | null): this;
    public retransmitUnicastDelayGenerator(
        retransmitUnicastDelayGenerator?: FeedbackDelayGenerator | null,
    ): FeedbackDelayGenerator | null | this {
        if (undefined === retransmitUnicastDelayGenerator) {
            return this._retransmitUnicastDelayGenerator;
        }

        this._retransmitUnicastDelayGenerator = retransmitUnicastDelayGenerator;
        return this;
    }

    /**
     * The linger generator of unicast retransmits. Added by T18.
     *
     * @internal package-private in Java
     */
    public retransmitUnicastLingerGenerator(): FeedbackDelayGenerator | null;
    public retransmitUnicastLingerGenerator(retransmitUnicastLingerGenerator: FeedbackDelayGenerator | null): this;
    public retransmitUnicastLingerGenerator(
        retransmitUnicastLingerGenerator?: FeedbackDelayGenerator | null,
    ): FeedbackDelayGenerator | null | this {
        if (undefined === retransmitUnicastLingerGenerator) {
            return this._retransmitUnicastLingerGenerator;
        }

        this._retransmitUnicastLingerGenerator = retransmitUnicastLingerGenerator;
        return this;
    }

    /**
     * The delay generator of unicast NAKs. Added by T18.
     *
     * @internal package-private in Java
     */
    public unicastFeedbackDelayGenerator(): FeedbackDelayGenerator | null;
    public unicastFeedbackDelayGenerator(unicastFeedbackDelayGenerator: FeedbackDelayGenerator | null): this;
    public unicastFeedbackDelayGenerator(
        unicastFeedbackDelayGenerator?: FeedbackDelayGenerator | null,
    ): FeedbackDelayGenerator | null | this {
        if (undefined === unicastFeedbackDelayGenerator) {
            return this._unicastFeedbackDelayGenerator;
        }

        this._unicastFeedbackDelayGenerator = unicastFeedbackDelayGenerator;
        return this;
    }

    /**
     * The delay generator of multicast NAKs. Added by T18.
     *
     * @internal package-private in Java
     */
    public multicastFeedbackDelayGenerator(): FeedbackDelayGenerator | null;
    public multicastFeedbackDelayGenerator(multicastFeedbackDelayGenerator: FeedbackDelayGenerator | null): this;
    public multicastFeedbackDelayGenerator(
        multicastFeedbackDelayGenerator?: FeedbackDelayGenerator | null,
    ): FeedbackDelayGenerator | null | this {
        if (undefined === multicastFeedbackDelayGenerator) {
            return this._multicastFeedbackDelayGenerator;
        }

        this._multicastFeedbackDelayGenerator = multicastFeedbackDelayGenerator;
        return this;
    }

    /**
     * The validator of the termination requests. Added by T18.
     *
     * @internal package-private in Java
     */
    public terminationValidator(): TerminationValidator | null;
    public terminationValidator(terminationValidator: TerminationValidator | null): this;
    public terminationValidator(
        terminationValidator?: TerminationValidator | null,
    ): TerminationValidator | null | this {
        if (undefined === terminationValidator) {
            return this._terminationValidator;
        }

        this._terminationValidator = terminationValidator;
        return this;
    }

    /**
     * The queue of the commands for the native resource agent. Added by T18.
     *
     * @internal package-private in Java
     */
    public nativeResourceAgentCommandQueue(): OneToOneConcurrentArrayQueue<() => void> | null;
    public nativeResourceAgentCommandQueue(
        nativeResourceAgentCommandQueue: OneToOneConcurrentArrayQueue<() => void> | null,
    ): this;
    public nativeResourceAgentCommandQueue(
        nativeResourceAgentCommandQueue?: OneToOneConcurrentArrayQueue<() => void> | null,
    ): OneToOneConcurrentArrayQueue<() => void> | null | this {
        if (undefined === nativeResourceAgentCommandQueue) {
            return this._nativeResourceAgentCommandQueue;
        }

        this._nativeResourceAgentCommandQueue = nativeResourceAgentCommandQueue;
        return this;
    }

    /**
     * The proxy that the conductor offers its commands to the native resource agent through. Added by T18.
     *
     * @internal package-private in Java
     */
    public nativeResourceAgentProxy(): NativeResourceAgentProxy | null;
    public nativeResourceAgentProxy(nativeResourceAgentProxy: NativeResourceAgentProxy | null): this;
    public nativeResourceAgentProxy(
        nativeResourceAgentProxy?: NativeResourceAgentProxy | null,
    ): NativeResourceAgentProxy | null | this {
        if (undefined === nativeResourceAgentProxy) {
            return this._nativeResourceAgentProxy;
        }

        this._nativeResourceAgentProxy = nativeResourceAgentProxy;
        return this;
    }

    private concludeNullProperties(): void {
        if (null === this._tempBuffer) {
            this._tempBuffer = new UnsafeBuffer(new Uint8Array(CountersReader.METADATA_LENGTH));
        }

        if (null === this._epochClock) {
            this._epochClock = SystemEpochClock.INSTANCE;
        }

        if (null === this._nanoClock) {
            this._nanoClock = SystemNanoClock.INSTANCE;
        }

        if (null === this._cachedEpochClock) {
            this._cachedEpochClock = new CachedEpochClock();
        }

        if (null === this._cachedNanoClock) {
            this._cachedNanoClock = new CachedNanoClock();
        }

        if (null === this._senderCachedNanoClock) {
            this._senderCachedNanoClock = new CachedNanoClock();
        }

        if (null === this._receiverCachedNanoClock) {
            this._receiverCachedNanoClock = new CachedNanoClock();
        }

        if (null === this._sendChannelEndpointSupplier) {
            this._sendChannelEndpointSupplier = Configuration.sendChannelEndpointSupplier();
        }

        if (null === this._receiveChannelEndpointSupplier) {
            this._receiveChannelEndpointSupplier = Configuration.receiveChannelEndpointSupplier();
        }

        if (null === this._unicastFlowControlSupplier) {
            this._unicastFlowControlSupplier = Configuration.unicastFlowControlSupplier();
        }

        if (null === this._multicastFlowControlSupplier) {
            this._multicastFlowControlSupplier = Configuration.multicastFlowControlSupplier();
        }

        if (null === this._congestionControlSupplier) {
            this._congestionControlSupplier = Configuration.congestionControlSupplier();
        }

        if (null === this._nativeResourceAgentCommandQueue) {
            this._nativeResourceAgentCommandQueue = new OneToOneConcurrentArrayQueue<() => void>(
                Configuration.CMD_QUEUE_CAPACITY,
            );
        }

        if (null === this._retransmitUnicastDelayGenerator) {
            this._retransmitUnicastDelayGenerator = new StaticDelayGenerator(this._retransmitUnicastDelayNs);
        }

        if (null === this._retransmitUnicastLingerGenerator) {
            this._retransmitUnicastLingerGenerator = new StaticDelayGenerator(this._retransmitUnicastLingerNs);
        }

        if (null === this._unicastFeedbackDelayGenerator) {
            this._unicastFeedbackDelayGenerator = new StaticDelayGenerator(
                this._nakUnicastDelayNs,
                this._nakUnicastDelayNs * this._nakUnicastRetryDelayRatio,
            );
        }

        if (null === this._multicastFeedbackDelayGenerator) {
            this._multicastFeedbackDelayGenerator = new OptimalMulticastDelayGenerator(
                this._nakMulticastMaxBackoffNs,
                this._nakMulticastGroupSize,
            );
        }

        if (null === this._terminationValidator) {
            this._terminationValidator = Configuration.terminationValidator();
        }

        if (null === this._receiverCommandQueue) {
            this._receiverCommandQueue = new OneToOneConcurrentArrayQueue<() => void>(Configuration.CMD_QUEUE_CAPACITY);
        }

        if (null === this._senderCommandQueue) {
            this._senderCommandQueue = new OneToOneConcurrentArrayQueue<() => void>(Configuration.CMD_QUEUE_CAPACITY);
        }

        if (null === this._applicationSpecificFeedback) {
            this._applicationSpecificFeedback = Configuration.applicationSpecificFeedback();
        }

        if (null === this._receiverGroupTag) {
            if (this._applicationSpecificFeedback.length > 0) {
                if (this._applicationSpecificFeedback.length !== BitUtil.SIZE_OF_LONG) {
                    throw new IllegalArgumentException(
                        'applicationSpecificFeedback length must be equal to ' +
                            BitUtil.SIZE_OF_LONG +
                            ' bytes: length=' +
                            this._applicationSpecificFeedback.length,
                    );
                }

                const buffer = new UnsafeBuffer(this._applicationSpecificFeedback);
                this._receiverGroupTag = buffer.getLong(0, ByteOrder.LITTLE_ENDIAN);
            }
        }

        if (null === this._receiveChannelEndpointThreadLocals) {
            this._receiveChannelEndpointThreadLocals = new ReceiveChannelEndpointThreadLocals();
        }

        if (null === this._threadingMode) {
            this._threadingMode = Configuration.threadingMode();
        }

        if (null === this._driverCommandQueue) {
            this._driverCommandQueue = new ManyToOneConcurrentLinkedQueue<Runnable>();
        }

        if (null === this._nameResolver) {
            this._nameResolver = DefaultNameResolver.INSTANCE;
        }

        if (null === this._senderPortManager) {
            this._senderPortManager = new WildcardPortManager(
                WildcardPortManager.parsePortRange(this._senderWildcardPortRange),
                true,
            );
        }

        if (null === this._receiverPortManager) {
            this._receiverPortManager = new WildcardPortManager(
                WildcardPortManager.parsePortRange(this._receiverWildcardPortRange),
                false,
            );
        }

        if (null === this._channelReceiveTimestampClock) {
            this._channelReceiveTimestampClock = new SystemEpochNanoClock();
        }

        if (null === this._channelSendTimestampClock) {
            this._channelSendTimestampClock = new SystemEpochNanoClock();
        }

        if (null !== this._resolverInterface && Strings.isEmpty(this._resolverName)) {
            throw new ConfigurationException('`resolverName` is required when `resolverInterface` is set');
        }
    }

    private concludeCounters(): void {
        if (null === this._countersManager) {
            if (this.countersMetaDataBuffer() === null) {
                this.countersMetaDataBuffer(
                    CncFileDescriptor.createCountersMetaDataBuffer(
                        this._cncByteBuffer as SharedArrayBuffer,
                        this._cncMetaDataBuffer as UnsafeBuffer,
                    ),
                );
            }

            if (this.countersValuesBuffer() === null) {
                this.countersValuesBuffer(
                    CncFileDescriptor.createCountersValuesBuffer(
                        this._cncByteBuffer as SharedArrayBuffer,
                        this._cncMetaDataBuffer as UnsafeBuffer,
                    ),
                );
            }

            const reuseTimeoutMs =
                this._counterFreeToReuseTimeoutNs > 0
                    ? Math.max(TimeUnit.NANOSECONDS.toMillis(this._counterFreeToReuseTimeoutNs), 1)
                    : 0;

            this._countersManager = this._useConcurrentCountersManager
                ? new ConcurrentCountersManager(
                      this.countersMetaDataBuffer() as UnsafeBuffer,
                      this.countersValuesBuffer() as UnsafeBuffer,
                      StandardCharsets.US_ASCII,
                      this._cachedEpochClock as CachedEpochClock,
                      reuseTimeoutMs,
                  )
                : new CountersManager(
                      this.countersMetaDataBuffer() as UnsafeBuffer,
                      this.countersValuesBuffer() as UnsafeBuffer,
                      StandardCharsets.US_ASCII,
                      this._cachedEpochClock as CachedEpochClock,
                      reuseTimeoutMs,
                  );
        }

        if (null === this._systemCounters) {
            this._systemCounters = new SystemCounters(this._countersManager);
        }

        const systemCounters = this._systemCounters;
        const threadingMode = this._threadingMode as ThreadingMode;

        const aeronVersion = SemanticVersion.compose(
            MediaDriverVersion.MAJOR_VERSION,
            MediaDriverVersion.MINOR_VERSION,
            MediaDriverVersion.PATCH_VERSION,
        );
        systemCounters.get(SystemCounterDescriptor.AERON_VERSION).set(aeronVersion);
        systemCounters
            .get(SystemCounterDescriptor.CONTROL_PROTOCOL_VERSION)
            .set(ControlProtocolEvents.CONTROL_PROTOCOL_SEMANTIC_VERSION);

        systemCounters.get(SystemCounterDescriptor.CONDUCTOR_MAX_CYCLE_TIME).appendToLabel(': ' + threadingMode.name());
        systemCounters
            .get(SystemCounterDescriptor.CONDUCTOR_CYCLE_TIME_THRESHOLD_EXCEEDED)
            .appendToLabel(
                ': threshold=' +
                    SystemUtil.formatDuration(this._conductorCycleThresholdNs) +
                    ' ' +
                    threadingMode.name(),
            );

        systemCounters.get(SystemCounterDescriptor.SENDER_MAX_CYCLE_TIME).appendToLabel(': ' + threadingMode.name());
        systemCounters
            .get(SystemCounterDescriptor.SENDER_CYCLE_TIME_THRESHOLD_EXCEEDED)
            .appendToLabel(
                ': threshold=' + SystemUtil.formatDuration(this._senderCycleThresholdNs) + ' ' + threadingMode.name(),
            );

        systemCounters.get(SystemCounterDescriptor.RECEIVER_MAX_CYCLE_TIME).appendToLabel(': ' + threadingMode.name());
        systemCounters
            .get(SystemCounterDescriptor.RECEIVER_CYCLE_TIME_THRESHOLD_EXCEEDED)
            .appendToLabel(
                ': threshold=' + SystemUtil.formatDuration(this._receiverCycleThresholdNs) + ' ' + threadingMode.name(),
            );

        systemCounters
            .get(SystemCounterDescriptor.NAME_RESOLVER_TIME_THRESHOLD_EXCEEDED)
            .appendToLabel(': threshold=' + SystemUtil.formatDuration(this._nameResolverThresholdNs));
    }

    private concludeDependantProperties(): void {
        const systemCounters = this._systemCounters as SystemCounters;
        const cncByteBuffer = this._cncByteBuffer as SharedArrayBuffer;
        const cncMetaDataBuffer = this._cncMetaDataBuffer as UnsafeBuffer;

        this._clientProxy = new ClientProxy(
            new BroadcastTransmitter(CncFileDescriptor.createToClientsBuffer(cncByteBuffer, cncMetaDataBuffer)),
        );

        this._toDriverCommands = new ManyToOneRingBuffer(
            CncFileDescriptor.createToDriverBuffer(cncByteBuffer, cncMetaDataBuffer),
        );

        if (null === this._errorLog) {
            this._errorLog = new DistinctErrorLog(
                CncFileDescriptor.createErrorLogBuffer(cncByteBuffer, cncMetaDataBuffer),
                this._epochClock as EpochClock,
                StandardCharsets.US_ASCII,
            );
        }

        this._errorHandler = CommonContext.setupErrorHandler(this._errorHandler, this._errorLog);

        if (null === this._countedErrorHandler) {
            this._countedErrorHandler = new CountedErrorHandler(
                this._errorHandler,
                systemCounters.get(SystemCounterDescriptor.ERRORS),
            );
        }

        // The loss report is the application's to give (there is no loss report file, spec section 3, D50).
        this._receiverProxy = new ReceiverProxy(
            this._receiverCommandQueue as OneToOneConcurrentArrayQueue<() => void>,
            systemCounters.get(SystemCounterDescriptor.RECEIVER_PROXY_FAILS),
        );
        this._senderProxy = new SenderProxy(
            this._senderCommandQueue as OneToOneConcurrentArrayQueue<() => void>,
            systemCounters.get(SystemCounterDescriptor.SENDER_PROXY_FAILS),
        );
        this._driverConductorProxy = new DriverConductorProxy(
            this._driverCommandQueue as ManyToOneConcurrentLinkedQueue<Runnable>,
        );
        this._nativeResourceAgentProxy = new NativeResourceAgentProxy(
            this._nativeResourceAgentCommandQueue as OneToOneConcurrentArrayQueue<() => void>,
            systemCounters.get(SystemCounterDescriptor.NATIVE_RESOURCE_AGENT_PROXY_FAILS),
        );

        if (null === this._controlTransportPoller) {
            this._controlTransportPoller = new ControlTransportPoller(
                this._countedErrorHandler,
                this._driverConductorProxy,
            );
        }

        if (null === this._dataTransportPoller) {
            this._dataTransportPoller = new DataTransportPoller(this._countedErrorHandler);
        }

        if (null === this._logFactory) {
            // Java: new FileStoreLogFactory(aeronDirectoryName(), filePageSize, performStorageChecks,
            // lowStorageWarningThreshold, errorHandler, BYTES_CURRENTLY_MAPPED); the logs are in memory (spec D4, D35)
            this._logFactory = new MemoryLogFactory(
                this._filePageSize,
                this._errorHandler,
                systemCounters.get(SystemCounterDescriptor.BYTES_CURRENTLY_MAPPED),
            );
        }

        if (null === this._conductorDutyCycleTracker) {
            this._conductorDutyCycleTracker = new DutyCycleStallTracker(
                systemCounters.get(SystemCounterDescriptor.CONDUCTOR_MAX_CYCLE_TIME),
                systemCounters.get(SystemCounterDescriptor.CONDUCTOR_CYCLE_TIME_THRESHOLD_EXCEEDED),
                this._conductorCycleThresholdNs,
            );
        }

        if (null === this._senderDutyCycleTracker) {
            this._senderDutyCycleTracker = new DutyCycleStallTracker(
                systemCounters.get(SystemCounterDescriptor.SENDER_MAX_CYCLE_TIME),
                systemCounters.get(SystemCounterDescriptor.SENDER_CYCLE_TIME_THRESHOLD_EXCEEDED),
                this._senderCycleThresholdNs,
            );
        }

        if (null === this._receiverDutyCycleTracker) {
            this._receiverDutyCycleTracker = new DutyCycleStallTracker(
                systemCounters.get(SystemCounterDescriptor.RECEIVER_MAX_CYCLE_TIME),
                systemCounters.get(SystemCounterDescriptor.RECEIVER_CYCLE_TIME_THRESHOLD_EXCEEDED),
                this._receiverCycleThresholdNs,
            );
        }

        if (null === this._nameResolverTimeTracker) {
            this._nameResolverTimeTracker = new DutyCycleStallTracker(
                systemCounters.get(SystemCounterDescriptor.NAME_RESOLVER_MAX_TIME),
                systemCounters.get(SystemCounterDescriptor.NAME_RESOLVER_TIME_THRESHOLD_EXCEEDED),
                this._nameResolverThresholdNs,
            );
        }

        // Java builds a DriverNameResolver here when resolverInterface is set: the name resolver gossip is out of
        // scope (spec section 3), so the nameResolver stays the one set above.

        const countersManager = this._countersManager as CountersManager;
        (this._nameResolver as NameResolverAgent).init(countersManager, countersManager);
    }

    private concludeIdleStrategies(): void {
        const countersManager = this._countersManager as CountersManager;
        const indicator = new UnsafeBufferStatusIndicator(
            countersManager.valuesBuffer(),
            SystemCounterDescriptor.CONTROLLABLE_IDLE_STRATEGY.id(),
        );

        // The thread factories are not ported (spec D3): a mode other than INVOKER starts no threads here.
        switch (this._threadingMode) {
            case ThreadingMode.INVOKER:
                break;

            case ThreadingMode.SHARED:
                if (null === this._sharedIdleStrategy) {
                    this._sharedIdleStrategy = Configuration.sharedIdleStrategy(indicator);
                }
                break;

            case ThreadingMode.SHARED_NETWORK:
                if (null === this._conductorIdleStrategy) {
                    this._conductorIdleStrategy = Configuration.conductorIdleStrategy(indicator);
                }

                if (null === this._sharedNetworkIdleStrategy) {
                    this._sharedNetworkIdleStrategy = Configuration.sharedNetworkIdleStrategy(indicator);
                }
                break;

            case ThreadingMode.DEDICATED:
                if (null === this._conductorIdleStrategy) {
                    this._conductorIdleStrategy = Configuration.conductorIdleStrategy(indicator);
                }

                if (null === this._senderIdleStrategy) {
                    this._senderIdleStrategy = Configuration.senderIdleStrategy(indicator);
                }

                if (null === this._receiverIdleStrategy) {
                    this._receiverIdleStrategy = Configuration.receiverIdleStrategy(indicator);
                }
                break;
        }
    }

    public override toString(): string {
        return (
            'MediaDriver.Context' +
            '\n{' +
            '\n    isConcluded=' +
            this.isConcluded() +
            '\n    isClosed=' +
            this._isClosed +
            '\n    cncVersion=' +
            SemanticVersion.toString(CncFileDescriptor.CNC_VERSION) +
            '\n    printConfigurationOnStart=' +
            this._printConfigurationOnStart +
            '\n    termBufferSparseFile=' +
            this._termBufferSparseFile +
            '\n    performStorageChecks=' +
            this._performStorageChecks +
            '\n    spiesSimulateConnection=' +
            this._spiesSimulateConnection +
            '\n    reliableStream=' +
            this._reliableStream +
            '\n    tetherSubscriptions=' +
            this._tetherSubscriptions +
            '\n    rejoinStream=' +
            this._rejoinStream +
            '\n    receiverGroupConsideration=' +
            this._receiverGroupConsideration +
            '\n    conductorBufferLength=' +
            this._conductorBufferLength +
            '\n    toClientsBufferLength=' +
            this._toClientsBufferLength +
            '\n    counterValuesBufferLength=' +
            this._counterValuesBufferLength +
            '\n    errorBufferLength=' +
            this._errorBufferLength +
            '\n    lowStorageWarningThreshold=' +
            this._lowStorageWarningThreshold +
            '\n    timerIntervalNs=' +
            this._timerIntervalNs +
            '\n    clientLivenessTimeoutNs=' +
            this._clientLivenessTimeoutNs +
            '\n    imageLivenessTimeoutNs=' +
            this._imageLivenessTimeoutNs +
            '\n    publicationUnblockTimeoutNs=' +
            this._publicationUnblockTimeoutNs +
            '\n    publicationConnectionTimeoutNs=' +
            this._publicationConnectionTimeoutNs +
            '\n    publicationLingerTimeoutNs=' +
            this._publicationLingerTimeoutNs +
            '\n    untetheredWindowLimitTimeoutNs=' +
            this._untetheredWindowLimitTimeoutNs +
            '\n    untetheredRestingTimeoutNs=' +
            this._untetheredRestingTimeoutNs +
            '\n    retransmitUnicastDelayNs=' +
            this._retransmitUnicastDelayNs +
            '\n    retransmitUnicastLingerNs=' +
            this._retransmitUnicastLingerNs +
            '\n    nakUnicastDelayNs=' +
            this._nakUnicastDelayNs +
            '\n    nakMulticastMaxBackoffNs=' +
            this._nakMulticastMaxBackoffNs +
            '\n    nakMulticastGroupSize=' +
            this._nakMulticastGroupSize +
            '\n    statusMessageTimeoutNs=' +
            this._statusMessageTimeoutNs +
            '\n    counterFreeToReuseTimeoutNs=' +
            this._counterFreeToReuseTimeoutNs +
            '\n    conductorCycleThresholdNs=' +
            this._conductorCycleThresholdNs +
            '\n    senderCycleThresholdNs=' +
            this._senderCycleThresholdNs +
            '\n    receiverCycleThresholdNs=' +
            this._receiverCycleThresholdNs +
            '\n    nameResolverThresholdNs=' +
            this._nameResolverThresholdNs +
            '\n    publicationTermBufferLength=' +
            this._publicationTermBufferLength +
            '\n    ipcTermBufferLength=' +
            this._ipcTermBufferLength +
            '\n    publicationTermWindowLength=' +
            this._publicationTermWindowLength +
            '\n    ipcPublicationTermWindowLength=' +
            this._ipcPublicationTermWindowLength +
            '\n    initialWindowLength=' +
            this._initialWindowLength +
            '\n    socketSndbufLength=' +
            this._socketSndbufLength +
            '\n    socketRcvbufLength=' +
            this._socketRcvbufLength +
            '\n    socketMulticastTtl=' +
            this._socketMulticastTtl +
            '\n    mtuLength=' +
            this._mtuLength +
            '\n    ipcMtuLength=' +
            this._ipcMtuLength +
            '\n    filePageSize=' +
            this._filePageSize +
            '\n    publicationReservedSessionIdLow=' +
            this._publicationReservedSessionIdLow +
            '\n    publicationReservedSessionIdHigh=' +
            this._publicationReservedSessionIdHigh +
            '\n    lossReportBufferLength=' +
            this._lossReportBufferLength +
            '\n    epochClock=' +
            this._epochClock +
            '\n    nanoClock=' +
            this._nanoClock +
            '\n    cachedEpochClock=' +
            this._cachedEpochClock +
            '\n    cachedNanoClock=' +
            this._cachedNanoClock +
            '\n    threadingMode=' +
            this._threadingMode +
            '\n    conductorIdleStrategy=' +
            this._conductorIdleStrategy +
            '\n    senderIdleStrategy=' +
            this._senderIdleStrategy +
            '\n    receiverIdleStrategy=' +
            this._receiverIdleStrategy +
            '\n    sharedNetworkIdleStrategy=' +
            this._sharedNetworkIdleStrategy +
            '\n    sharedIdleStrategy=' +
            this._sharedIdleStrategy +
            '\n    tempBuffer=' +
            this._tempBuffer +
            '\n    applicationSpecificFeedback=' +
            bytesToString(this._applicationSpecificFeedback) +
            '\n    receiverGroupTag=' +
            this._receiverGroupTag +
            '\n    flowControlGroupMinSize=' +
            this._flowControlGroupMinSize +
            '\n    flowControlReceiverTimeoutNs=' +
            this._flowControlReceiverTimeoutNs +
            '\n    unicastFlowControlRetransmitReceiverWindowMultiple=' +
            this._unicastFlowControlRetransmitReceiverWindowMultiple +
            '\n    multicastFControlRetransmitReceiverWindowMultiple=' +
            this._multicastFlowControlRetransmitReceiverWindowMultiple +
            '\n    reResolutionCheckIntervalNs=' +
            this._reResolutionCheckIntervalNs +
            '\n    receiverGroupConsideration=' +
            this._receiverGroupConsideration +
            '\n    terminationHook=' +
            this._terminationHook +
            '\n    nameResolver=' +
            this._nameResolver +
            "\n    resolverName='" +
            this._resolverName +
            "'" +
            "\n    resolverInterface='" +
            this._resolverInterface +
            "'" +
            "\n    resolverBootstrapNeighbor='" +
            this._resolverBootstrapNeighbor +
            "'" +
            '\n    sendToStatusMessagePollRatio=' +
            this._sendToStatusMessagePollRatio +
            '\n    errorLog=' +
            this._errorLog +
            '\n    errorHandler=' +
            this._errorHandler +
            '\n    useConcurrentCountersManager=' +
            this._useConcurrentCountersManager +
            '\n    countersManager=' +
            this._countersManager +
            '\n    systemCounters=' +
            this._systemCounters +
            '\n    controlTransportPoller=' +
            this._controlTransportPoller +
            '\n    driverCommandQueue=' +
            this._driverCommandQueue +
            '\n    driverConductorProxy=' +
            this._driverConductorProxy +
            '\n    clientProxy=' +
            this._clientProxy +
            '\n    toDriverCommands=' +
            this._toDriverCommands +
            '\n    cncByteBuffer=' +
            this._cncByteBuffer +
            '\n    cncMetaDataBuffer=' +
            this._cncMetaDataBuffer +
            '\n    channelSendTimestampClock=' +
            this._channelSendTimestampClock +
            '\n    channelReceiveTimestampClock=' +
            this._channelReceiveTimestampClock +
            '\n    conductorDutyCycleTracker=' +
            this._conductorDutyCycleTracker +
            '\n    senderDutyCycleTracker=' +
            this._senderDutyCycleTracker +
            '\n    receiverDutyCycleTracker=' +
            this._receiverDutyCycleTracker +
            '\n    senderWildcardPortRange=' +
            this._senderWildcardPortRange +
            '\n    receiverWildcardPortRange=' +
            this._receiverWildcardPortRange +
            '\n    senderPortManager=' +
            this._senderPortManager +
            '\n    receiverPortManager=' +
            this._receiverPortManager +
            '\n    resourceFreeLimit=' +
            this._resourceFreeLimit +
            '\n    maxResend=' +
            this._maxResend +
            '\n}'
        );
    }
}

/**
 * Main class of the media driver: it concludes the {@link MediaDriverContext}, makes the agents and steps them from
 * an {@link AgentInvoker} (`sharedAgentInvoker()`) in the order sender, receiver, native resource agent, conductor.
 * <p>
 * With `ThreadingMode.INVOKER` the application calls the invoker. With any other mode the driver runs itself on the
 * event loop (spec D3, D11, D100): {@link MediaDriver.launch} starts an {@link AgentRunner} with one agent for all of
 * them (the thread modes that Java has are one JS thread here), the idle strategy of the context
 * (`sharedIdleStrategy`, a back off by default), and the wake up hooks of spec D8: a datagram arriving, a send
 * completing, a command of a client and the look-up of a host name. The conductors of the clients of this process
 * (`Aeron.connect` with `AeronContext.mediaDriver`) run in the same duty cycle ({@link MediaDriver.host}).
 * <p>
 * The Aeron directory, its checks and its deletion are not ported (the CnC is in memory, spec D4), nor are
 * `main`, `launchEmbedded` (no directory name to generate), the high resolution timer and the thread factories.
 */
export class MediaDriver implements AutoCloseable {
    public static readonly AERON_DRIVER_SENDER_THREAD_NAME = 'aeron-md-snd';
    public static readonly AERON_DRIVER_RECEIVER_THREAD_NAME = 'aeron-md-rcv';
    public static readonly AERON_DRIVER_SHARED_THREAD_NAME = 'aeron-md-shd';
    public static readonly AERON_DRIVER_CONDUCTOR_THREAD_NAME = 'aeron-md-cnd';
    public static readonly AERON_DRIVER_SHARED_NETWORK_THREAD_NAME = 'aeron-md-net';
    public static readonly AERON_DRIVER_NATIVE_RESOURCE_THREAD_NAME = 'aeron-md-nra';

    public static readonly AERON_DRIVER_SENDER_THREAD_NAME_CLASSIC = 'sender';
    public static readonly AERON_DRIVER_RECEIVER_THREAD_NAME_CLASSIC = 'receiver';
    public static readonly AERON_DRIVER_CONDUCTOR_THREAD_NAME_CLASSIC = 'driver-conductor';

    /**
     * The nested class `MediaDriver.Context`.
     */
    public static readonly Context = MediaDriverContext;

    private readonly sharedInvoker: AgentInvoker;
    private readonly ctx: MediaDriverContext;
    private readonly embeddedAgent: EmbeddedAgent | null;
    private readonly agentRunner: AgentRunner | null;
    private readonly wakeRunner: () => void;

    /**
     * Construct a media driver with the given ctx.
     *
     * @param ctx for the media driver parameters
     */
    private constructor(ctx: MediaDriverContext) {
        this.ctx = ctx;
        Configuration.validateSocketBufferLengths(ctx);

        try {
            ctx.conclude();
            const systemCounters = ctx.systemCounters() as SystemCounters;
            const errorCounter = systemCounters.get(SystemCounterDescriptor.ERRORS);
            const errorHandler = ctx.errorHandler() as ErrorHandler;

            const nativeResourceAgent = new NativeResourceAgent(ctx);
            (ctx.nativeResourceAgentProxy() as NativeResourceAgentProxy).nativeResourceAgent(nativeResourceAgent);

            const conductor = new DriverConductor(ctx);
            const receiver = new Receiver(ctx);
            const sender = new Sender(ctx);

            (ctx.driverConductorProxy() as DriverConductorProxy).driverConductor(conductor);
            (ctx.receiverProxy() as ReceiverProxy).receiver(receiver);
            (ctx.senderProxy() as SenderProxy).sender(sender);

            this.sharedInvoker = new AgentInvoker(
                errorHandler,
                errorCounter,
                new CompositeAgent(sender, receiver, nativeResourceAgent, conductor),
            );

            if (ThreadingMode.INVOKER === ctx.threadingMode()) {
                this.embeddedAgent = null;
                this.agentRunner = null;
                this.wakeRunner = () => {};
            } else {
                const embeddedAgent = new EmbeddedAgent(this.sharedInvoker);
                const indicator = new UnsafeBufferStatusIndicator(
                    (ctx.countersManager() as CountersManager).valuesBuffer(),
                    SystemCounterDescriptor.CONTROLLABLE_IDLE_STRATEGY.id(),
                );
                const runner = new AgentRunner(
                    ctx.sharedIdleStrategy() ?? Configuration.sharedIdleStrategy(indicator),
                    errorHandler,
                    errorCounter,
                    embeddedAgent,
                );
                const applicationWakeUp = ctx.wakeUp();
                this.embeddedAgent = embeddedAgent;
                this.agentRunner = runner;
                this.wakeRunner = (): void => {
                    runner.wake();
                    applicationWakeUp?.();
                };
                ctx.wakeUp(this.wakeRunner);
                nativeResourceAgent.setWakeUp(this.wakeRunner);
            }
        } catch (ex) {
            if (ex instanceof ConcurrentConcludeException) {
                throw ex;
            }
            CloseHelper.quietClose({ close: () => ctx.close() });
            throw ex;
        }
    }

    /**
     * Launch a MediaDriver embedded in the current process with default configuration, or with the configuration ctx.
     *
     * @param ctx containing the configuration options.
     * @return the newly created MediaDriver.
     */
    public static launch(ctx: MediaDriverContext = new MediaDriverContext()): MediaDriver {
        const mediaDriver = new MediaDriver(ctx);
        mediaDriver.sharedInvoker.start();
        if (null !== mediaDriver.agentRunner) {
            AgentRunner.startOnThread(mediaDriver.agentRunner);
        }

        return mediaDriver;
    }

    /**
     * Get the {@link MediaDriver.Context} that is used by this {@link MediaDriver}.
     *
     * @return the {@link MediaDriver.Context} that is used by this {@link MediaDriver}.
     */
    public context(): MediaDriverContext {
        return this.ctx;
    }

    /**
     * Get the {@link AgentInvoker} for the shared agents when running without threads.
     *
     * @return the {@link AgentInvoker} for the shared agents when running without threads.
     */
    public sharedAgentInvoker(): AgentInvoker {
        return this.sharedInvoker;
    }

    /**
     * Not in Java (spec D100). The {@link AgentRunner} that runs the driver on the event loop.
     *
     * @return the runner, or null if the context has {@link ThreadingMode.INVOKER}: the application steps the driver.
     */
    public runner(): AgentRunner | null {
        return this.agentRunner;
    }

    /**
     * Not in Java (spec D8, D100). Cut short the idle wait of the runner, so that its next duty cycle runs now. It is
     * what a datagram, a send, a command of a client and a host name look-up do. An application that has put a message
     * in a publication and wants it to leave without waiting for the end of a park (at most the maximum park of the
     * idle strategy, 1 ms by default) calls it. It does nothing if the runner is not parked, or if there is none.
     */
    public wake(): void {
        this.wakeRunner();
    }

    /**
     * Not in Java (spec D100). Run the conductor of a client of this process in the duty cycle of the runner, after
     * the driver ({@code Aeron.connect} does it for a client that does not use an invoker).
     *
     * @param invoker of the conductor of the client, started.
     * @return true if it is hosted, false if there is no runner to host it (the application steps the driver).
     */
    public host(invoker: AgentInvoker): boolean {
        if (null === this.embeddedAgent) {
            return false;
        }

        this.embeddedAgent.host(invoker);
        return true;
    }

    /**
     * Not in Java (spec D100). Stop running the conductor of a client: it was closed.
     *
     * @param invoker of the conductor of the client.
     */
    public unhost(invoker: AgentInvoker): void {
        this.embeddedAgent?.unhost(invoker);
    }

    /**
     * Shutdown the media driver by stopping all agents and freeing resources.
     */
    public close(): void {
        if (null !== this.agentRunner) {
            // the runner ends the loop and closes the agent, which closes the invoker
            CloseHelper.closeAll(this.agentRunner, this.sharedInvoker);
        } else {
            CloseHelper.closeAll(this.sharedInvoker);
        }
    }

    public toString(): string {
        return 'MediaDriver{}';
    }
}

type MediaDriverContextType = MediaDriverContext;

// Declaration merging: `MediaDriver.Context` is a type as well as a value, as the nested Java class is.
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace MediaDriver {
    export type Context = MediaDriverContextType;
}
