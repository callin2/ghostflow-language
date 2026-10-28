const DAY_MS = 86_400_000;
const MAX_WALL_MS = 253_402_300_799_999;
const MAX_DAY = 2_932_896;

// The host owns IANA conversion. The portable core receives the resulting
// civil date as a typed fact and never guesses it from a UTC day.
export function localEpochDay(instantMs, timezone) {
  if (!Number.isSafeInteger(instantMs) || instantMs < 0 || instantMs > MAX_WALL_MS) {
    throw new RangeError('invalid civil-date instant');
  }
  if (typeof timezone !== 'string' || !timezone) throw new TypeError('civil-date timezone is required');
  const formatter = new Intl.DateTimeFormat('en-CA-u-ca-gregory-nu-latn', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = Object.fromEntries(formatter.formatToParts(instantMs).map(part => [part.type, part.value]));
  const date = `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}`;
  const midnight = Date.parse(`${date}T00:00:00.000Z`);
  const day = midnight / DAY_MS;
  if (!Number.isSafeInteger(day) || day < 0 || day > MAX_DAY
      || new Date(midnight).toISOString().slice(0, 10) !== date) {
    throw new RangeError('civil date is outside the supported range');
  }
  return day;
}

export function scheduledLocalDateFact({ site, sourceKey, sourceDay, timezone, plannedWallMs,
  providerRevision, contextRevision, resolverRevision }) {
  return { site, sourceKey, sourceDay, timezone, plannedWallMs,
    scheduledDay: localEpochDay(plannedWallMs, timezone), unavailableReason: null,
    providerRevision, contextRevision, resolverRevision };
}

// This revision names the host conversion algorithm, not the host's tzdb
// release. Provider/context revisions remain separate evidence.
export const LOCAL_DATE_RESOLVER_REVISION = 'intl-gregory-v1';

export function naturalScheduledDateFacts(packet, descriptors) {
  const facts = [];
  for (const descriptor of descriptors) {
    if (descriptor.day?.kind !== 'weekday') continue;
    const evidence = descriptor.kind === 'solar'
      ? packet.solars?.find(row => row.site === descriptor.site)
      : packet.schedules?.find(row => row.site === descriptor.site);
    if (!evidence) continue; // The provider binding validator rejects the missing envelope.
    for (const row of evidence.rows) {
      if (descriptor.kind === 'tide' && (row.withdrawn || row.eventKind !== descriptor.event)) continue;
      const plannedWallMs = descriptor.kind === 'solar'
        ? row.scheduledWallMs ?? row.fallbackWallMs
        : row.instantMs == null ? null : row.instantMs + descriptor.offsetMs;
      if (plannedWallMs == null) continue;
      const base = { site: descriptor.site,
        sourceKey: descriptor.kind === 'solar' ? `solar:${row.sourceDay}` : `tide:${row.eventId}`,
        sourceDay: row.sourceDay, timezone: descriptor.timezone, plannedWallMs,
        providerRevision: row.providerRevision, contextRevision: row.contextRevision,
        resolverRevision: LOCAL_DATE_RESOLVER_REVISION };
      try {
        facts.push(scheduledLocalDateFact(base));
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        facts.push({ ...base, scheduledDay: null, unavailableReason: 'CivilDateUnavailable' });
      }
    }
  }
  return facts;
}
