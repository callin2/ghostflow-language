export const OUTPUT_OBSERVATION_FORMAT = 'GhostFlow/control-v22';
export const OUTPUT_OBSERVATION_ROLES = Object.freeze(['status', 'health', 'completion', 'fault']);

/** Validate the bounded scalar observation profile, including exact private names. */
export function validateOutputObservationsManifest(manifest, bytecodeFormat) {
  const descriptors = manifest.outputObservations;
  if (manifest.format !== OUTPUT_OBSERVATION_FORMAT) {
    if (descriptors !== undefined) throw new Error('outputObservations requires control-v22');
    return [];
  }
  if (![1, 2, 3, 4].includes(bytecodeFormat)) throw new Error('output observations require scalar GFB1..4');
  if (!Array.isArray(descriptors) || descriptors.length === 0 || descriptors.length > 32) throw new Error('outputObservations must contain 1..32 descriptors');
  if (['configs', 'schedules', 'providers', 'calendars', 'objectives', 'resources', 'adaptSettings'].some(key => manifest[key]?.length)
    || manifest.accounting || manifest.adaptPolicy || manifest.strategies) throw new Error('output observations require the scalar/sensor profile');
  const seen = new Set();
  for (const descriptor of descriptors) {
    if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)
      || Object.keys(descriptor).sort().join(',') !== 'completionInput,faultInput,healthInput,output,statusInput') throw new Error('invalid output observation descriptor fields');
    const { output } = descriptor;
    if (typeof output !== 'string' || output.length > 96 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(output)
      || output.startsWith('__gf_') || seen.has(output)
      || manifest.outputs?.find(item => item.name === output)?.type !== 'Bool') throw new Error('output observation requires a unique declared Bool output');
    seen.add(output);
    for (const role of OUTPUT_OBSERVATION_ROLES) {
      if (descriptor[`${role}Input`] !== `__gf_output_${output}_${role}`) throw new Error('output observation rail does not match output identity');
    }
  }
  return descriptors;
}

/** Scalar/context formats share the header/input table; GFB17/22 wrap a module. */
export function validateOutputObservationRails(manifest, bytes) {
  let data = bytes;
  if (!(data instanceof Uint8Array) || data.length < 6 || data[0] !== 71 || data[1] !== 70 || data[2] !== 66 || data[3] !== 49) throw new Error('invalid GFB header');
  let view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if ([17, 22].includes(view.getUint16(4, true))) {
    if (data.length < 16) throw new Error('truncated GFB22 envelope');
    const length = view.getUint32(6, true);
    if (length < 6 || length > data.length - 10) throw new Error('invalid GFB22 payload length');
    data = data.subarray(10, 10 + length);
    view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  if (view.getUint16(4, true) < 1 || view.getUint16(4, true) > 21 || view.getUint16(4, true) === 17) throw new Error('unsupported GFB input table format');
  const expected = new Set((manifest.outputObservations ?? []).flatMap(item => OUTPUT_OBSERVATION_ROLES.map(role => item[`${role}Input`])));
  let offset = 6;
  const text = () => {
    const length = view.getUint16(offset, true); offset += 2;
    if (offset + length > data.length) throw new Error('truncated GFB input table');
    const result = new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(offset, offset + length)); offset += length;
    return result;
  };
  text(); offset += 4;
  const count = view.getUint16(offset, true); offset += 2;
  if (count > 128) throw new Error('GFB input bound exceeded');
  for (let index = 0; index < count; index++) {
    const name = text(), type = view.getUint8(offset++);
    if (!name.startsWith('__gf_output_')) continue;
    if (!expected.delete(name) || type !== 2) throw new Error('unbound or invalid private output observation rail');
  }
  if (expected.size) throw new Error('output observation descriptor references missing rails');
}

/** A trusted provider supplies renderer evidence; callers cannot inject these through inputs. */
export function validateOutputObservation(record, runId, output, previous) {
  if (!record || typeof record !== 'object' || Array.isArray(record)
    || Object.keys(record).sort().join(',') !== 'completion,fault,health,output,requestId,runId,status') throw new Error('invalid trusted output observation fields');
  if (record.runId !== runId || record.output !== output) throw new Error('stale output run or incorrect output identity');
  const { requestId, status, health, completion, fault } = record;
  if (!Number.isSafeInteger(requestId) || requestId < 0 || ![status,health,completion,fault].every(Number.isInteger)
    || status < 0 || status > 4 || health < 0 || health > 2 || completion < 0 || completion > 3 || fault < 0 || fault > 5) throw new Error('invalid output observation values');
  if ((health === 2) !== (fault > 0)) throw new Error('inconsistent output health and fault');
  const valid = status === 0 ? requestId === 0 && completion === 0
    : status === 1 ? requestId > 0 && completion === 0
    : status === 2 ? requestId > 0 && completion > 0
    : requestId > 0 && health === 2 && fault > 0;
  if (!valid) throw new Error('inconsistent output observation');
  if (previous && (requestId < previous.requestId || requestId === previous.requestId
    && (completion < previous.completion || previous.status !== 0 && status === 0 || previous.status >= 2 && status !== previous.status))) throw new Error('stale or regressed output request');
  return { ...record };
}
