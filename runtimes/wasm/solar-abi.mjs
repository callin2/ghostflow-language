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
  u16(1); u16(schedules.length);
  u64(clock.monotonicMs, 'monotonicMs'); u64(clock.bootEpoch, 'bootEpoch');
  optional(clock.wallMs, 'wallMs'); optional(clock.uncertaintyMs, 'uncertaintyMs');
  u8(clock.trusted ? 1 : 0);
  text(clock.trusted ? '' : clock.unknownReason, 'unknownReason', clock.trusted);
  text(clock.sourceRevision ?? '', 'sourceRevision', true);
  const sites = new Set();
  for (const schedule of schedules) {
    fields(schedule, ['site', 'coverageFromWallMs', 'coverageToWallMs', 'rows'], 'schedule');
    integer(schedule.site, 'site', 0xffffffff);
    if (!schedule.site || sites.has(schedule.site)) throw new RangeError('invalid or duplicate schedule site');
    sites.add(schedule.site); u32(schedule.site);
    u64(schedule.coverageFromWallMs, 'coverageFromWallMs'); u64(schedule.coverageToWallMs, 'coverageToWallMs');
    if (!Array.isArray(schedule.rows) || schedule.rows.length > 4096) throw new RangeError('invalid solar rows');
    u16(schedule.rows.length);
    for (const row of schedule.rows) {
      fields(row, ['sourceDay', 'scheduledWallMs', 'available', 'providerRevision', 'contextRevision'], 'row');
      u32(integer(row.sourceDay, 'sourceDay', 2932896));
      if (typeof row.available !== 'boolean') throw new TypeError('row.available must be Bool');
      if (row.available !== (row.scheduledWallMs != null)) throw new TypeError('available occurrence requires scheduledWallMs');
      u8(row.available ? 1 : 0); optional(row.scheduledWallMs, 'scheduledWallMs');
      text(row.providerRevision, 'providerRevision'); text(row.contextRevision, 'contextRevision');
    }
  }
  return data.slice(0, at);
}
