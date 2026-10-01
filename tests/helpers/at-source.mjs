export function atSource({ at = '2026-01-01T08:00:00Z', when = 'allow', gap = '60s', declarations = 'input allow: Bool;', output = 'alarm <- appointment.due;' } = {}) {
  return `# One-shot appointment\n\n\`\`\`ghost\ncontrol Appointment {
  ${declarations}
  schedule appointment: At {
    at = datetime\`${at}\`;
    basis = pulse;
    when = ${when};
    clock = trusted_only;
    gap = skip_after(${gap});
    recovery = baseline;
    fallback = skip;
  }
  output alarm: Bool;
  ${output}
}\n\`\`\`\n`;
}
