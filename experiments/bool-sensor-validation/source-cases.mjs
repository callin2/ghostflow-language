export const document = code => `# Sensor source case\n\n\`\`\`ghost\n${code}\n\`\`\`\n`;
const program = 'control Sensor { input di: Bool; output out: Bool; out <- di |> recover(false); }';
const anchor = '<!-- ghostflow:anchor id=GF-SENSOR kind=intent status=confirmed origin=user -->';
const quote = '> Read the healthy value and request false for a fault.';
const annotated = `${anchor}\n${quote}\n\n${document(program)}`;

export const sourceAdmissionCases = [
  ['unannotated', document(program), true],
  ['canonical-anchor', annotated, true],
  ['unicode-quote', annotated.replace(quote, '> 입력이 정상일 때 값을 사용합니다.'), true],
  ['unknown-anchor-field', annotated.replace('kind=intent', 'type=intent'), false],
  ['anchor-field-order', annotated.replace('kind=intent status=confirmed', 'status=confirmed kind=intent'), false],
  ['anchor-kind-enum', annotated.replace('kind=intent', 'kind=anything'), false],
  ['anchor-status-enum', annotated.replace('status=confirmed', 'status=anything'), false],
  ['anchor-origin-enum', annotated.replace('origin=user', 'origin=anything'), false],
  ['anchor-empty-id', annotated.replace('id=GF-SENSOR', 'id='), false],
  ['anchor-id-initial', annotated.replace('id=GF-SENSOR', 'id=0sensor'), false],
  ['anchor-id-too-long', annotated.replace('id=GF-SENSOR', `id=${'A'.repeat(129)}`), false],
  ['anchor-id-character', annotated.replace('id=GF-SENSOR', 'id=A/B'), false],
  ['anchor-unclosed', annotated.replace(' -->', ''), false],
  ['anchor-multiline', annotated.replace(' kind=', '\nkind='), false],
  ['anchor-inline-html', annotated.replace(quote, '> <div>text</div>'), false],
  ['anchor-indented', annotated.replace('<!--', ' <!--'), false],
  ['anchor-duplicate', `${anchor}\n${quote}\n\n${annotated}`, false],
  ['quote-missing', annotated.replace(`${quote}\n`, ''), false],
  ['quote-empty', annotated.replace(quote, '> '), false],
  ['quote-nested', annotated.replace(quote, '> > nested'), false],
  ['quote-fence', annotated.replace(quote, '> ```ghost'), false],
  ['quote-continuation', annotated.replace(quote, `${quote}\n> continued`), false],
  ['quote-without-blank', annotated.replace(`${quote}\n\n`, `${quote}\n`), false],
  ['quote-without-anchor', `${quote}\n\n${document(program)}`, false],
  ['html-wrapper', `<div>\n${document(program)}</div>`, false],
  ['html-comment-wrapper', `<!--\n${document(program)}-->`, false],
  ['outer-fence', `\`\`\`\`text\n${document(program)}\`\`\`\`\n`, false],
  ['indented-fence', document(program).replaceAll('```', '    ```'), false],
  ['quoted-fence', document(program).split('\n').map(line => `> ${line}`).join('\n'), false],
  ['additional-fence', document(program) + document(program), false],
  ['frontmatter', `---\n${document(program)}---\n`, false],
  ['fallback-true', document(program.replace('recover(false)', 'recover(true)')), false],
  ['wrong-input-reference', document(program.replace('<- di', '<- other')), false],
  ['wrong-output-reference', document(program.replace('out <-', 'other <-')), false],
  ['reordered-declarations', document(program.replace('input di: Bool; output out: Bool;', 'output out: Bool; input di: Bool;')), false],
  ['extra-declaration', document(program.replace('input di:', 'input extra: Bool; input di:')), false],
  ['extra-expression', document(program.replace('recover(false)', 'recover(false) || true')), false],
  ['extra-program', document(program + ' control Extra {}'), false],
  ['optional-input', document(program.replace('input di:', 'input di?:')), false],
  ['input-options', document(program.replace('input di: Bool;', 'input di: Bool { stale_after = 1s; }')), false],
  ['input-default', document(program.replace('input di: Bool;', 'input di: Bool = false;')), false],
  ['output-default', document(program.replace('output out: Bool;', 'output out: Bool = false;')), false],
  ['reserved-internal-name', document(program.replaceAll('di', '__gf_di')), false],
  ['lifecycle-reason', document(program.replaceAll('di', 'restart_reason')), false],
  ['lifecycle-event', document(program.replaceAll('di', 'restart_event')), false],
  ['name-collision', document(program.replace('output out:', 'output di:').replace('out <-', 'di <-')), false],
  ['crlf', document(program).replaceAll('\n', '\r\n'), false],
  ['malformed-utf8', [0xc0, 0xaf, 10, ...Buffer.from(document(program))], false],
  ['surrogate-utf8', [0xed, 0xa0, 0x80, 10, ...Buffer.from(document(program))], false],
  ['confusable-name', document(program.replaceAll('di', 'dі')), false],
];

export const sourceOnlyMutations = [
  ['fallback', s => s.replace('recover(false)', 'recover(true)')],
  ['input-reference', s => s.replace('<- di', '<- other')],
  ['output-reference', s => s.replace('output_bit <-', 'other <-')],
  ['declaration-order', s => s.replace('input di: Bool;\n  output output_bit: Bool;', 'output output_bit: Bool;\n  input di: Bool;')],
  ['extra-declaration', s => s.replace('input di: Bool;', 'input extra: Bool;\n  input di: Bool;')],
  ['trailing-program', s => s.replace('\n```\n', '\ncontrol Extra {}\n```\n')],
];

export const sourceVariants = [
  ['renamed-module', s => s.replace('BoolSensorRecover', 'RenamedSensor')],
  ['renamed-sensor', s => s.replace('input di:', 'input renamed_di:').replace('<- di', '<- renamed_di')],
  ['renamed-output', s => s.replaceAll('output_bit', 'renamed_output')],
  ['trivia', s => s.replace('  input di:', '\t// ordinary comment\n\tinput\tdi:').replace('recover(false)', 'recover ( false )')],
];

export const parserBoundaryCases = `
open BoolTranslation BoolTranslation.SensorSourceReader
set_option maxRecDepth 8192
set_option maxHeartbeats 4000000
example : SourceReader.lex 8 [124, 62] = some ["|>"] := by decide
example : SourceReader.lex 0 [124, 62] = none := by decide
example : anchorId (List.replicate 128 65) = true := by decide
example : anchorId (List.replicate 129 65) = false := by decide
example : (fresh ⟨[], 1⟩).map (·.1) = some 1 := by decide
example : (fresh ⟨[], 4⟩).map (fun result => result.2.nextNode) = some 5 := by decide
`;
