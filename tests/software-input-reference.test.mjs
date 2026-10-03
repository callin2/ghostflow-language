import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  jsonSha256,
  sha256,
  validateIntegration,
  validateReleaseIdentity,
  validateRunEvidence,
} from '../tools/integration-contract.mjs';

const example = JSON.parse(readFileSync(new URL('../contracts/integration-v1/examples/fictional-fixture.json', import.meta.url), 'utf8'));
const referenceCases = JSON.parse(readFileSync(new URL('./reference/cases/03-settings-boundaries.json', import.meta.url), 'utf8'));

const REF_06_004_GIVEN = 'Bool logical port와 같은 의미 계약을 제공하는 software input이 있다.';
const REF_06_004_WHEN = 'installation contract를 검증한다.';
const REF_06_004_THEN = '물리 DI가 아니라는 이유만으로 거부하지 않고 동일 direction·semantic type 계약으로 판단한다.';

function fixture() {
  const { release, boardProfile, installation, artifacts, runEvidence } = structuredClone(example);
  return {
    release,
    boardProfile,
    installation,
    artifacts: {
      source: artifacts.source,
      module: Buffer.from(artifacts.moduleHex, 'hex'),
      manifest: artifacts.manifest,
    },
    runEvidence,
  };
}

function absentGate(status = 'not_run') {
  return { status, source: { type: 'none', reference: null }, scope: 'No evidence collected by this reference fixture.' };
}

function pinProfile(f) {
  const profileSha256 = jsonSha256(f.boardProfile);
  f.release.device.boardProfile.sha256 = profileSha256;
  f.installation.boardProfile.sha256 = profileSha256;
  f.runEvidence.device.boardProfile.sha256 = profileSha256;
}

function pinInstallation(f) {
  const installationSha256 = jsonSha256(f.installation);
  f.release.installation.sha256 = installationSha256;
  f.runEvidence.device.installation = structuredClone(f.release.installation);
}

function pinRelease(f) {
  f.runEvidence.releaseSha256 = jsonSha256(f.release);
}

function pinAll(f) {
  pinProfile(f);
  pinInstallation(f);
  pinRelease(f);
}

function makeSoftwareInputFixture() {
  const f = fixture();
  delete f.boardProfile.endpoints['input.1'];
  f.boardProfile.endpoints['command.start'] = {
    direction: 'input',
    type: 'Bool',
    driver: 'software-input',
    address: 'commands/start',
    activeLevel: 'high',
    safeLevel: 0,
  };
  f.installation.bindings.start = 'command.start';
  f.runEvidence.gates.hardware = absentGate('unknown');
  f.runEvidence.gates.physical = absentGate('not_run');
  pinAll(f);
  return f;
}

function completeResults(f) {
  return {
    release: validateReleaseIdentity(f.release, f),
    run: validateRunEvidence(f.runEvidence, f),
    integration: validateIntegration(f),
  };
}

function assertCompletePass(results) {
  assert.deepEqual(results, {
    release: { valid: true, errors: [] },
    run: { valid: true, errors: [] },
    integration: { valid: true, errors: [] },
  });
}

function assertCompleteRepeatAndImmutable(makeCase, assertResults) {
  const first = makeCase();
  const before = structuredClone(first);
  const firstResults = completeResults(first);
  assertResults(firstResults);
  assert.deepEqual(structuredClone(first), before, 'validation must not mutate the first fixture');

  const second = makeCase();
  const secondBefore = structuredClone(second);
  const secondResults = completeResults(second);
  assert.deepEqual(secondResults, firstResults, 'fresh fixtures must validate deterministically');
  assert.deepEqual(structuredClone(second), secondBefore, 'validation must not mutate the second fixture');
}

function assertIntegrationCodes(results, codes) {
  assert.equal(results.release.valid, true, JSON.stringify(results.release.errors));
  assert.equal(results.run.valid, true, JSON.stringify(results.run.errors));
  assert.equal(results.integration.valid, false, 'integration must reject the invalid binding contract');
  assert.deepEqual(results.integration.errors.map(error => error.code), codes);
  for (const error of results.integration.errors) {
    assert.equal(typeof error.path, 'string');
    assert.equal(typeof error.message, 'string');
    assert.ok(error.path.length > 0);
    assert.ok(error.message.length > 0);
  }
}

test('REF-06-004 acceptance text remains the original Given/When/Then', () => {
  const ref = referenceCases.cases.find(entry => entry.id === 'REF-06-004');
  assert.equal(ref.given, REF_06_004_GIVEN);
  assert.equal(ref.when, REF_06_004_WHEN);
  assert.equal(ref.then, REF_06_004_THEN);
  assert.equal(ref.status, 'specified');
});

test('REF-06-004 accepts an explicit software Bool input with the same logical direction and semantic type', () => {
  assertCompleteRepeatAndImmutable(makeSoftwareInputFixture, results => {
    assertCompletePass(results);
  });

  const f = makeSoftwareInputFixture();
  assert.equal(f.installation.bindings.start, 'command.start');
  assert.equal(f.boardProfile.endpoints['command.start'].driver, 'software-input');
  assert.equal(f.boardProfile.endpoints['command.start'].direction, 'input');
  assert.equal(f.boardProfile.endpoints['command.start'].type, 'Bool');
  assert.equal(f.runEvidence.gates.hardware.status, 'unknown');
  assert.equal(f.runEvidence.gates.physical.status, 'not_run');
});

test('REF-06-004 rejects software input direction and semantic type mismatches with complete errors', () => {
  assertCompleteRepeatAndImmutable(() => {
    const f = makeSoftwareInputFixture();
    f.boardProfile.endpoints['command.start'].direction = 'output';
    pinAll(f);
    return f;
  }, results => {
    assertIntegrationCodes(results, ['direction_mismatch']);
    assert.deepEqual(results.integration.errors, [{
      path: 'artifacts.manifest.inputs[0]',
      code: 'direction_mismatch',
      message: 'does not match the pinned identity',
    }]);
  });

  assertCompleteRepeatAndImmutable(() => {
    const f = makeSoftwareInputFixture();
    f.boardProfile.endpoints['command.start'].type = 'Number';
    pinAll(f);
    return f;
  }, results => {
    assertIntegrationCodes(results, ['type_mismatch']);
    assert.deepEqual(results.integration.errors, [{
      path: 'artifacts.manifest.inputs[0]',
      code: 'type_mismatch',
      message: 'does not match the pinned identity',
    }]);
  });
});

test('REF-06-004 rejects missing or incorrect explicit software input bindings', () => {
  assertCompleteRepeatAndImmutable(() => {
    const f = makeSoftwareInputFixture();
    delete f.installation.bindings.start;
    pinInstallation(f);
    pinRelease(f);
    return f;
  }, results => {
    assertIntegrationCodes(results, ['missing_binding']);
    assert.deepEqual(results.integration.errors, [{
      path: 'artifacts.manifest.inputs[0].name',
      code: 'missing_binding',
      message: 'logical name has no explicit installation binding',
    }]);
  });

  assertCompleteRepeatAndImmutable(() => {
    const f = makeSoftwareInputFixture();
    f.installation.bindings.start = 'command.other';
    pinInstallation(f);
    pinRelease(f);
    return f;
  }, results => {
    const expected = [{
      path: 'installation.bindings.start',
      code: 'unknown_endpoint',
      message: 'binding must name an explicit endpoint in the pinned board profile',
    }];
    assert.equal(results.release.valid, false);
    assert.equal(results.run.valid, true, JSON.stringify(results.run.errors));
    assert.equal(results.integration.valid, false);
    assert.deepEqual(results.release.errors, expected);
    assert.deepEqual(results.integration.errors, expected);
  });
});

test('REF-06-004 rejects hash and identity mismatches instead of relabeling software input source', () => {
  assertCompleteRepeatAndImmutable(() => {
    const f = makeSoftwareInputFixture();
    f.runEvidence.artifacts.sourceSha256 = 'a'.repeat(64);
    return f;
  }, results => {
    assert.equal(results.release.valid, true, JSON.stringify(results.release.errors));
    assert.equal(results.run.valid, false);
    assert.equal(results.integration.valid, false);
    assert.deepEqual(results.run.errors, [{
      path: 'run.artifacts.sourceSha256',
      code: 'artifact_mismatch',
      message: 'does not match the pinned identity',
    }]);
    assert.deepEqual(results.integration.errors, results.run.errors);
  });

  assertCompleteRepeatAndImmutable(() => {
    const f = makeSoftwareInputFixture();
    f.release.installation.sha256 = 'b'.repeat(64);
    pinRelease(f);
    return f;
  }, results => {
    assert.equal(results.release.valid, false);
    assert.equal(results.run.valid, false);
    assert.equal(results.integration.valid, false);
    assert.deepEqual(results.release.errors, [{
      path: 'release.installation.sha256',
      code: 'mapping_mismatch',
      message: 'does not match the pinned identity',
    }]);
    assert.deepEqual(results.integration.errors, results.release.errors);
    assert.deepEqual(results.run.errors, [{
      path: 'run.device.installation.sha256',
      code: 'mapping_mismatch',
      message: 'does not match the pinned identity',
    }]);
  });
});

test('REF-06-004 fixture source, artifact manifest and identities are hash-consistent exact bytes', () => {
  const f = makeSoftwareInputFixture();
  const expectedArtifactDigests = {
    sourceSha256: sha256(f.artifacts.source),
    moduleSha256: sha256(f.artifacts.module),
    manifestSha256: jsonSha256(f.artifacts.manifest),
  };
  assert.deepEqual(f.runEvidence.artifacts, expectedArtifactDigests);
  assert.equal(f.artifacts.manifest.bytecodeSha256, expectedArtifactDigests.moduleSha256);
  assert.equal(f.release.device.boardProfile.sha256, jsonSha256(f.boardProfile));
  assert.equal(f.installation.boardProfile.sha256, jsonSha256(f.boardProfile));
  assert.equal(f.release.installation.sha256, jsonSha256(f.installation));
  assert.equal(f.runEvidence.releaseSha256, jsonSha256(f.release));
  assertCompletePass(completeResults(f));
});

test('REF-06-004 software compatibility does not become hardware or physical proof', () => {
  const f = makeSoftwareInputFixture();
  assert.equal(validateIntegration(f).valid, true);
  assert.deepEqual(f.runEvidence.gates.hardware, absentGate('unknown'));
  assert.deepEqual(f.runEvidence.gates.physical, absentGate('not_run'));

  f.runEvidence.gates.physical = {
    status: 'pass',
    source: { type: 'host-tests', reference: 'fixture://software-input-host' },
    scope: 'Software input compatibility only; not a physical observation.',
  };
  const result = validateIntegration(f);
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, [{
    path: 'run.gates.physical.source.type',
    code: 'evidence_source',
    message: 'evidence source cannot support this gate',
  }]);
});
