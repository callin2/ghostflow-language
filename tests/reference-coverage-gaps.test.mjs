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
      cancel_when = stop || unsafe_level;
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

test('Reference coverage emits temporal descriptor artifacts through the direct API', () => {
  const source = fs.readFileSync(new URL('./fixtures/after-event-evidence.ghost.md', import.meta.url), 'utf8');
  const code = extractLiterate(source, { filename: 'after-event-evidence.ghost.md' }).code;
  const artifact = compileTemporalDescriptorArtifact(code, { filename: 'after-event-evidence.ghost.md' });
  assert.equal(artifact.manifest.format, 'GhostFlow/temporal-descriptor-v1');
});
