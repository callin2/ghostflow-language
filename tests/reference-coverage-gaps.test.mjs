import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileControl, compileTemporalDescriptorArtifact, typeCheckControl } from '../tools/control.mjs';
import { extractLiterate } from '../tools/literate.mjs';

test('Reference coverage exercises valid enum lowering and Tide schedule binding', () => {
  const enumChecked = compileControl(`control EnumCoverage {
    type Mode = Idle | Run;
    state mode: Mode = Idle;
    output active: Bool;
    active <- mode == Run;
  }`, { filename: 'enum-coverage.ghost' });
  assert.ok(enumChecked.bytes.length > 0);

  const code = `control TideCoverage {
    input stop, unsafe_level: Bool;
    provider harbor_tides: TidePredictions;
    schedule high: Tide {
      source = harbor_tides;
      timezone = "Asia/Seoul";
      at = tide\`high - 30min\`;
      basis = pulse;
      when = true;
      cancel_when = (case stop { ok(value) => value; fault(_) => true; }) || (case unsafe_level { ok(value) => value; fault(_) => true; });
      clock = trusted_only;
      gap = skip_after(60s);
      recovery = baseline;
      fallback = skip;
    }
    output active: Bool;
    active <- high.active;
  }`;
  const checked = typeCheckControl(code, { filename: 'tide-schedule.ghost' });
  assert.equal(checked.manifest.schedules[0].kind, 'tide');
});

test('Reference after_event coverage lowers explicit projections through the direct API', () => {
  const source = fs.readFileSync(new URL('./fixtures/after-event-evidence.input-v1.ghost.md', import.meta.url), 'utf8');
  const code = extractLiterate(source, { filename: 'after-event-evidence.input-v1.ghost.md' }).code;
  const artifact = compileTemporalDescriptorArtifact(code, { filename: 'after-event-evidence.input-v1.ghost.md' });
  assert.match(artifact.manifest.format, /^GhostFlow\/control-v[1-6]$/);
  assert.deepEqual(artifact.manifest.signals[0].projections, ['any']);
});
