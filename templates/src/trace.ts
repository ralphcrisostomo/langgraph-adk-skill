// Render-free agent stream consumer. Both the one-shot path (console output) and
// the Ink session (pinned UI) drive their display from these events.

export interface TraceLine {
  kind: 'node' | 'tool-start' | 'tool-event' | 'tool-end' | 'tool-error';
  text: string;
}

function fmtInput(input: unknown): string {
  try {
    const s = typeof input === 'string' ? input : JSON.stringify(input);
    return s.length > 60 ? `${s.slice(0, 57)}...` : s;
  } catch {
    return '';
  }
}

export function formatEvent(mode: string, chunk: any): TraceLine | null {
  if (mode === 'updates') {
    const node = Object.keys(chunk ?? {})[0];
    return node ? { kind: 'node', text: node } : null;
  }
  if (mode === 'tools') {
    switch (chunk?.event) {
      case 'on_tool_start':
        return { kind: 'tool-start', text: `${chunk.name}(${fmtInput(chunk.input)})` };
      case 'on_tool_event':
        return { kind: 'tool-event', text: chunk.data?.message ?? '…' };
      case 'on_tool_end':
        return { kind: 'tool-end', text: chunk.name };
      case 'on_tool_error':
        return { kind: 'tool-error', text: chunk.name };
    }
  }
  return null;
}

// One short label per event for display, e.g. "▸ tools", "🔧 aws_cli(...)", "✓ aws_cli".
export function stepText(line: TraceLine): string {
  switch (line.kind) {
    case 'node':
      return `▸ ${line.text}`;
    case 'tool-start':
      return `🔧 ${line.text}`;
    case 'tool-end':
      return `✓ ${line.text}`;
    case 'tool-error':
      return `✗ ${line.text}`;
    default:
      return line.text;
  }
}

// Streams a compiled graph/agent, calling `onStep` per event. Returns the last update chunk.
export async function streamAgent(
  graph: any,
  input: unknown,
  onStep?: (line: TraceLine) => void,
): Promise<unknown> {
  let last: unknown;
  for await (const [mode, chunk] of await graph.stream(input, { streamMode: ['updates', 'tools'] })) {
    if (mode === 'updates') last = chunk;
    const line = formatEvent(mode, chunk);
    if (line) onStep?.(line);
  }
  return last;
}
