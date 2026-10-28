const document = code => `# Source reader case\n\n\`\`\`ghost\n${code}\n\`\`\`\n`;
const minimal = 'control Empty {}';

export const sourceAdmissionCases = [
  ['empty-module', document(minimal), true],
  ['unicode-prose', `# 한글 설명\n\n설비의 상태를 설명합니다.\n\n${document(minimal)}`, true],
  ['comments', document('control Comment { // state fake: Int = 8;\n output ok: Bool; ok <- true; }'), true],
  ['forward-states', document("control Forward { b' = a; state b: Bool = false; state a: Bool = true; }"), true],
  ['nested-if', document('control Nested { output ok: Bool; ok <- if true then if false then true else false else true; }'), true],
  ['frontmatter', `---\nname: unsafe\n---\n${document(minimal)}`, false],
  ['html-comment', `<!--\n${document(minimal)}-->\n`, false],
  ['html-script', `<script>\n${document(minimal)}</script>\n`, false],
  ['html-div', `<div>\n${document(minimal)}</div>\n`, false],
  ['outer-fence', `\`\`\`\`text\n${document(minimal)}\`\`\`\`\n`, false],
  ['longer-open-fence', document(minimal).replace('```ghost', '````ghost'), false],
  ['longer-close-fence', document(minimal).replace('\n```\n', '\n````\n'), false],
  ['alternate-fence', document(minimal).replaceAll('```', '~~~'), false],
  ['additional-fence', document(minimal) + document(minimal), false],
  ['list-container', `- Item\n${document(minimal)}`, false],
  ['blockquote-container', document(minimal).split('\n').map(line => `> ${line}`).join('\n'), false],
  ['indented-fence', document(minimal).replaceAll('```', '    ```'), false],
  ['open-fence-suffix', document(minimal).replace('```ghost', '```ghost extra'), false],
  ['missing-close', document(minimal).replace('\n```\n', '\n'), false],
  ['crlf', document(minimal).replaceAll('\n', '\r\n'), false],
  ['trailing-program', document(`${minimal} control Other {}`), false],
  ['trailing-tokens', document(`${minimal} junk`), false],
  ['import', document('import "x"; control Empty {}'), false],
  ['config', document('control Config { config setting: Bool = false; }'), false],
  ['input', document('control Input { input sensor: Bool; }'), false],
  ['constraint', document('control Constraint { constraint true; }'), false],
  ['numeric', document('control Numeric { state count: Int = 0; }'), false],
  ['candidate-in-transition', document("control Candidate { state a: Bool = true; a' = a'; }"), false],
  ['undeclared-read', document('control Read { output ok: Bool; ok <- missing; }'), false],
  ['undeclared-target', document("control Target { absent' = true; }"), false],
  ['missing-output-connection', document('control Missing { output ok: Bool; }'), false],
  ['duplicate-state', document('control Duplicate { state a: Bool = true; state a: Bool = false; }'), false],
  ['duplicate-transition', document("control Duplicate { state a: Bool = true; a' = false; a' = true; }"), false],
  ['duplicate-connection', document('control Duplicate { output ok: Bool; ok <- true; ok <- false; }'), false],
  ['name-collision', document('control Collision { state ok: Bool = true; output ok: Bool; ok <- true; }'), false],
  ['keyword-prefix', document('controlPrefix Empty {}'), false],
  ['reserved-internal-name', document('control Internal { state __gf_hidden: Bool = true; }'), false],
  ['literal-prefix', document('control Prefix { output ok: Bool; ok <- trueSuffix; }'), false],
  ['confusable-identifier', document('control Confusable { state flаg: Bool = true; }'), false],
  ['malformed-utf8', [0xC0, 0xAF, 10, ...Buffer.from(document(minimal))], false],
  ['surrogate-utf8', [0xED, 0xA0, 0x80, 10, ...Buffer.from(document(minimal))], false],
  ['out-of-range-utf8', [0xF4, 0x90, 0x80, 0x80, 10, ...Buffer.from(document(minimal))], false],
  ['truncated-utf8', [...Buffer.from(document(minimal)), 0xE2, 0x82], false],
];

export const sourceBoundaryCases = `
open BoolTranslation.SourceReader
example : lex 0 [65] = none := by decide
example : expression 0 0 ["true"] = none := by decide
example : program 0 ["control", "A", "{", "}"] = none := by rfl
example : validUTF8 [240, 159, 140, 177] = true := by decide
example : validUTF8 [224, 128, 128] = false := by decide
example : validUTF8 [128] = false := by decide
example : expression 64 0 ["true", "||", "false", "&&", "false", ";"] =
    some (.or (.literal true) (.and (.literal false) (.literal false)), [";"]) := by decide
example : expression 64 0 ["(", "true", "||", "false", ")", "&&", "false", ";"] =
    some (.and (.grouped (.or (.literal true) (.literal false))) (.literal false), [";"]) := by decide
`;

export const sourceStaleMutations = [
  ['initializer', s => s.replace('state left: Bool = true;', 'state left: Bool = false;')],
  ['candidate-read', s => s.replace("candidate <- left';", 'candidate <- left;')],
  ['grouping', s => s.replace("if !left then right' || retained else left' && !right",
    "(if !left then right' || retained else left') && !right")],
  ['precedence', s => s.replace("right' || retained", "right' && retained")],
  ['inserted-unsupported', s => s.replace('  state left:', '  input ignored: Bool;\n  state left:')],
  ['trailing-program', s => s.replace('\n```\n', '\ncontrol Extra {}\n```\n')],
];
