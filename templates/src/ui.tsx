/** @jsxImportSource react */
// Pin React JSX so the CLI transpiles correctly when run as a global bin from any
// directory — Bun resolves jsxImportSource from the launch cwd's tsconfig otherwise.
import * as React from 'react';
import { Box, render, Text, useInput } from 'ink';
import { ConfirmInput, Select, Spinner, TextInput } from '@inkjs/ui';

// Mirrors inquirer's ExitPromptError so existing Ctrl+C handling keeps working.
export class QuitError extends Error {
  constructor() {
    super('User force closed the prompt with SIGINT');
    this.name = 'ExitPromptError';
  }
}

// Render one Ink prompt, resolve/reject, then unmount. `build` receives resolve/reject.
function runPrompt<T>(
  build: (resolve: (v: T) => void, reject: (e: unknown) => void) => React.ReactElement,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let unmount = () => {};
    const settle = (fn: () => void) => {
      unmount();
      fn();
    };
    const element = build(
      (v) => settle(() => resolve(v)),
      (e) => settle(() => reject(e)),
    );
    unmount = render(element).unmount;
  });
}

function CtrlCQuit({ reject }: { reject: (e: unknown) => void }) {
  useInput((input, key) => {
    if (key.ctrl && input === 'c') reject(new QuitError());
  });
  return null;
}

// Menu — replaces inquirer's `select`.
export function selectMenu(message: string, options: { label: string; value: string }[]): Promise<string> {
  return runPrompt<string>((resolve, reject) => (
    <Box flexDirection="column">
      <CtrlCQuit reject={reject} />
      <Text bold>{message}</Text>
      <Select options={options} onChange={resolve} />
    </Box>
  ));
}

// Text input — replaces inquirer's `input`.
export function askText(
  message: string,
  opts: { placeholder?: string; defaultValue?: string } = {},
): Promise<string> {
  return runPrompt<string>((resolve, reject) => (
    <Box>
      <CtrlCQuit reject={reject} />
      <Text color="cyan">{message} </Text>
      <TextInput placeholder={opts.placeholder} defaultValue={opts.defaultValue} onSubmit={resolve} />
    </Box>
  ));
}

// Confirm — replaces inquirer's `confirm`.
export function askConfirm(message: string, defaultChoice: 'confirm' | 'cancel' = 'confirm'): Promise<boolean> {
  return runPrompt<boolean>((resolve, reject) => (
    <Box>
      <CtrlCQuit reject={reject} />
      <Text color="cyan">{message} </Text>
      <ConfirmInput defaultChoice={defaultChoice} onConfirm={() => resolve(true)} onCancel={() => resolve(false)} />
    </Box>
  ));
}

// Spinner around async work — replaces ora for one-shot progress.
export async function withSpinner<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const { unmount } = render(<Spinner label={label} />);
  try {
    return await fn();
  } finally {
    unmount();
  }
}
