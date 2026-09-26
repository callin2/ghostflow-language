import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compileControl, ControlCompileError } from '../tools/control.mjs';

const hold = `syntax hold(start: Expr<Bool>, stop: Expr<Bool>, held: Expr<Bool>): Expr<Bool> {
  quote { !$(stop) && ($(start) || $(held)) }
}`;

test('typed expression macro expands through the public compiler', () => {
  const compiled = compileControl(`${hold}
control Latch {
  input start, stop: Bool;
  state running: Bool = false;
  output pump: Bool;
  running' = @hold(start, stop, running);
  pump <- running';
}`);
  assert.ok(compiled.bytes.length > 0);
  assert.equal(compiled.manifest.name, 'Latch');
});

test('typed expression macro rejects an argument with the wrong value type', () => {
  assert.throws(() => compileControl(`${hold}
control Latch {
  input stop: Bool;
  state running: Bool = false;
  output pump: Bool;
  running' = @hold(5min, stop, running);
  pump <- running';
}`), error => error instanceof ControlCompileError
    && /syntax macro hold must be Bool, got Duration/.test(error.message));
});

test('recursive expression macro expansion is rejected', () => {
  assert.throws(() => compileControl(`
syntax repeat(x: Expr<Bool>): Expr<Bool> { quote { @repeat($(x)) } }
control Recursion { output result: Bool; result <- @repeat(true); }
`), error => error instanceof ControlCompileError
    && /recursive syntax macro repeat/.test(error.message));
});

test('composition rejects two suppliers for one instance input port', () => {
  assert.throws(() => compileControl(`
import Relay from "./relay.ghost.md" revision "relay-r1" sha256 "27728be32fb620b6a136325324c5628c9b42f69b72ee0199e354486207719009";
control Farm {
  input start: Bool;
  output pump: Bool;
  instance east: Relay;
  connect east.start <- start;
  connect east.start <- start;
  connect pump <- east.pump;
}
`), error => error instanceof ControlCompileError
    && /duplicate supplier for (?:input )?port east\.start/.test(error.message));
});
