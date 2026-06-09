import chalk from 'chalk';
import type { Ora } from 'ora';

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

// Streams a compiled graph/agent, rendering each step verbosely. Returns the last update chunk.
export async function runGraphVerbose(graph: any, input: unknown, spinner: Ora): Promise<unknown> {
  let last: unknown;
  for await (const [mode, chunk] of await graph.stream(input, { streamMode: ['updates', 'tools'] })) {
    if (mode === 'updates') last = chunk;
    const line = formatEvent(mode, chunk);
    if (!line) continue;
    switch (line.kind) {
      case 'node':
        spinner.stopAndPersist({ symbol: chalk.cyan('▸'), text: chalk.cyan(line.text) });
        break;
      case 'tool-start':
        spinner.start(chalk.yellow(`🔧 ${line.text}`));
        break;
      case 'tool-event':
        spinner.text = chalk.dim(line.text);
        break;
      case 'tool-end':
        spinner.succeed(chalk.green(`✓ ${line.text}`));
        break;
      case 'tool-error':
        spinner.fail(chalk.red(`✗ ${line.text}`));
        break;
    }
  }
  return last;
}
