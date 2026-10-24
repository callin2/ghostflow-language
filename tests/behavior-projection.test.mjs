import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { compileSourceSync } from '../tools/compile-source.mjs';
import { compileControl } from '../tools/control.mjs';
import { extractLiterate } from '../tools/literate.mjs';

const document = code => `# Current behavior\n\n## 현재 동작\n- 입력 품질과 조건에 따라 출력을 요청합니다.\n\n\`\`\`ghost\n${code}\n\`\`\`\n`;
const compile = code => compileSourceSync(document(code), { filename: 'behavior.ghost.md' });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

const current = `control CurrentBehavior {
  input DI1: Bool;
  input current_a: ElectricalCurrent;
  output mo1, mo2: Bool;
  mo1 <- case DI1 {
    ok(value) => if value then true else false;
    fault(reason) => false;
  };
  mo2 <- case current_a {
    ok(value) => if value >= 0.1A then true else false;
    fault(reason) => true;
  };
}`;

test('whole-document compilation returns digest-bound Result and comparison branches', () => {
  const compiled = compile(current);
  const projection = compiled.behaviorProjection;
  assert.equal(projection.format, 'GhostFlow/behavior-projection-v1');
  assert.equal(projection.status, 'available');
  assert.equal(projection.sourceSha256, compiled.sourceDocument.sha256);
  assert.equal(projection.bytecodeSha256, compiled.manifest.bytecodeSha256);
  assert.equal(projection.roots.length, 2);
  const [mo1, mo2] = projection.roots;
  assert.deepEqual(mo1.target, { kind: 'output', name: 'mo1' });
  assert.equal(mo1.expression.kind, 'result-case');
  assert.deepEqual(mo1.expression.value, {
    kind: 'read', name: 'DI1', readKind: 'input', sourceNodeId: mo1.expression.value.sourceNodeId,
  });
  assert.equal(mo1.expression.ok.body.kind, 'conditional');
  assert.equal(mo1.expression.ok.body.test.kind, 'read');
  assert.equal(mo1.expression.ok.body.whenTrue.value, 'true');
  assert.equal(mo1.expression.ok.body.whenFalse.value, 'false');
  assert.equal(mo1.expression.fault.body.value, 'false');
  assert.deepEqual(mo2.target, { kind: 'output', name: 'mo2' });
  assert.equal(mo2.expression.kind, 'result-case');
  assert.equal(mo2.expression.value.name, 'current_a');
  assert.equal(mo2.expression.ok.body.kind, 'conditional');
  assert.equal(mo2.expression.ok.body.test.kind, 'compare');
  assert.equal(mo2.expression.ok.body.test.op, '>=');
  assert.equal(mo2.expression.ok.body.test.right.value, '0.1A');
  assert.equal(mo2.expression.fault.body.value, 'true');
  assert.deepEqual(mo1.source, { filename: 'behavior.ghost.md', line: 11, column: 3 });
});

test('projection is descriptive and does not change compiled bytecode', () => {
  const source = document(current);
  const compiled = compileSourceSync(source, { filename: 'behavior.ghost.md' });
  const direct = compileControl(extractLiterate(source, { filename: 'behavior.ghost.md' }).code,
    { filename: 'behavior.ghost.md' });
  assert.equal(digest(compiled.bytes), digest(direct.bytes));
  assert.equal(compiled.behaviorProjection.bytecodeSha256, digest(direct.bytes));
});

test('nested Result cases, state transitions, and Boolean logic remain structural', () => {
  const compiled = compile(`control Nested {
    input enabled, permit: Bool;
    state active: Bool = false;
    active' = case enabled {
      ok(on) => case permit { ok(allowed) => on && allowed; fault(_) => false; };
      fault(_) => false;
    };
    output motor: Bool;
    motor <- active';
  }`);
  const [state, output] = compiled.behaviorProjection.roots;
  assert.deepEqual(state.target, { kind: 'state-next', name: 'active' });
  assert.equal(state.expression.kind, 'result-case');
  assert.equal(state.expression.ok.body.kind, 'result-case');
  assert.equal(state.expression.ok.body.ok.body.kind, 'logic');
  assert.deepEqual(output.target, { kind: 'output', name: 'motor' });
  assert.equal(output.expression.readKind, 'state-after');
});

test('unsupported expressions stay local and preserve the complete expression', () => {
  const compiled = compile(`control Unsupported {
    input request: Bool;
    output lamp: Bool;
    lamp <- request |> recover(false);
  }`);
  assert.equal(compiled.behaviorProjection.status, 'available');
  assert.deepEqual(compiled.behaviorProjection.roots[0].expression, {
    kind: 'unavailable',
    reason: 'unsupported-construct',
    expressionKind: 'binary',
    text: '(request |> recover(false))',
    sourceNodeId: compiled.behaviorProjection.roots[0].expression.sourceNodeId,
  });
});

test('adaptive strategy outputs do not appear as an empty available projection', () => {
  const compiled = compile(`control Adaptive {
    output pump: Bool;
    adapt policy {
      strategy Baseline priority 0 match always { pump <- false; }
    }
  }`);
  assert.equal(compiled.behaviorProjection.status, 'unavailable');
  assert.equal(compiled.behaviorProjection.reason, 'unsupported-construct');
  assert.deepEqual(compiled.behaviorProjection.roots, []);
});

test('derived references disclose their complete declaration expression', () => {
  const compiled = compile(`control Derived {
    input request: Bool;
    let wanted = request |> recover(false);
    output lamp: Bool;
    lamp <- wanted;
  }`);
  assert.deepEqual(compiled.behaviorProjection.roots[0].expression, {
    kind: 'unavailable',
    reason: 'unsupported-derived-reference',
    expressionKind: 'binary',
    text: '(request |> recover(false))',
    sourceNodeId: compiled.behaviorProjection.roots[0].expression.sourceNodeId,
  });
});

test('changed source receives a new identity and branch without stale projection data', () => {
  const before = compile(current);
  const after = compile(current.replace('fault(reason) => true;', 'fault(reason) => false;'));
  assert.notEqual(before.behaviorProjection.sourceSha256, after.behaviorProjection.sourceSha256);
  assert.notEqual(before.behaviorProjection.bytecodeSha256, after.behaviorProjection.bytecodeSha256);
  assert.equal(after.behaviorProjection.roots[1].expression.fault.body.value, 'false');
});

test('projection limits stay descriptive and do not block successful compilation', () => {
  let expression = 'false';
  for (let depth = 0; depth < 34; depth += 1) {
    expression = `if true then ${expression} else false`;
  }
  const compiled = compile(`control Bounded {
    output lamp: Bool;
    lamp <- ${expression};
  }`);
  assert.equal(compiled.behaviorProjection.status, 'unavailable');
  assert.equal(compiled.behaviorProjection.reason, 'projection-limit');
  assert.ok(compiled.bytes.length > 0);
});

test('non-control artifacts report projection ownership without blocking compilation', () => {
  const compiled = compileSourceSync(document(`resource pump: BoolActuator;
    resource_policy PumpPolicy for pump {
      lease = session;
      concurrency = 1;
      admission = reserve_all;
      queue = fifo(max: 8, expires_after: 10min, tie: request_id);
      preempt = never;
    }`),
  { filename: 'policy.ghost.md' });
  assert.deepEqual(compiled.behaviorProjection, {
    format: 'GhostFlow/behavior-projection-v1',
    sourceSha256: compiled.sourceDocument.sha256,
    bytecodeSha256: compiled.manifest.bytecodeSha256,
    status: 'unavailable',
    reason: 'non-control-artifact',
    roots: [],
  });
});
