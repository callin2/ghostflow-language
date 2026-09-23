import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../tools/browser-toolchain.mjs';
import { sha256Hex } from '../tools/sha256.mjs';

test('independent output errors are collected in authored order across fences', async () => {
  const source = '```ghost\ncontrol Many {\n output a, b: Bool;\n a <- 2;\n```\n\n설명 🌱\n```ghost\n b <- 3;\n}\n```\n';
  await assert.rejects(() => compileSource(source, { filename: 'many.ghost.md' }), error => {
    assert.deepEqual(error.diagnosticEnvelope.diagnostics.map(d => [d.code, d.message, d.span.start.line]), [
      ['GF_TYPE', 'output a must be Bool', 4], ['GF_TYPE', 'output b must be Bool', 9],
    ]);
    assert.equal(error.bytes, undefined);
    return true;
  });
});

test('failed let dependencies retain the root error without cyclic cascades', async () => {
  const source = '```ghost\ncontrol Many {\n let dependent = bad;\n let independent: Bool = 2;\n let bad: Bool = 3;\n let other = dependent;\n}\n```\n';
  await assert.rejects(() => compileSource(source), error => {
    assert.deepEqual(error.diagnosticEnvelope.diagnostics.map(d => [d.message, d.span.start.line]), [
      ['let independent does not match annotation Bool', 4],
      ['let bad does not match annotation Bool', 5],
    ]);
    // Evaluation visits bad first through dependent; the exception stays intact.
    assert.match(error.message, /:5:2: let bad does not match annotation Bool$/);
    return true;
  });
});

test('independent next assignments are reported before output checking', async () => {
  const source = '```ghost\ncontrol Many {\n state a: Bool = false;\n state b: Bool = false;\n a\' = 2;\n b\' = 3;\n output pump: Bool;\n pump <- missing;\n}\n```\n';
  await assert.rejects(() => compileSource(source), error => {
    assert.deepEqual(error.diagnosticEnvelope.diagnostics.map(d => d.message), [
      'next state a must be Bool', 'next state b must be Bool',
    ]);
    return true;
  });
});

test('unrecoverable syntax stops before collecting later semantic errors', async () => {
  const source = '```ghost\ncontrol Broken {\n output a, b: Bool;\n a <- ;\n b <- 2;\n}\n```\n';
  await assert.rejects(() => compileSource(source), error => {
    assert.equal(error.diagnosticEnvelope.diagnostics.length, 1);
    assert.equal(error.diagnosticEnvelope.diagnostics[0].message, 'expected expression, found ;');
    return true;
  });
});

test('exactly twenty independent errors do not claim overflow', async () => {
  const source = '```ghost\ncontrol Many {\n'
    + Array.from({ length: 20 }, (_, i) => `let bad${i}: Bool = 2;`).join('\n') + '\n}\n```\n';
  await assert.rejects(() => compileSource(source), error => {
    assert.equal(error.diagnosticEnvelope.diagnostics.length, 20);
    assert.equal(error.diagnosticEnvelope.collection, undefined);
    return true;
  });
});

test('independent imported let errors retain the child document locations', async () => {
  const child = '# Child\n```ghost\ncontrol Child {\n let a: Bool = 2;\n let b: Bool = 3;\n output pump: Bool;\n pump <- false;\n}\n```\n';
  const source = `\`\`\`ghost\nimport Child from "./child.ghost.md" revision "r1" sha256 "${sha256Hex(child)}";\ncontrol Farm { output pump: Bool; instance east: Child; connect pump <- east.pump; }\n\`\`\`\n`;
  await assert.rejects(() => compileSource(source, {
    filename: 'farm.ghost.md',
    sourceClosure: [{ filename: 'child.ghost.md', revision: 'r1', text: child }],
  }), error => {
    const envelope = error.diagnosticEnvelope;
    assert.deepEqual(envelope.diagnostics.map(d => [d.span.file, d.span.start.line]), [
      ['child.ghost.md', 4], ['child.ghost.md', 5],
    ]);
    assert.equal(envelope.source.sha256, sha256Hex(child));
    assert.equal(envelope.requestSource.sha256, sha256Hex(source));
    return true;
  });
});

test('parser failure exposes a versioned diagnostic at the original document token', async () => {
  const source = '# 설명 🌱\n\n```ghost\ncontrol Broken {\n  output pump: Bool;\n  pump <- ;\n}\n```\n';
  await assert.rejects(() => compileSource(source, { filename: 'broken.ghost.md' }), error => {
    assert.deepEqual(error.diagnosticEnvelope, {
      format: 'GhostFlow/diagnostics-v1',
      source: { filename: 'broken.ghost.md', sha256: sha256Hex(source) },
      diagnostics: [{
        code: 'GF_PARSE', severity: 'error', message: 'expected expression, found ;',
        span: { file: 'broken.ghost.md', start: { line: 6, column: 11 }, end: { line: 6, column: 12 } },
      }],
    });
    assert.match(error.message, /^broken\.ghost\.md:6:11: expected expression, found ;$/);
    return true;
  });
});

test('output type failure has a type code and the authored statement span', async () => {
  const source = '```ghost\ncontrol Mismatch {\n  output pump: Bool;\n  pump <- 2;\n}\n```\n';
  await assert.rejects(() => compileSource(source, { filename: 'type.ghost.md' }), error => {
    assert.equal(error.diagnosticEnvelope.diagnostics[0].code, 'GF_TYPE');
    assert.deepEqual(error.diagnosticEnvelope.diagnostics[0].span, {
      file: 'type.ghost.md', start: { line: 4, column: 3 }, end: { line: 4, column: 7 },
    });
    assert.equal(error.diagnosticEnvelope.diagnostics[0].message, 'output pump must be Bool');
    return true;
  });
});

test('missing import identifies the root import token and pinned source revision', async () => {
  const source = `# farm\n\n\`\`\`ghost\nimport Relay from "./relay.ghost.md" revision "r1" sha256 "${'0'.repeat(64)}";\ncontrol Farm { output pump: Bool; pump <- false; }\n\`\`\`\n`;
  await assert.rejects(() => compileSource(source, {
    filename: 'farm.ghost.md', sourceClosure: [],
    interactionSourceIdentity: { documentId: 'farm', revisionId: 'rev-1' },
  }), error => {
    const envelope = error.diagnosticEnvelope;
    assert.equal(envelope.format, 'GhostFlow/diagnostics-v1');
    assert.deepEqual(envelope.source, { filename: 'farm.ghost.md', sha256: sha256Hex(source), documentId: 'farm', revisionId: 'rev-1' });
    assert.equal(envelope.diagnostics[0].code, 'GF_IMPORT');
    assert.deepEqual(envelope.diagnostics[0].span.start, { line: 4, column: 19 });
    assert.match(envelope.diagnostics[0].message, /missing imported document/);
    return true;
  });
});

test('literate fence failure carries original position without an invented end or hint', async () => {
  const source = '# 설명 🌱\n\n```ghost title=bad\ncontrol Farm {}\n```\n';
  await assert.rejects(() => compileSource(source, { filename: 'fence.ghost.md' }), error => {
    assert.equal(error.diagnosticEnvelope.diagnostics[0].code, 'GF_LITERATE');
    assert.deepEqual(error.diagnosticEnvelope.diagnostics[0].span, {
      file: 'fence.ghost.md', start: { line: 3, column: 1 },
    });
    assert.equal(error.diagnosticEnvelope.diagnostics[0].hint, undefined);
    assert.equal(error.diagnosticEnvelope.diagnostics[0].reference, undefined);
    return true;
  });
});

test('second fence and Unicode prose preserve the exact authored location', async () => {
  const source = '# 배관 🌱\n\n```ghost\ncontrol Farm {\n  output pump: Bool;\n```\n\n중간 설명 🌱\n\n```ghost\n  pump <- missing;\n}\n```\n';
  await assert.rejects(() => compileSource(source, { filename: 'multi.ghost.md' }), error => {
    assert.equal(error.diagnosticEnvelope.diagnostics[0].code, 'GF_SEMANTIC');
    assert.deepEqual(error.diagnosticEnvelope.diagnostics[0].span, {
      file: 'multi.ghost.md', start: { line: 11, column: 11 }, end: { line: 11, column: 18 },
    });
    return true;
  });
});

test('imported parser failure identifies the imported document and its own source hash', async () => {
  const child = '# 릴레이 🌱\n\n```ghost\ncontrol Relay {\n  output pump: Bool;\n  pump <- ;\n}\n```\n';
  const source = `\`\`\`ghost\nimport Relay from "./relay.ghost.md" revision "r1" sha256 "${sha256Hex(child)}";\ncontrol Farm { output pump: Bool; instance east: Relay; connect pump <- east.pump; }\n\`\`\`\n`;
  await assert.rejects(() => compileSource(source, {
    filename: 'farm.ghost.md',
    sourceClosure: [{ filename: 'relay.ghost.md', revision: 'r1', text: child }],
    interactionSourceIdentity: { documentId: 'farm', revisionId: 'rev-1' },
  }), error => {
    assert.deepEqual(error.diagnosticEnvelope.source, { filename: 'relay.ghost.md', sha256: sha256Hex(child) });
    assert.deepEqual(error.diagnosticEnvelope.requestSource, {
      filename: 'farm.ghost.md', sha256: sha256Hex(source), documentId: 'farm', revisionId: 'rev-1',
    });
    assert.equal(error.diagnosticEnvelope.diagnostics[0].code, 'GF_PARSE');
    assert.deepEqual(error.diagnosticEnvelope.diagnostics[0].span.start, { line: 6, column: 11 });
    return true;
  });
});

test('imported literate failure keeps the imported fence position', async () => {
  const child = '# 릴레이\n\n```ghost title=bad\ncontrol Relay {}\n```\n';
  const source = `\`\`\`ghost\nimport Relay from "./relay.ghost.md" revision "r1" sha256 "${sha256Hex(child)}";\ncontrol Farm { output pump: Bool; instance east: Relay; connect pump <- east.pump; }\n\`\`\`\n`;
  await assert.rejects(() => compileSource(source, {
    filename: 'farm.ghost.md', sourceClosure: [{ filename: 'relay.ghost.md', revision: 'r1', text: child }],
  }), error => {
    assert.equal(error.diagnosticEnvelope.diagnostics[0].code, 'GF_LITERATE');
    assert.deepEqual(error.diagnosticEnvelope.diagnostics[0].span, {
      file: 'relay.ghost.md', start: { line: 3, column: 1 },
    });
    return true;
  });
});

test('composition port failure is semantic, not import resolution', async () => {
  const child = '```ghost\ncontrol Relay { input start: Bool; output pump: Bool; pump <- start; }\n```\n';
  const source = `\`\`\`ghost\nimport Relay from "./relay.ghost.md" revision "r1" sha256 "${sha256Hex(child)}";\ncontrol Farm { input start: Bool; instance east: Relay; connect east.pump <- start; }\n\`\`\`\n`;
  await assert.rejects(() => compileSource(source, {
    filename: 'farm.ghost.md', sourceClosure: [{ filename: 'relay.ghost.md', revision: 'r1', text: child }],
  }), error => {
    assert.equal(error.diagnosticEnvelope.diagnostics[0].code, 'GF_SEMANTIC');
    assert.match(error.diagnosticEnvelope.diagnostics[0].message, /unknown input port east.pump/);
    return true;
  });
});

test('successful compilation carries an empty diagnostic envelope with source identity', async () => {
  const source = '```ghost\ncontrol Farm { output pump: Bool; pump <- false; }\n```\n';
  const result = await compileSource(source, {
    filename: 'farm.ghost.md', interactionSourceIdentity: { documentId: 'farm', revisionId: 'rev-1' },
  });
  assert.deepEqual(result.diagnosticEnvelope, {
    format: 'GhostFlow/diagnostics-v1',
    source: { filename: 'farm.ghost.md', sha256: sha256Hex(source), documentId: 'farm', revisionId: 'rev-1' },
    diagnostics: [],
  });
  assert.equal(result.sourceDocument.text, source);
  assert.ok(result.bytes.byteLength > 0);
});
