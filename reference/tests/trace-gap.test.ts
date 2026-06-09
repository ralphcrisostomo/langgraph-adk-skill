import { test, expect } from 'bun:test';
import { runGraphVerbose } from '../src/trace';

// Minimal Ora stand-in that only tracks whether it is actively spinning.
function makeSpinner() {
  return {
    isSpinning: false,
    text: '',
    start() { this.isSpinning = true; return this; },
    stop() { this.isSpinning = false; return this; },
    succeed() { this.isSpinning = false; return this; },
    fail() { this.isSpinning = false; return this; },
    stopAndPersist() { this.isSpinning = false; return this; },
  };
}

test('spinner stays live during the model-generation gap after a node update', async () => {
  const spinner = makeSpinner();
  let spinningDuringGap: boolean | undefined;

  // Reproduces a real tool-using agent stream: model -> tool -> model(final answer).
  async function* stream() {
    yield ['updates', { model_request: {} }];
    yield ['tools', { event: 'on_tool_start', name: 'search', input: {} }];
    yield ['tools', { event: 'on_tool_end', name: 'search' }];
    yield ['updates', { tools: {} }];
    // The agent now calls the model to generate its final answer — a multi-second
    // wait. The user MUST see a live spinner here; capture the state at this point.
    spinningDuringGap = spinner.isSpinning;
    yield ['updates', { finisher: { step: 2 } }];
  }
  const graph = { stream: () => stream() };

  const last = await runGraphVerbose(graph as any, {}, spinner as any);

  expect(spinningDuringGap).toBe(true);   // regression: stopAndPersist must not leave it stopped
  expect(spinner.isSpinning).toBe(false); // and the run must never leave a spinner hanging
  expect(last).toEqual({ finisher: { step: 2 } });
});
