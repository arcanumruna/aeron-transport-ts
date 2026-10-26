// A small stand-in for java.nio.ByteBuffer, for the tests that use one as an independent view of the memory under
// test. It is a window of an ArrayBuffer with a byte order, a position and the typed absolute accessors.
import { ByteOrder } from '../../src/agrona/jdk.js';

export class ByteBuffer {
    private readonly view: DataView;
    private byteOrder: ByteOrder = ByteOrder.BIG_ENDIAN;
    private pos = 0;
    private lim: number;

    private constructor(
        private readonly buffer: ArrayBufferLike,
        private readonly offset: number,
        private readonly cap: number,
    ) {
        this.view = new DataView(buffer, offset, cap);
        this.lim = cap;
    }

    public static allocate(capacity: number, shared = false): ByteBuffer {
        return new ByteBuffer(shared ? new SharedArrayBuffer(capacity) : new ArrayBuffer(capacity), 0, capacity);
    }

    public static allocateDirect(capacity: number, shared = false): ByteBuffer {
        return ByteBuffer.allocate(capacity, shared);
    }

    public static wrap(buffer: ArrayBufferLike): ByteBuffer {
        return new ByteBuffer(buffer, 0, buffer.byteLength);
    }

    public arrayBuffer(): ArrayBufferLike {
        return this.buffer;
    }

    public arrayOffset(): number {
        return this.offset;
    }

    public capacity(): number {
        return this.cap;
    }

    public order(): ByteOrder;
    public order(byteOrder: ByteOrder): ByteBuffer;
    public order(byteOrder?: ByteOrder): ByteOrder | ByteBuffer {
        if (undefined === byteOrder) {
            return this.byteOrder;
        }

        this.byteOrder = byteOrder;
        return this;
    }

    public position(): number;
    public position(newPosition: number): ByteBuffer;
    public position(newPosition?: number): number | ByteBuffer {
        if (undefined === newPosition) {
            return this.pos;
        }

        this.pos = newPosition;
        return this;
    }

    public limit(): number {
        return this.lim;
    }

    public flip(): ByteBuffer {
        this.lim = this.pos;
        this.pos = 0;
        return this;
    }

    public slice(): ByteBuffer {
        return new ByteBuffer(this.buffer, this.offset + this.pos, this.lim - this.pos);
    }

    public put(index: number, value: number): ByteBuffer;
    public put(src: Uint8Array): ByteBuffer;
    public put(arg: number | Uint8Array, value?: number): ByteBuffer {
        if (typeof arg === 'number') {
            this.view.setInt8(arg, value!);
        } else {
            for (let i = 0; i < arg.length; i++) {
                this.view.setInt8(this.pos++, arg[i]!);
            }
        }

        return this;
    }

    public get(index: number): number;
    public get(dst: Uint8Array): ByteBuffer;
    public get(arg: number | Uint8Array): number | ByteBuffer {
        if (typeof arg === 'number') {
            return this.view.getInt8(arg);
        }

        for (let i = 0; i < arg.length; i++) {
            arg[i] = this.view.getUint8(this.pos++);
        }

        return this;
    }

    private littleEndian(): boolean {
        return ByteOrder.LITTLE_ENDIAN === this.byteOrder;
    }

    public putLong(index: number, value: number): ByteBuffer {
        this.view.setBigInt64(index, BigInt(value), this.littleEndian());
        return this;
    }

    public getLong(index: number): number {
        return Number(this.view.getBigInt64(index, this.littleEndian()));
    }

    public putInt(index: number, value: number): ByteBuffer {
        this.view.setInt32(index, value, this.littleEndian());
        return this;
    }

    public getInt(index: number): number {
        return this.view.getInt32(index, this.littleEndian());
    }

    public putShort(index: number, value: number): ByteBuffer {
        this.view.setInt16(index, value, this.littleEndian());
        return this;
    }

    public getShort(index: number): number {
        return this.view.getInt16(index, this.littleEndian());
    }

    public putChar(index: number, value: number): ByteBuffer {
        this.view.setUint16(index, value, this.littleEndian());
        return this;
    }

    public getChar(index: number): number {
        return this.view.getUint16(index, this.littleEndian());
    }

    public putFloat(index: number, value: number): ByteBuffer {
        this.view.setFloat32(index, value, this.littleEndian());
        return this;
    }

    public getFloat(index: number): number {
        return this.view.getFloat32(index, this.littleEndian());
    }

    public putDouble(index: number, value: number): ByteBuffer {
        this.view.setFloat64(index, value, this.littleEndian());
        return this;
    }

    public getDouble(index: number): number {
        return this.view.getFloat64(index, this.littleEndian());
    }

    public toString(): string {
        return `ByteBuffer[pos=${this.pos} cap=${this.cap} order=${this.byteOrder}]`;
    }
}
