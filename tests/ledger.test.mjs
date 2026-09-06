import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileLedger } from '../runtimes/node/ledger.mjs';

test('durable desktop envelope round-trips and corruption is not a fresh ledger', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ghostflow-ledger-test-'));
  const file = path.join(dir, 'station.ledger');
  const ledger = new FileLedger(file);
  assert.equal(await ledger.read(), null);
  await ledger.persist(new Uint8Array([1, 2, 3]));
  assert.deepEqual([...await ledger.read()], [1, 2, 3]);
  assert.deepEqual([...await new FileLedger(file).read()], [1, 2, 3], 'a new ledger instance reads the durable envelope');
  const envelope = JSON.parse(await readFile(file, 'utf8'));
  envelope.bytes = '010204';
  await writeFile(file, JSON.stringify(envelope));
  await assert.rejects(ledger.read(), /checksum/);
  await writeFile(file, JSON.stringify({ format: 'GhostFlow/ledger-file-v1', sha256: '0'.repeat(64), bytes: '01zz' }));
  await assert.rejects(ledger.read(), /invalid ledger envelope/);
  await writeFile(file, Buffer.alloc(200_000));
  await assert.rejects(ledger.read(), /envelope exceeds bound/);
  assert.throws(() => new FileLedger('relative.ledger'), /absolute/);
  await assert.rejects(ledger.persist(new Uint8Array(65537)), /oversized/);
});

test('one normalized path has one in-process writer across ledger instances', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ghostflow-ledger-lock-test-'));
  const file = path.join(dir, 'station.ledger');
  const first = new FileLedger(path.join(dir, 'nested', '..', 'station.ledger'));
  const second = new FileLedger(file);

  // persist() owns the normalized path before its first await. The second call
  // therefore rejects promptly instead of racing a temporary-file rename.
  const pending = first.persist(new Uint8Array([1, 2, 3]));
  await assert.rejects(second.persist(new Uint8Array([4, 5, 6])), /ledger writer is busy/);
  await pending;
  await second.persist(new Uint8Array([4, 5, 6]));
  assert.deepEqual([...await first.read()], [4, 5, 6]);
});

test('persist snapshots caller bytes before awaiting and filename is immutable', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ghostflow-ledger-copy-test-'));
  const file = path.join(dir, 'station.ledger');
  const ledger = new FileLedger(file);
  const supplied = new Uint8Array([1, 2, 3]);
  const pending = ledger.persist(supplied);
  supplied.fill(9);
  await pending;
  assert.deepEqual([...await ledger.read()], [1, 2, 3]);
  assert.throws(() => { ledger.filename = path.join(dir, 'other.ledger'); }, TypeError);
  assert.equal(ledger.filename, file);
});
