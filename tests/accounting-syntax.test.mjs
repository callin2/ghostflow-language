import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileControl, typeCheckControl } from '../tools/control.mjs';
import { compileSource, verifyArtifactSourceMap } from '../tools/toolchain.mjs';
import { sha256Hex } from '../tools/sha256.mjs';

const source = `control AccountingSyntax {
  resource pump1: BoolActuator;
  event normal_run_started: Event;
  config worst_case_on: Duration = 5min;
  config stop_delay: Duration = 10s;
  account pump_applied = on_time(pump1, stage: applied, persistence: durable);
  account normal_starts = count_events(normal_run_started, over: local_day("Asia/Seoul"), persistence: durable);
  constraints PumpBudgets {
    limit used(pump_applied, rolling(60s)) <= 30s {
      reserve = worst_case_on + stop_delay;
      on_unknown = block;
    }
  }
  output ready: Bool;
  ready <- case normal_starts.count {
    ok(count) => count >= 0;
    fault(_) => false;
  };
}`;

test('accounting syntax is represented in the checked manifest', () => {
  const { manifest } = typeCheckControl(source);
  assert.deepEqual(manifest.resources, [{ name: 'pump1', type: 'BoolActuator' }]);
  assert.equal(manifest.accounts[0].stage, 'applied');
  assert.equal(manifest.accounts[1].operation, 'count_events');
  assert.deepEqual(manifest.accountingConstraints[0].limits[0], {
    account: 'pump_applied', operator: '<=', basis: 'rolling', persistence: 'durable', onUnknown: 'block',
  });
});

test('accounting execution remains fail closed without runtime ledger bindings', () => {
  assert.throws(() => compileControl(source), /accounting execution requires verified resource binding/);
});

test('public toolchain emits a checked non-executable accounting artifact', async () => {
  const document = '# Accounting syntax\n\n```ghost\n' + source + '\n```\n';
  const artifact = await compileSource(document, { filename: 'accounting.ghost.md' });
  const envelope = JSON.parse(new TextDecoder().decode(artifact.bytes));
  assert.equal(envelope.format, 'GhostFlow/accounting-artifact-v1');
  assert.equal(envelope.executable, false);
  assert.equal(artifact.manifest.format, 'GhostFlow/accounting-v1');
  assert.equal(artifact.manifest.control.accounts.length, 2);
  assert.equal(artifact.manifest.sourceDocumentSha256, artifact.sourceDocument.sha256);
  assert.equal(artifact.manifest.bytecodeSha256, sha256Hex(artifact.bytes));
  const sourceMap = {
    format: 'GhostFlow/source-map-v1', bytecodeSha256: artifact.manifest.bytecodeSha256,
    sourceDocument: artifact.sourceDocument, nodes: artifact.sourceMap,
    lines: artifact.extractionMap, traceMetadata: null,
    interactionSchema: null, interactionSourceIdentity: null,
  };
  verifyArtifactSourceMap(sourceMap, artifact.bytes, { manifest: artifact.manifest });
  assert.throws(() => verifyArtifactSourceMap(sourceMap, artifact.bytes, {
    manifest: { ...artifact.manifest, control: { ...artifact.manifest.control, accounts: [] } },
  }), /accounting descriptor manifest does not match canonical source/);
});

test('accounting declarations reject missing stage, persistence, and targets', () => {
  assert.throws(() => typeCheckControl('control X { resource p: BoolActuator; account a = on_time(p); output x: Bool; x <- true; }'), /stage/);
  assert.throws(() => typeCheckControl('control X { resource p: BoolActuator; account a = on_time(p, stage: applied); output x: Bool; x <- true; }'), /persistence/);
  assert.throws(() => typeCheckControl('control X { account a = on_time(missing, stage: applied, persistence: durable); output x: Bool; x <- true; }'), /unknown resource/);
});

test('event counts return Result and cannot be used as numbers directly', () => {
  const source = `control DirectEventCountUse {
    event started: Event;
    account starts = count_events(started, over: local_day("UTC"), persistence: durable);
    output count: Bool;
    count <- starts.count >= 0;
  }`;
  assert.throws(() => typeCheckControl(source), /Result<Int,AccountingFault>|expected Int|numeric/);
});

test('pure functions cannot capture an accounting event count', () => {
  const source = `control PureAccountingCapture {
    event started: Event;
    account starts = count_events(started, over: local_day("UTC"), persistence: durable);
    fn captured() -> Result<Int,AccountingFault> { starts.count }
    output count: Int;
    count <- captured();
  }`;
  assert.throws(() => typeCheckControl(source), /fn captured cannot capture global starts/);
});

test('syntax macros cannot capture an accounting event count', () => {
  const source = `syntax captured(): Expr<Result<Int,AccountingFault>> { quote { starts.count } }
  control MacroAccountingCapture {
    event started: Event;
    account starts = count_events(started, over: local_day("UTC"), persistence: durable);
    output count: Int;
    count <- @captured();
  }`;
  assert.throws(() => typeCheckControl(source), /syntax macro captured cannot capture global starts/);
});
