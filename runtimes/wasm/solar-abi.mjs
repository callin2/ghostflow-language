// Provider facts only. Occurrence admission and due are computed by Rust.
const utf8 = new TextEncoder();
const MAX_PACKET = 65536;
function fields(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new TypeError(`unexpected ${label}.${key}`);
}
function integer(value, label, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw new RangeError(`invalid ${label}`);
  return value;
}
export function validateSolarActivation(profile) {
  fields(profile, ['bootEpoch', 'terminalCapacity'], 'solar activation');
  integer(profile.bootEpoch, 'bootEpoch');
  integer(profile.terminalCapacity, 'terminalCapacity', 4096);
  if (!profile.terminalCapacity) throw new RangeError('invalid terminalCapacity');
  return profile;
}
export function encodeSolarFacts(packet) {
  return encodeFacts(packet, 1);
}
export function encodeScheduleFacts(packet) {
  const version = packet?.schedules?.some(schedule => schedule?.kind === 'daily-slots') ? 3 : 2;
  return encodeFacts(packet, version);
}
function encodeFacts(packet, version) {
  fields(packet, ['clock', 'schedules'], 'solar facts');
  const { clock, schedules } = packet;
  fields(clock, ['monotonicMs', 'bootEpoch', 'wallMs', 'trusted', 'unknownReason', 'uncertaintyMs', 'sourceRevision'], 'clock');
  if (typeof clock.trusted !== 'boolean') throw new TypeError('clock.trusted must be Bool');
  if (clock.trusted && clock.unknownReason != null) throw new TypeError('trusted clock cannot have unknownReason');
  if (!Array.isArray(schedules) || !schedules.length || schedules.length > 128) throw new RangeError('invalid schedules');
  const data = new Uint8Array(MAX_PACKET), view = new DataView(data.buffer); let at = 0;
  const room = count => { if (at + count > MAX_PACKET) throw new RangeError('solar packet exceeds 65536 bytes'); };
  const u8 = n => { room(1); view.setUint8(at++, n); };
  const u16 = n => { room(2); view.setUint16(at, n, true); at += 2; };
  const u32 = n => { room(4); view.setUint32(at, n, true); at += 4; };
  const u64 = (n, label) => { integer(n, label); room(8); view.setBigUint64(at, BigInt(n), true); at += 8; };
  const optional = (n, label) => { u8(n == null ? 0 : 1); u64(n ?? 0, label); };
  const text = (value, label, allowEmpty = false) => {
    if (typeof value !== 'string' || !value.isWellFormed()) throw new TypeError(`invalid ${label}`);
    const bytes = utf8.encode(value);
    if (bytes.length > 128 || (!allowEmpty && bytes.length === 0)) throw new RangeError(`invalid ${label}`);
    u16(bytes.length); room(bytes.length); data.set(bytes, at); at += bytes.length;
  };
  for (const value of [71, 70, 83, 70]) u8(value); // GFSF
  u16(version); u16(schedules.length);
  u64(clock.monotonicMs, 'monotonicMs'); u64(clock.bootEpoch, 'bootEpoch');
  optional(clock.wallMs, 'wallMs'); optional(clock.uncertaintyMs, 'uncertaintyMs');
  u8(clock.trusted ? 1 : 0);
  text(clock.trusted ? '' : clock.unknownReason, 'unknownReason', clock.trusted);
  text(clock.sourceRevision ?? '', 'sourceRevision', true);
  const sites = new Set();
  for (const schedule of schedules) {
    fields(schedule, ['site', 'coverageFromWallMs', 'coverageToWallMs', 'rows', ...(version >= 2 ? ['kind'] : [])], 'schedule');
    integer(schedule.site, 'site', 0xffffffff);
    if (!schedule.site || sites.has(schedule.site)) throw new RangeError('invalid or duplicate schedule site');
    sites.add(schedule.site); u32(schedule.site);
    if (version >= 2) {
      if (!(version === 3 ? ['daily-slots'] : ['solar', 'daily']).includes(schedule.kind)) throw new TypeError('invalid schedule kind');
      u8({ solar: 0, daily: 1, 'daily-slots': 2 }[schedule.kind]);
    }
    u64(schedule.coverageFromWallMs, 'coverageFromWallMs'); u64(schedule.coverageToWallMs, 'coverageToWallMs');
    if (!Array.isArray(schedule.rows) || schedule.rows.length > 4096) throw new RangeError('invalid solar rows');
    u16(schedule.rows.length);
    let previousIdentity = null;
    for (const row of schedule.rows) {
      fields(row, ['sourceDay', 'scheduledWallMs', 'available', 'providerRevision', 'contextRevision', ...(version >= 2 ? ['fold'] : []), ...(version === 3 ? ['slotKey', 'minuteOfDay'] : [])], 'row');
      u32(integer(row.sourceDay, 'sourceDay', 2932896));
      if (version === 3) {
        const slotKey = integer(row.slotKey, 'slotKey', 1440);
        const minute = integer(row.minuteOfDay, 'minuteOfDay', 1439);
        if (schedule.kind === 'daily-slots') {
          if (!slotKey || slotKey !== minute + 1 || minute % 15) throw new RangeError('invalid DailySlots row identity');
        } else if (slotKey !== 0 || minute !== 0) throw new RangeError('non-DailySlots row has slot identity');
        u16(slotKey); u16(minute);
      }
      if (version >= 2) u8(integer(row.fold, 'fold', 2));
      const identity = version === 3 ? [row.sourceDay, row.slotKey, row.fold]
        : version === 2 ? [row.sourceDay, row.fold] : [row.sourceDay];
      if (previousIdentity !== null) {
        const changed = identity.findIndex((value, index) => value !== previousIdentity[index]);
        if (changed < 0 || identity[changed] < previousIdentity[changed]) throw new RangeError('schedule rows must be ordered by occurrence identity');
      }
      previousIdentity = identity;
      if (typeof row.available !== 'boolean') throw new TypeError('row.available must be Bool');
      if (row.available !== (row.scheduledWallMs != null)) throw new TypeError('available occurrence requires scheduledWallMs');
      u8(row.available ? 1 : 0); optional(row.scheduledWallMs, 'scheduledWallMs');
      text(row.providerRevision, 'providerRevision'); text(row.contextRevision, 'contextRevision');
    }
  }
  return data.slice(0, at);
}
