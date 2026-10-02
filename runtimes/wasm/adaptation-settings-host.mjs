import { ControlRuntime } from './control-runtime.mjs';
import { isInt32, intSettingsIssue } from '../../tools/int-settings.mjs';
import { sha256Hex } from '../../tools/sha256.mjs';
import { canonicalJson } from '../../tools/canonical-json.mjs';

const construction = Symbol('fresh adaptation owner');
const clone = value => structuredClone(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;

// Reference host admission, not a second evaluator or a physical driver.
// This profile deliberately creates a fresh core and exposes no restore path.
export class AdaptationSettingsHost {
  #runtime; #policies; #configs; #authorities; #history = []; #capacity;
  #eventIds = new Set();
  #sourceSha256;
  #policySha256;
  #position = 1; #lastTime = null;

  static async instantiate(wasm, artifact, { authorities, historyCapacity = 256, ...activation } = {}) {
    artifact = clone(artifact); authorities = clone(authorities); activation = clone(activation);
    if (!authorities || typeof authorities !== 'object' || Array.isArray(authorities)
      || !Object.entries(authorities).every(([actor, authority]) => actor.length && typeof authority === 'string' && authority.length)
      || !integer(historyCapacity) || historyCapacity < 1 || historyCapacity > 4096) throw new Error('invalid adaptation activation');
    if (!/^[a-f0-9]{64}$/.test(artifact?.sourceDocument?.sha256 ?? '')) throw new Error('adaptation requires canonical source identity');
    const runtime = await ControlRuntime.instantiate(wasm, artifact, activation);
    try { return new AdaptationSettingsHost(construction, runtime, authorities, historyCapacity, artifact.sourceDocument.sha256); }
    catch (error) { runtime.dispose(); throw error; }
  }

  constructor(token, runtime, authorities, capacity, sourceSha256) {
    if (token !== construction) throw new Error('adaptation requires fresh activation');
    this.#runtime = runtime;
    this.#policies = clone(runtime.manifest.adaptSettings ?? []);
    this.#policySha256 = sha256Hex(canonicalJson(this.#policies));
    this.#configs = clone(runtime.manifest.configs);
    this.#authorities = new Map(Object.entries(authorities));
    this.#capacity = capacity;
    this.#sourceSha256 = sourceSha256;
    if (!this.#policies.length || this.#policies.some(policy => {
      const config = this.#configs.find(item => item.id === policy.targetId);
      return !config || config.settings?.access !== 'operator' || config.type === 'Bool';
    })) throw new Error('adaptation requires operator-editable numeric context settings');
    runtime.contextSnapshot(); // Require the actual context activation owner.
  }

  snapshot() { return { core: this.#runtime.contextSnapshot(), position: this.#position,
    sourceSha256: this.#sourceSha256, policySha256: this.#policySha256, lastTimeMs: this.#lastTime, history: clone(this.#history), acceptedEventIds: [...this.#eventIds] }; }
  dispose() { this.#runtime.dispose(); }

  step(packet, proposal = null) {
    packet = clone(packet); proposal = clone(proposal);
    const state = this.#runtime.contextSnapshot().state;
    if (!integer(packet?.nowMs) || (this.#lastTime !== null && packet.nowMs < this.#lastTime)
      || packet.contextFacts?.settings != null) throw new Error('invalid adaptation packet');
    const pending = [], observations = [];
    let reason = null;
    if (proposal !== null) {
      const reject = value => { reason ??= value; };
      if (!proposal || typeof proposal !== 'object' || !Array.isArray(proposal.changes)
        || !proposal.changes.length || proposal.changes.length > this.#policies.length) reject('proposal-shape');
      if (proposal?.programFingerprint !== state.programFingerprint) reject('program-identity');
      if (proposal?.sourceSha256 !== this.#sourceSha256) reject('source-identity');
      if (proposal?.policySha256 !== this.#policySha256) reject('policy-identity');
      if (proposal?.baseRevision !== state.settingsRevision) reject('settings-revision');
      if (proposal?.atMs !== packet.nowMs || packet.contextFacts?.clock?.monotonicMs !== packet.nowMs) reject('occurrence-time');
      for (const key of ['eventId','actor','authority','source','evidence']) {
        if (typeof proposal?.[key] !== 'string' || !proposal[key].length || proposal[key].length > 128) reject('proposal-provenance');
      }
      if (this.#authorities.get(proposal?.actor) !== proposal?.authority) reject('actor-authority');
      if (this.#eventIds.has(proposal?.eventId)) reject('duplicate-event');
      if (this.#eventIds.size >= this.#capacity) reject('event-capacity');
      const seen = new Set();
      for (const change of Array.isArray(proposal?.changes) ? proposal.changes.slice(0, this.#policies.length + 1) : []) {
        const policy = this.#policies.find(item => item.targetId === change?.configId);
        const config = this.#configs.find(item => item.id === change?.configId);
        const old = state.settings.find(item => item.id === change?.configId)?.result;
        observations.push({ configId: change?.configId, old: clone(old ?? null), proposed: clone(change?.value ?? null), effective: clone(old ?? null) });
        if (!policy || !config || !old?.ok || seen.has(change.configId)) { reject('setting-identity'); continue; }
        seen.add(change.configId);
        if (proposal.authority !== policy.authority) reject('policy-authority');
        const value = change.value;
        if (change.type !== config.type || typeof value !== 'number' || !Number.isFinite(value)
          || (config.type === 'Int' && !isInt32(value))
          || (config.type === 'Duration' && !integer(value))) { reject('setting-type'); continue; }
        const settings = config.settings;
        if (value < policy.allowed.min || value > policy.allowed.max || value < settings.min || value > settings.max) reject('setting-range');
        if (config.type === 'Int' ? intSettingsIssue(value, settings) !== null
          : config.type === 'Duration' ? (value - settings.min) % settings.step !== 0
            : Math.abs((value - settings.min) / settings.step - Math.round((value - settings.min) / settings.step)) > 1e-9) reject('setting-grid');
        const delta = Math.abs(value - old.value);
        if (delta > policy.maxStep) reject('max-step');
        const used = this.#history.filter(item => item.configId === change.configId && item.atMs > packet.nowMs - policy.windowMs)
          .reduce((sum, item) => sum + item.delta, 0);
        if (used + delta > policy.maxChange) reject('rate-limit');
        pending.push({ configId: change.configId, type: config.type, value, delta, atMs: packet.nowMs });
      }
    }
    const retained = this.#history.filter(item => {
      const policy = this.#policies.find(policy => policy.targetId === item.configId);
      return item.atMs > packet.nowMs - policy.windowMs;
    });
    if (proposal !== null && retained.length + pending.length > this.#capacity) reason ??= 'history-capacity';
    const trace = proposal === null ? null : { proposal: clone(proposal), programFingerprint: state.programFingerprint,
      sourceSha256: this.#sourceSha256,
      policySha256: this.#policySha256,
      baseRevision: state.settingsRevision, settingsRevision: state.settingsRevision,
      position: this.#position, changes: observations, accepted: false, reason };
    if (reason) return { outcome: null, adaptation: trace };
    const facts = clone(packet.contextFacts);
    if (proposal !== null) facts.settings = {
      programFingerprint: state.programFingerprint, eventId: proposal.eventId,
      baseRevision: state.settingsRevision, position: this.#position, origin: 'operatorEdit',
      changes: pending.map(({ configId, type, value }) => ({ configId, result: { ok: true, type, value } })),
    };
    const outcome = this.#runtime.step({ ...packet, contextFacts: facts });
    if (proposal !== null) {
      const effective = this.#runtime.contextSnapshot().state;
      if (effective.settingsRevision !== state.settingsRevision + 1 || pending.some(change => {
        const result = effective.settings.find(item => item.id === change.configId)?.result;
        return !result?.ok || result.value !== change.value;
      })) {
        this.#runtime.dispose();
        throw new Error('adaptation effective settings invariant failed; owner disposed');
      }
    }
    this.#history = [...retained, ...pending];
    this.#lastTime = packet.nowMs;
    this.#position += 1;
    if (trace) {
      const effective = this.#runtime.contextSnapshot().state;
      this.#eventIds.add(proposal.eventId);
      trace.accepted = true;
      trace.settingsRevision = effective.settingsRevision;
      for (const row of trace.changes) row.effective = clone(effective.settings.find(item => item.id === row.configId).result);
    }
    return { outcome, adaptation: trace };
  }
}
