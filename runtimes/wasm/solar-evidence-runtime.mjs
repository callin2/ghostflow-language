import { ControlRuntime } from './control-runtime.mjs';
import { observeSourceTrace } from '../../tools/source-trace.mjs';
import { compileSource, restoreArtifactSourceMap } from '../../tools/toolchain.mjs';
import { canonicalJson } from '../../tools/canonical-json.mjs';
import { sha256Hex } from '../../tools/sha256.mjs';

/** Bounded reference scan recorder. Admission comes only from the shared core.
 * This owner has no physical sink and does not issue installed/run identities. */
export class SolarEvidenceRuntime {
  #runtime; #artifact; #runId; #receipts = []; #admitted = new Map(); #closed = false;
  static async instantiate(wasmBytes, artifact, { context, runId } = {}) {
    if (typeof runId !== 'string' || !runId.length || runId.length > 128) throw new Error('explicit bounded run identity required');
    const captured = structuredClone(artifact), activation = structuredClone(context);
    const wasm = new Uint8Array(wasmBytes);
    restoreArtifactSourceMap({ format: 'GhostFlow/source-map-v1',
      bytecodeSha256: captured.manifest?.bytecodeSha256, sourceDocument: captured.sourceDocument,
      nodes: captured.sourceMap, lines: captured.extractionMap, traceMetadata: captured.traceMetadata,
      interactionSchema: captured.interactionSchema ?? null,
      interactionSourceIdentity: captured.interactionSourceIdentity ?? null,
      ...(captured.sourceClosure ? { sourceClosure: captured.sourceClosure } : {}) }, captured.bytes,
    { manifest: captured.manifest, expectedSourceSha256: captured.sourceDocument?.sha256 });
    const rebuilt = await compileSource(captured.sourceDocument.text, {
      filename: captured.sourceDocument.filename,
      ...(captured.sourceClosure ? { sourceClosure: captured.sourceClosure.documents } : {}),
      ...(captured.interactionSourceIdentity ? { interactionSourceIdentity: captured.interactionSourceIdentity } : {}),
    });
    if (sha256Hex(rebuilt.bytes) !== sha256Hex(captured.bytes)
        || canonicalJson(rebuilt.manifest) !== canonicalJson(captured.manifest)) {
      throw new Error('Solar recorder manifest or bytecode does not match canonical source');
    }
    if (captured.manifest?.format !== 'GhostFlow/control-v15'
        || !captured.manifest.schedules?.length
        || captured.manifest.schedules.some(item => item.kind !== 'solar' || item.policy?.basis !== 'pulse')) {
      throw new Error('Solar evidence recorder requires the shared Solar pulse profile');
    }
    const runtime = await ControlRuntime.instantiateFramed(wasm, captured, { context: activation });
    return new SolarEvidenceRuntime(runtime, captured, runId);
  }
  constructor(runtime, artifact, runId) { this.#runtime = runtime; this.#artifact = artifact; this.#runId = runId; }
  #available() { if (this.#closed) throw new Error('Solar recorder is disposed'); }
  step(frame) {
    this.#available();
    if (this.#receipts.length >= 256) throw new Error('Solar recorder receipt capacity exceeded');
    const captured = structuredClone(frame);
    if (new TextEncoder().encode(JSON.stringify(captured)).length > 1024 * 1024) throw new Error('Solar recorder frame byte budget exceeded');
    // Host facts must remain complete; the core validates binding, coverage,
    // availability, typed causes and clock evidence before accepting the scan.
    const outcome = this.#runtime.step(captured);
    const source = observeSourceTrace(this.#artifact.traceMetadata, outcome.vm);
    const admitted = new Map(this.#admitted), observations = [];
    for (const descriptor of this.#artifact.manifest.schedules) {
      const trace = outcome.vm.contextTrace.filter(row => row.site === descriptor.site);
      const facts = captured.contextFacts.solars.find(item => item.site === descriptor.site);
      for (const row of trace.filter(item => item.decision === 'Due')) {
        const fact = facts.rows.find(item => row.occurrenceId === `${descriptor.site}:${item.sourceDay}:0:0`);
        if (!fact) throw new Error('accepted Solar admission lacks its provider fact');
        admitted.set(row.occurrenceId, { ...structuredClone(row), sourceDay: fact.sourceDay,
          admissionScanId: outcome.frame.scanId, admissionLogicalTimeMs: outcome.frame.logicalTimeMs });
      }
      observations.push(...trace.map(row => ({ scheduleId: descriptor.name, site: descriptor.site,
        booleanProjection: trace.some(item => item.decision === 'Due'), coreDecision: row.decision,
        disposition: row.decision, ...structuredClone(row) })));
      // The core's terminal checkpoint deliberately does not classify historical
      // keys. Only a Due receipt accepted by this recorder proves admission.
      for (const fact of facts.rows) {
        const prior = admitted.get(`${descriptor.site}:${fact.sourceDay}:0:0`);
        if (!prior || prior.admissionScanId === outcome.frame.scanId) continue;
        observations.push({ scheduleId: descriptor.name, site: descriptor.site,
          booleanProjection: trace.some(row => row.decision === 'Due'), occurrenceDue: false,
          coreDecision: trace.map(row => row.decision),
          disposition: 'AlreadyAdmitted', occurrenceId: prior.occurrenceId,
          sourceDay: fact.sourceDay, plannedWallMs: fact.scheduledWallMs,
          providerRevision: fact.providerRevision, contextRevision: fact.contextRevision,
          availability: fact.availability, unavailableReason: fact.unavailableReason ?? null,
          coverageStartMs: facts.coverageStartMs, coverageEndMs: facts.coverageEndMs,
          admission: structuredClone(prior) });
      }
    }
    const receipt = { runId: this.#runId, frame: structuredClone(outcome.frame),
      sourceSha256: source.sourceDocumentSha256, artifactSha256: source.bytecodeSha256,
      clock: structuredClone(captured.contextFacts.clock), outcome: structuredClone(this.#runtime.lastFrameOutcome), observations,
      checkpoint: Buffer.from(this.#runtime.contextSnapshot().bytes).toString('hex') };
    this.#admitted = admitted; this.#receipts.push(receipt);
    return structuredClone(receipt);
  }
  observe() { this.#available(); return structuredClone(this.#receipts); }
  contextSnapshot() { this.#available(); return this.#runtime.contextSnapshot(); }
  dispose() { if (!this.#closed) { this.#runtime.dispose(); this.#closed = true; } }
}
