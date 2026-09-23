// Pure terminal presentation for the virtual GhostFlow console.
export const LIVE_HISTORY_LIMIT = 120;

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const wide = /[\u1100-\u115f\u2329-\u232a\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6\u{1f300}-\u{1faff}]/u;

function printable(value) {
  return String(value ?? '').replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))?/gu, '')
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ');
}

function cells(value) {
  return [...segmenter.segment(printable(value))].map(({ segment }) => ({
    segment, width: wide.test(segment) ? 2 : 1,
  }));
}

function fit(value, width) {
  if (width <= 0) return '';
  let result = ''; let count = 0;
  for (const cell of cells(value)) {
    if (count + cell.width > width) break;
    result += cell.segment; count += cell.width;
  }
  return result;
}

function pad(value, width) {
  const clipped = fit(value, width);
  const used = cellWidth(clipped);
  return clipped + ' '.repeat(Math.max(0, width - used));
}

function cellWidth(value) {
  return cells(value).reduce((sum, cell) => sum + cell.width, 0);
}

function state(value) {
  return value === true ? 'ON' : value === false ? 'OFF' : 'unobserved';
}

function waveform(scans, port, field, width) {
  if (!port || width <= 0) return '';
  return scans.slice(-width).map(scan => {
    const value = scan?.[field]?.[port];
    return value === true ? '-' : value === false ? '_' : '?';
  }).join('');
}

function channelTitle(channel, port) {
  const label = channel.label === channel.name ? channel.name : `${channel.name} ${channel.label}`;
  if (!port) return `${label} (unbound)`;
  return port === channel.name || port.toLowerCase() === channel.label.toLowerCase()
    ? label : `${label} ${port}`;
}

/** Return one complete screen frame. `history` contains committed scan results. */
export function renderLivePanel(profile, bound, scan, history = [], {
  columns = 80, rows = 24, status = 'running', error,
} = {}) {
  const width = Math.max(1, Math.trunc(Number.isFinite(columns) ? columns : 80));
  const height = Math.max(1, Math.trunc(Number.isFinite(rows) ? rows : 24));
  const samples = history.slice(-LIVE_HISTORY_LIMIT);
  const lines = [];
  const add = line => lines.push(fit(line, width));
  add(`GHOSTSIM LIVE  ${profile.id}${profile.revision ? ` @ ${profile.revision}` : ''}`);
  add(`scan ${scan?.scanId ?? 'unobserved'}  time ${scan?.logicalTimeMs ?? 'unobserved'} ms  status ${status}`);
  add('physical: unconfirmed    [1-8] toggle  [:] command  [Ctrl-C] exit');
  if (error) add(`error: ${error.message ?? error}`);
  const leftWidth = Math.max(1, Math.floor((width - 3) * 0.4));
  const rightWidth = Math.max(0, width - leftWidth - 3);
  const compact = width < 65;
  const displayState = value => compact && value === 'unobserved' ? '?' : value;
  add(`${pad('INPUT state/wave', leftWidth)} | ${fit('OUT R=req S=safe; _ OFF - ON ? unobserved', rightWidth)}`);

  for (let index = 0; index < Math.max(profile.inputs.length, profile.outputs.length); index++) {
    const input = profile.inputs[index];
    const output = profile.outputs[index];
    let inputCell = '';
    if (input) {
      const port = bound.get(input.name);
      const key = index < 8 && port && input.type === 'Bool' ? String(index + 1) : ' ';
      const value = displayState(!port ? 'unobserved' : input.type === 'Bool'
        ? state(scan?.inputs?.[port]) : 'unsupported');
      const titleWidth = Math.min(13, Math.max(4, leftWidth - (compact ? 10 : 17)));
      const prefix = `${key} ${pad(channelTitle(input, port), titleWidth)} ${pad(value, value === 'unobserved' ? 10 : 3)} `;
      inputCell = prefix + waveform(samples, port, 'inputs', Math.max(0, leftWidth - cellWidth(prefix)));
    }
    let outputCell = '';
    if (output) {
      const port = bound.get(output.name);
      const requested = displayState(!port ? 'unobserved' : output.type === 'Bool'
        ? state(scan?.requestedVirtualIntent?.[port]) : 'unsupported');
      const safe = displayState(!port ? 'unobserved' : output.type === 'Bool'
        ? state(scan?.safeVirtualIntent?.[port]) : 'unsupported');
      const titleWidth = Math.min(13, Math.max(4, Math.floor(rightWidth * 0.28)));
      const prefix = `${pad(channelTitle(output, port), titleWidth)} R:${requested} S:${safe}`;
      const traceWidth = Math.max(0, Math.floor((rightWidth - cellWidth(prefix) - 7) / 2));
      outputCell = port ? `${prefix} R:${waveform(samples, port, 'requestedVirtualIntent', traceWidth)} S:${waveform(samples, port, 'safeVirtualIntent', traceWidth)}` : prefix;
    }
    add(`${pad(inputCell, leftWidth)} | ${fit(outputCell, rightWidth)}`);
  }

  if (lines.length > height) {
    const footer = `... ${lines.length - height + 1} rows clipped; enlarge terminal`;
    lines.splice(height - 1, Infinity, fit(footer, width));
  }
  return `\x1b[H\x1b[2J${lines.join('\n')}`;
}
