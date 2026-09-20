import { open, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const MAX_BYTES = 64 * 1024;
const FORMAT = 'GhostFlow/ledger-file-v1';
const MAX_ENVELOPE_BYTES = Buffer.byteLength(JSON.stringify({ format: FORMAT, sha256: '0'.repeat(64), bytes: '' }) + '\n') + MAX_BYTES * 2;
const activeWriterPaths = new Set();

function normalizedAbsolutePath(filename) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename)) throw new TypeError('ledger requires an absolute file path');
  return path.normalize(filename);
}

/** Single-process, single-writer desktop reference storage, not ESP32 NVS.
 * A successful write means file fsync, atomic rename, and (on POSIX hosts)
 * parent-directory fsync completed. Windows rejects fsync on a directory
 * fd (EPERM), so the directory sync is skipped there; the synced-file
 * rename is the durability boundary on win32. One process must own each
 * normalized path; cross-process ownership still requires an external
 * storage owner. Filesystem/hardware power-loss guarantees still apply.
 */
export class FileLedger {
  #filename;
  constructor(filename) {
    this.#filename = normalizedAbsolutePath(filename); this.writing = false;
  }
  get filename() { return this.#filename; }
  async read() {
    const filename = this.#filename;
    let handle;
    let raw;
    try {
      handle = await open(filename, 'r');
      const metadata = await handle.stat();
      if (!metadata.isFile() || !Number.isSafeInteger(metadata.size) || metadata.size > MAX_ENVELOPE_BYTES) throw new Error('ledger envelope exceeds bound');
      // Do not let a malformed file choose a readFile allocation. A file that
      // changes size during this bounded read is not an authoritative ledger.
      raw = Buffer.allocUnsafe(metadata.size);
      let offset = 0;
      while (offset < raw.length) {
        const { bytesRead } = await handle.read(raw, offset, raw.length - offset, offset);
        if (bytesRead === 0) throw new Error('ledger changed while reading');
        offset += bytesRead;
      }
      if ((await handle.stat()).size !== metadata.size) throw new Error('ledger changed while reading');
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    } finally {
      if (handle) await handle.close();
    }
    const envelope = JSON.parse(raw.toString('utf8'));
    if (envelope.format !== FORMAT || typeof envelope.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(envelope.sha256) || typeof envelope.bytes !== 'string' || !/^(?:[0-9a-f]{2})+$/.test(envelope.bytes)) throw new Error('invalid ledger envelope');
    const bytes = Buffer.from(envelope.bytes, 'hex');
    if (bytes.length > MAX_BYTES || envelope.bytes.length !== bytes.length * 2 || bytes.toString('hex') !== envelope.bytes) throw new Error('invalid ledger envelope');
    if (sha256(bytes) !== envelope.sha256) throw new Error('ledger checksum mismatch');
    return bytes;
  }
  async persist(bytes) {
    if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_BYTES) throw new TypeError('invalid or oversized ledger bytes');
    // Take an immutable copy before the first await. The caller may reuse or
    // mutate its Uint8Array as soon as persist() returns its Promise.
    const copy = Buffer.from(bytes);
    const filename = this.#filename;
    if (this.writing || activeWriterPaths.has(filename)) throw new Error('ledger writer is busy');
    this.writing = true; activeWriterPaths.add(filename);
    let handle;
    try {
      const directory = path.dirname(filename);
      await mkdir(directory, { recursive: true });
      const temporary = `${filename}.${randomUUID()}.pending`;
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ format: FORMAT, sha256: sha256(copy), bytes: copy.toString('hex') }) + '\n');
      await handle.sync(); await handle.close(); handle = null;
      await rename(temporary, filename);
      // POSIX durability idiom; Windows cannot fsync a directory fd (EPERM).
      if (process.platform !== 'win32') {
        const parent = await open(directory, 'r');
        try { await parent.sync(); } finally { await parent.close(); }
      }
      return true;
    } finally {
      try {
        if (handle) await handle.close();
      } finally {
        // An interrupted .pending file is retained for diagnostics, never used
        // as a grant. Any write failure rejects, so its caller must fail closed.
        this.writing = false;
        activeWriterPaths.delete(filename);
      }
    }
  }
}
