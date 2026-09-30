const document = body => `# Planned watering range\n\n\`\`\`ghost\n${body}\n\`\`\`\n`;

export function dailySlotsRange({ selected = '[08:00, 08:15]', duration = '15min', config = '', timezone = 'UTC', dstMissing = 'skip', dstRepeated = 'first' } = {}) {
  return document(`control PlannedWatering {
  ${config}
  schedule watering: DailySlots<15min> {
    timezone = "${timezone}";
    selected = ${selected};
    dst_missing = ${dstMissing};
    dst_repeated = ${dstRepeated};
    basis = range(${duration});
    when = true;
    cancel_when = false;
    clock = trusted_only;
    gap = skip_after(60s);
    recovery = baseline;
    fallback = skip;
  }
  output pump: Bool;
  pump <- watering.active;
}`);
}
