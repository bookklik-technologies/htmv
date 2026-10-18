/**
 * Output writers (spec 11.4): memory/blob, FileSystemFileHandle, OPFS with
 * cleanup, library-owned SeekableWriter, and append-only fragmented streams.
 */
import { DEFAULT_MEMORY_ADMISSION_BYTES, SeekableWriter, OutputTarget, ExportResult, RenderManifest } from './types.js';
import { Diagnostic, error } from '@htmv/core';

export interface WriterSession {
  /** Sequential or positioned writes; the engine owns close/abort for the session. */
  write(position: bigint | null, bytes: Uint8Array): Promise<void>;
  bytesWritten(): bigint;
  finish(): Promise<ExportResult>;
  abort(reason: string): Promise<void>;
}

export interface WriterFactory {
  (manifest: RenderManifest): Promise<WriterSession>;
}

export class MemoryWriterSession implements WriterSession {
  private chunks = new Map<number, Uint8Array>();
  private position = 0n;
  private maxBytes: number;
  constructor(maxBytes = DEFAULT_MEMORY_ADMISSION_BYTES) {
    this.maxBytes = maxBytes;
  }
  async write(position: bigint | null, bytes: Uint8Array): Promise<void> {
    const start = position ?? this.position;
    const end = start + BigInt(bytes.byteLength);
    if (start < 0n || end > BigInt(this.maxBytes)) {
      throw new Error('E_RESOURCE_LIMIT: in-memory output exceeded the admission estimate; use an explicit streaming target or raise maxBytes.');
    }
    const PAGE = 65536;
    for (let offset = 0; offset < bytes.length;) {
      const at = Number(start) + offset; const index = Math.floor(at / PAGE); const within = at % PAGE;
      let page = this.chunks.get(index); if (!page) { page = new Uint8Array(PAGE); this.chunks.set(index, page); }
      const length = Math.min(bytes.length - offset, PAGE - within); page.set(bytes.subarray(offset, offset + length), within); offset += length;
    }
    if (end > this.position) this.position = end;
  }
  bytesWritten(): bigint {
    return this.position;
  }
  async finish(): Promise<ExportResult> {
    return {
      kind: 'blob',
      blob: new Blob(Array.from({ length: Math.ceil(Number(this.position) / 65536) }, (_, i) => (this.chunks.get(i) ?? new Uint8Array(65536)).slice(0, Math.min(65536, Number(this.position) - i * 65536))) as BlobPart[]),
      manifest: {} as RenderManifest
    };
  }
  async abort(_reason: string): Promise<void> {
    this.chunks.clear();
    this.position = 0n;
  }
}

export class OpfsWriterSession implements WriterSession {
  private handle: FileSystemFileHandle | null = null;
  private access: FileSystemWritableFileStream | null = null;
  private position = 0n;
  private name: string;
  constructor(name: string) {
    this.name = `${name || 'htmv-export'}-${crypto.randomUUID()}.tmp`;
  }
  async ensure(): Promise<void> {
    if (this.access) return;
    const root = await navigator.storage.getDirectory();
    this.handle = await root.getFileHandle(this.name, { create: true });
    this.access = await this.handle.createWritable();
  }
  async write(position: bigint | null, bytes: Uint8Array): Promise<void> {
    await this.ensure();
    const start = position ?? this.position;
    await this.access!.write({ type: 'write', position: Number(start), data: bytes as unknown as BufferSource });
    if (start + BigInt(bytes.length) > this.position) this.position = start + BigInt(bytes.length);
  }
  bytesWritten(): bigint {
    return this.position;
  }
  async finish(): Promise<ExportResult> {
    await this.ensure();
    await this.access!.truncate(Number(this.position));
    await this.access!.close();
    this.access = null;
    const file = await this.handle!.getFile();
    return {
      kind: 'opfs',
      file,
      cleanup: async () => {
        try {
          const root = await navigator.storage.getDirectory();
          await root.removeEntry(this.name);
        } catch {
          // OPFS eviction/site-data clearing can remove files first (spec 11.4/S10)
        }
      },
      manifest: {} as RenderManifest
    };
  }
  async abort(reason: string): Promise<void> {
    try {
      await this.access?.abort(reason);
    } catch {
      void reason;
    }
    this.access = null;
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(this.name);
    } catch {
      // cleanup removes only artifacts created by this render
    }
  }
}

export class FileHandleWriterSession implements WriterSession {
  private position = 0n;
  private handle: FileSystemFileHandle;
  private stream: FileSystemWritableFileStream | null = null;
  constructor(handle: FileSystemFileHandle) {
    this.handle = handle;
  }
  async write(position: bigint | null, bytes: Uint8Array): Promise<void> {
    this.stream ??= await this.handle.createWritable();
    const start = position ?? this.position;
    await this.stream.write({ type: 'write', position: Number(start), data: bytes as unknown as BufferSource });
    if (start + BigInt(bytes.length) > this.position) this.position = start + BigInt(bytes.length);
  }
  bytesWritten(): bigint {
    return this.position;
  }
  async finish(): Promise<ExportResult> {
    this.stream ??= await this.handle.createWritable();
    await this.stream.truncate(Number(this.position));
    await this.stream.close(); this.stream = null;
    return { kind: 'file', bytesWritten: Number(this.position), manifest: {} as RenderManifest };
  }
  async abort(reason: string): Promise<void> {
    await this.stream?.abort(reason); this.stream = null;
  }
}

export class SeekableWriterSession implements WriterSession {
  private writer: SeekableWriter;
  private position = 0n;
  constructor(writer: SeekableWriter) {
    this.writer = writer;
  }
  async write(position: bigint | null, bytes: Uint8Array): Promise<void> {
    const start = position ?? this.position;
    await this.writer.writeAt(start, bytes);
    if (start + BigInt(bytes.length) > this.position) this.position = start + BigInt(bytes.length);
  }
  bytesWritten(): bigint {
    return this.position;
  }
  async finish(): Promise<ExportResult> {
    await this.writer.close();
    return { kind: 'file', bytesWritten: Number(this.position), manifest: {} as RenderManifest };
  }
  async abort(reason: string): Promise<void> {
    await this.writer.abort(reason);
  }
}

export class AppendOnlyWriterSession implements WriterSession {
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private position = 0n;
  constructor(stream: WritableStream<Uint8Array>) {
    this.writer = stream.getWriter();
  }
  async write(position: bigint | null, bytes: Uint8Array): Promise<void> {
    if (position !== null && position !== this.position) throw new Error('E_WRITER: append-only output cannot seek.');
    await this.writer.write(bytes);
    this.position += BigInt(bytes.byteLength);
  }
  bytesWritten(): bigint {
    return this.position;
  }
  async finish(): Promise<ExportResult> {
    await this.writer.close();
    return { kind: 'file', bytesWritten: Number(this.position), manifest: {} as RenderManifest };
  }
  async abort(reason: string): Promise<void> {
    try {
      await this.writer.abort(reason);
    } catch {
      // append-only abort discards from this point; no backward seek
    }
  }
}

export async function createWriterSession(target: OutputTarget): Promise<WriterSession> {
  switch (target.kind) {
    case 'memory':
      return new MemoryWriterSession(target.maxBytes);
    case 'opfs':
      return new OpfsWriterSession(target.name ?? '');
    case 'file':
      return new FileHandleWriterSession(target.handle);
    case 'writer':
      return new SeekableWriterSession(target.writer);
    case 'append-only':
      return new AppendOnlyWriterSession(target.stream);
  }
}

export function writerQuotaError(e: unknown): Diagnostic {
  const err = e as Error;
  if (/quota|storage/i.test(err.message ?? '')) {
    return error('E_STORAGE_QUOTA', `Storage quota unavailable: ${err.message}`);
  }
  return error('E_WRITER', `Output write failed: ${err.message}`);
}

// Minimal OPFS sync access handle surface (lib DOM may lag the spec)
interface OpfsSyncAccessHandle {
  write(buffer: BufferSource, options?: { at?: number }): number;
  flush(): void;
  close(): void;
  truncate?(newSize: number): void;
}

