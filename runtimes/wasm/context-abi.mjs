// GFB11 context activation and GFSF5 provider/settings evidence.
const utf8 = new TextEncoder();
const LIMIT = 65_536;
const MAX_EXACT = Number.MAX_SAFE_INTEGER;

function object(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new TypeError(`unexpected ${label}.${key}`);
  return value;
}
function integer(value, label, max = MAX_EXACT) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw new RangeError(`invalid ${label}`);
  return value;
}
function bounded(items, label, max = 128) {
  if (!Array.isArray(items) || items.length > max) throw new RangeError(`invalid ${label}`);
  return items;
}
class Writer {
  constructor() { this.bytes = new Uint8Array(LIMIT); this.view = new DataView(this.bytes.buffer); this.at = 0; }
  room(n) { if (this.at + n > LIMIT) throw new RangeError('context packet exceeds 65536 bytes'); }
  raw(values) { this.room(values.length); this.bytes.set(values, this.at); this.at += values.length; }
  u8(n) { this.room(1); this.view.setUint8(this.at++, n); }
  u16(n) { this.room(2); this.view.setUint16(this.at, n, true); this.at += 2; }
  u32(n) { this.room(4); this.view.setUint32(this.at, n, true); this.at += 4; }
  i32(n) { this.room(4); this.view.setInt32(this.at, n, true); this.at += 4; }
  f64(n) { this.room(8); this.view.setFloat64(this.at, n, true); this.at += 8; }
  u64(n, label) { integer(n, label); this.room(8); this.view.setBigUint64(this.at, BigInt(n), true); this.at += 8; }
  raw64(n, label) {
    const value = typeof n === 'bigint' ? n
      : typeof n === 'string' && /^[0-9a-f]{16}$/u.test(n) ? BigInt(`0x${n}`)
        : typeof n === 'string' && /^[0-9]+$/u.test(n) ? BigInt(n) : n;
    if (typeof value !== 'bigint' || value < 0n || value > 0xffff_ffff_ffff_ffffn) throw new RangeError(`invalid ${label}`);
    this.room(8); this.view.setBigUint64(this.at, value, true); this.at += 8;
  }
  optional(n, label) { this.u8(n == null ? 0 : 1); this.u64(n ?? 0, label); }
  str(value, label, empty = false) {
    if (typeof value !== 'string' || !value.isWellFormed()) throw new TypeError(`invalid ${label}`);
    const bytes = utf8.encode(value);
    if (bytes.length > 128 || !empty && bytes.length === 0) throw new RangeError(`invalid ${label}`);
    this.u16(bytes.length); this.raw(bytes);
  }
  finish() { return this.bytes.slice(0, this.at); }
}

function binding(writer, value, label) {
  const b = object(value, ['kind','provider','namespace','station','bindingRevision','location','timezone','criteria','maxUncertaintyMs'], label);
  const kind = { tide: 0, moon: 1, calendar: 2 }[b.kind];
  if (kind === undefined) throw new TypeError(`invalid ${label}.kind`);
  writer.u8(kind);
  for (const name of ['provider','namespace','station','bindingRevision','location','timezone','criteria']) writer.str(b[name], `${label}.${name}`);
  writer.u64(b.maxUncertaintyMs, `${label}.maxUncertaintyMs`);
}

function observation(writer, value, label) {
  const o = object(value, ['binding','providerRevision','coverageStartMs','coverageEndMs','expiresAtMs','uncertaintyMs','fault','classifications'], label);
  binding(writer, o.binding, `${label}.binding`);
  writer.str(o.providerRevision, `${label}.providerRevision`);
  const start = integer(o.coverageStartMs, `${label}.coverageStartMs`);
  const end = integer(o.coverageEndMs, `${label}.coverageEndMs`);
  if (start >= end) throw new RangeError(`invalid ${label} coverage`);
  writer.u64(start, 'coverageStartMs'); writer.u64(end, 'coverageEndMs');
  writer.u64(o.expiresAtMs, `${label}.expiresAtMs`);
  writer.u64(o.uncertaintyMs, `${label}.uncertaintyMs`);
  const fault = o.fault == null ? 255 : integer(o.fault, `${label}.fault`, 5);
  writer.u8(fault);
  const classes = bounded(o.classifications, `${label}.classifications`, 8);
  if (new Set(classes).size !== classes.length) throw new RangeError(`duplicate ${label} classification`);
  writer.u8(classes.length);
  for (const [index, entry] of classes.entries()) writer.str(entry, `${label}.classifications[${index}]`);
}

function calendar(writer, value, label) {
  const c = object(value, ['calendarId','revision','timezone','coveredFromDate','coveredToDateExclusive','expiresAtMs','weeklyWorkMask','holidayPolicy','holidays','exceptions'], label);
  for (const name of ['calendarId','revision','timezone']) writer.str(c[name], `${label}.${name}`);
  const from = integer(c.coveredFromDate, `${label}.coveredFromDate`, 2_932_896);
  const to = integer(c.coveredToDateExclusive, `${label}.coveredToDateExclusive`, 2_932_897);
  if (from >= to) throw new RangeError(`invalid ${label} date coverage`);
  writer.u32(from); writer.u32(to); writer.u64(c.expiresAtMs, `${label}.expiresAtMs`);
  writer.u8(integer(c.weeklyWorkMask, `${label}.weeklyWorkMask`, 127));
  if (!['off','work'].includes(c.holidayPolicy)) throw new TypeError(`invalid ${label}.holidayPolicy`);
  writer.u8(c.holidayPolicy === 'work' ? 1 : 0);
  const holidays = bounded(c.holidays, `${label}.holidays`, 4096);
  writer.u16(holidays.length); let previous = -1;
  for (const day of holidays) { const date = integer(day, `${label}.holiday`, 2_932_896);
    if (date <= previous || date < from || date >= to) throw new RangeError(`invalid ${label} holiday order`);
    previous = date; writer.u32(date); }
  const exceptions = bounded(c.exceptions, `${label}.exceptions`, 4096);
  writer.u16(exceptions.length); previous = -1;
  for (const [index, entry] of exceptions.entries()) {
    const e = object(entry, ['date','class'], `${label}.exceptions[${index}]`);
    const date = integer(e.date, `${label}.exceptions[${index}].date`, 2_932_896);
    if (date <= previous || date < from || date >= to || !['off','work'].includes(e.class)) throw new RangeError(`invalid ${label} exception order`);
    previous = date; writer.u32(date); writer.u8(e.class === 'work' ? 1 : 0);
  }
}

export function encodeContextActivation(profile) {
  const p = object(profile, ['bootEpoch','terminalCapacity','bindings'], 'context activation');
  const writer = new Writer(); writer.raw([71,70,67,65]); writer.u16(1);
  writer.u64(p.bootEpoch, 'bootEpoch');
  const capacity = integer(p.terminalCapacity, 'terminalCapacity', 4096);
  if (!capacity) throw new RangeError('invalid terminalCapacity');
  writer.u32(capacity);
  const bindings = bounded(p.bindings, 'bindings'); writer.u16(bindings.length);
  const names = new Set();
  for (const [index, entry] of bindings.entries()) {
    if (names.has(entry?.provider)) throw new RangeError('duplicate context provider');
    names.add(entry?.provider); binding(writer, entry, `bindings[${index}]`);
  }
  return writer.finish();
}

export function encodeContextFacts(packet) {
  const p = object(packet, ['clock','natural','schedules','settings'], 'context facts');
  const writer = new Writer(); writer.raw([71,70,83,70]); writer.u16(5);
  const c = object(p.clock, ['monotonicMs','bootEpoch','wallMs','uncertaintyMs','trusted','unknownReason','sourceRevision'], 'clock');
  writer.u64(c.monotonicMs, 'clock.monotonicMs'); writer.u64(c.bootEpoch, 'clock.bootEpoch');
  writer.optional(c.wallMs, 'clock.wallMs'); writer.optional(c.uncertaintyMs, 'clock.uncertaintyMs');
  if (typeof c.trusted !== 'boolean') throw new TypeError('clock.trusted must be Bool');
  if (c.trusted && c.unknownReason != null) throw new TypeError('trusted clock cannot have unknownReason');
  writer.u8(c.trusted ? 1 : 0); writer.str(c.trusted ? '' : c.unknownReason, 'clock.unknownReason', c.trusted);
  writer.str(c.sourceRevision ?? '', 'clock.sourceRevision', true);
  const naturals = bounded(p.natural, 'natural'); writer.u16(naturals.length);
  const naturalNames = new Set();
  for (const [index, item] of naturals.entries()) {
    if (naturalNames.has(item?.binding?.provider)) throw new RangeError('duplicate natural provider');
    naturalNames.add(item?.binding?.provider); observation(writer, item, `natural[${index}]`);
  }
  const schedules = bounded(p.schedules, 'schedules'); writer.u16(schedules.length);
  const sites = new Set();
  for (const [index, schedule] of schedules.entries()) {
    const label = `schedules[${index}]`;
    const s = object(schedule, ['site','coverageStartMs','coverageEndMs','provider','calendar','rows'], label);
    const site = integer(s.site, `${label}.site`, 0xffff_ffff);
    if (!site || sites.has(site)) throw new RangeError('invalid or duplicate schedule site');
    sites.add(site); writer.u32(site);
    const start = integer(s.coverageStartMs, `${label}.coverageStartMs`);
    const end = integer(s.coverageEndMs, `${label}.coverageEndMs`);
    if (start >= end) throw new RangeError(`invalid ${label} coverage`);
    writer.u64(start, 'coverageStartMs'); writer.u64(end, 'coverageEndMs');
    writer.u8(s.provider == null ? 0 : 1); if (s.provider != null) observation(writer, s.provider, `${label}.provider`);
    writer.u8(s.calendar == null ? 0 : 1); if (s.calendar != null) calendar(writer, s.calendar, `${label}.calendar`);
    const rows = bounded(s.rows, `${label}.rows`, 4096); writer.u16(rows.length);
    let previous = null;
    for (const [rowIndex, value] of rows.entries()) {
      const row = object(value, ['sourceDay','slotKey','minuteOfDay','fold','eventId','eventKind','instantMs','withdrawn','providerRevision','contextRevision'], `${label}.rows[${rowIndex}]`);
      const sourceDay = integer(row.sourceDay, 'sourceDay', 2_932_896), slotKey = integer(row.slotKey, 'slotKey');
      const minute = integer(row.minuteOfDay, 'minuteOfDay', 1439), fold = integer(row.fold, 'fold', 2);
      const eventKind = { civil: 0, high: 1, low: 2 }[row.eventKind];
      if (eventKind === undefined || typeof row.withdrawn !== 'boolean') throw new TypeError('invalid occurrence kind or withdrawal');
      const identity = eventKind === 0 ? [sourceDay, slotKey, minute, fold] : [row.eventId];
      const civilOrder = previous && eventKind === 0
        ? identity.findIndex((value, at) => value !== previous.identity[at]) : -1;
      if (previous !== null && ((eventKind === 0) !== (previous.kind === 0) ||
          (eventKind === 0 && (civilOrder < 0 || identity[civilOrder] < previous.identity[civilOrder]) ||
            eventKind !== 0 && row.eventId <= previous.identity[0]))) {
        throw new RangeError('occurrence rows must be ordered by source identity');
      }
      previous = { kind: eventKind, identity };
      writer.u32(sourceDay); writer.u64(slotKey, 'slotKey'); writer.u16(minute); writer.u8(fold);
      writer.str(row.eventId ?? '', 'eventId', eventKind === 0); writer.u8(eventKind);
      writer.optional(row.instantMs, 'instantMs'); writer.u8(row.withdrawn ? 1 : 0);
      writer.str(row.providerRevision, 'providerRevision'); writer.str(row.contextRevision, 'contextRevision');
    }
  }
  writer.u8(p.settings == null ? 0 : 1);
  if (p.settings != null) {
    const e = object(p.settings, ['programFingerprint','eventId','baseRevision','position','origin','changes'], 'settings');
    writer.raw64(e.programFingerprint, 'settings.programFingerprint'); writer.str(e.eventId, 'settings.eventId');
    writer.u64(e.baseRevision, 'settings.baseRevision'); writer.u64(e.position, 'settings.position');
    if (!['operatorEdit','producerObservation'].includes(e.origin)) throw new TypeError('invalid settings.origin');
    writer.u8(e.origin === 'operatorEdit' ? 0 : 1);
    const changes = bounded(e.changes, 'settings.changes'); if (!changes.length) throw new RangeError('empty settings event');
    writer.u16(changes.length); const changed = new Set();
    for (const [index, value] of changes.entries()) {
      const change = object(value, ['configId','result'], `settings.changes[${index}]`);
      const id = integer(change.configId, 'configId', 0xffff_ffff);
      if (!id || changed.has(id)) throw new RangeError('invalid or duplicate configId');
      changed.add(id); writer.u32(id);
      const result = object(change.result, ['ok','type','value','fault'], `settings.changes[${index}].result`);
      if (result.ok === false) {
        if (result.type !== undefined || result.value !== undefined || !['SettingsInvalid','SettingsUnavailable'].includes(result.fault)) throw new TypeError('invalid settings fault Result');
        writer.u8(1); writer.u8(result.fault === 'SettingsInvalid' ? 0 : 1);
      } else if (result.ok === true) {
        if (result.fault !== undefined) throw new TypeError('invalid settings success Result');
        writer.u8(0); writer.str(result.type, 'settings type');
        if (typeof result.value === 'boolean') { writer.u8(0); writer.u8(result.value ? 1 : 0); }
        else if (result.type === 'Int') {
          if (!Number.isInteger(result.value) || result.value < -2147483648 || result.value > 2147483647) throw new RangeError('invalid settings Int');
          writer.u8(1); writer.i32(result.value);
        } else if (typeof result.value === 'number') {
          if (!Number.isFinite(result.value)) throw new RangeError('invalid settings Number');
          writer.u8(2); writer.f64(result.value);
        } else {
          const slotValue = object(result.value, ['kind','entries'], 'settings TimeSlots');
          if (slotValue.kind !== 'slots') throw new TypeError('invalid settings value');
          writer.u8(3); const slots = bounded(slotValue.entries, 'settings slots', 4096); writer.u16(slots.length);
          for (const [at, item] of slots.entries()) { const slot = object(item, ['key','minuteOfDay'], `settings.slots[${at}]`);
            writer.u64(slot.key, 'slot.key'); writer.u16(integer(slot.minuteOfDay, 'slot.minuteOfDay', 1439)); }
        }
      } else throw new TypeError('settings result.ok must be Bool');
    }
  }
  return writer.finish();
}
