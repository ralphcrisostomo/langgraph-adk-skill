/** @jsxImportSource react */
// Pin React JSX so the CLI transpiles correctly when run as a global bin from any
// directory — Bun resolves jsxImportSource from the launch cwd's tsconfig otherwise.
import { useCallback, useRef, useState } from 'react';
import { Box, Static, Text, useApp, useInput } from 'ink';
import { Spinner } from '@inkjs/ui';
import TextInput from 'ink-text-input';
import { contextBar, cwdLine, historyBudget, modelLine, QUIT_WORDS, trimHistory, usedTokens, type ChatMsg } from '../session-core';

// Helpers a responder can use mid-turn: stream a step line, or ask the human a question.
export interface RespondHelpers {
  onStep: (text: string) => void;
  ask: (question: string) => Promise<string>;
}

export interface SessionAppProps {
  contextWindow: number;
  // Model id shown in the footer's "Model:" line (ccstatusline-style).
  model: string;
  // One turn: given the running history, produce the assistant's reply text.
  respond: (messages: ChatMsg[], helpers: RespondHelpers) => Promise<string>;
  promptLabel?: string;
  intro?: string;
}

interface Line {
  id: number;
  kind: 'user' | 'assistant' | 'info' | 'step';
  text: string;
}

// Ink chat UI: history scrolls in <Static> above a pinned footer (context bar + input).
export function SessionApp({ contextWindow, model, respond, promptLabel = 'you', intro }: SessionAppProps) {
  const { exit } = useApp();
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('thinking…');
  const [pendingAsk, setPendingAsk] = useState<{ question: string } | null>(null);
  const askResolver = useRef<((v: string) => void) | null>(null);
  const history = useRef<ChatMsg[]>([]);
  const nextId = useRef(0);
  const budget = historyBudget(contextWindow);

  const push = (kind: Line['kind'], text: string) =>
    setLines((prev) => [...prev, { id: nextId.current++, kind, text }]);

  useInput((inputChar, key) => {
    if (key.ctrl && inputChar === 'c') exit();
  });

  const submitAnswer = useCallback((value: string) => {
    const resolve = askResolver.current;
    askResolver.current = null;
    setPendingAsk(null);
    setInput('');
    resolve?.(value.trim());
  }, []);

  const handleTurn = useCallback(
    async (value: string) => {
      const text = value.trim();
      setInput('');
      if (!text) return;
      if (QUIT_WORDS.has(text.toLowerCase())) {
        exit();
        return;
      }
      // /clear is a UI command — never sent to the model. Reset BOTH the
      // model-facing history ref (token count → 0) AND the rendered lines.
      // Ink <Static> writes permanently to stdout, so prior output stays in
      // terminal scrollback; this resets internal state, not the scrollback.
      if (text.toLowerCase() === '/clear') {
        history.current = [];
        setLines([]);
        push('info', 'context cleared');
        return;
      }

      push('user', text);
      history.current.push({ role: 'user', content: text });
      const { kept, dropped } = trimHistory(history.current, budget);
      if (dropped > 0) {
        history.current = kept;
        push('info', `…context full: dropped ${dropped} older message(s)`);
      }

      setBusy(true);
      setStatus('thinking…');
      const helpers: RespondHelpers = {
        onStep: (stepText) => {
          push('step', stepText);
          setStatus(stepText);
        },
        ask: (question) =>
          new Promise<string>((resolve) => {
            askResolver.current = resolve;
            setPendingAsk({ question });
          }),
      };

      try {
        const reply = await respond(history.current, helpers);
        history.current.push({ role: 'assistant', content: reply });
        push('assistant', reply);
      } catch (err) {
        history.current.pop();
        push('info', `error: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusy(false);
      }
    },
    [budget, exit, respond],
  );

  const used = usedTokens(history.current);
  const ratio = contextWindow > 0 ? used / contextWindow : 0;
  const barColor = ratio < 0.7 ? 'green' : ratio < 0.9 ? 'yellow' : 'red';
  const divider = '─'.repeat(process.stdout.columns ?? 80);

  return (
    <>
      <Static items={intro ? [{ id: -1, kind: 'info', text: intro } as Line, ...lines] : lines}>
        {(line) => (
          <Box key={line.id}>
            {line.kind === 'user' && (
              <Text color="cyan">
                {promptLabel} › {line.text}
              </Text>
            )}
            {line.kind === 'assistant' && (
              <Text>
                <Text bold>assistant › </Text>
                {line.text}
              </Text>
            )}
            {line.kind === 'step' && <Text dimColor>{'  '}{line.text}</Text>}
            {line.kind === 'info' && <Text dimColor>{line.text}</Text>}
          </Box>
        )}
      </Static>

      {/* Pinned footer (Claude Code-style): a SINGLE always-mounted TextInput framed
          above and below by a divider, then the status block (dir / model / context)
          pinned at the very bottom. The single input never loses raw-mode focus when
          the mode flips mid-turn — e.g. a write-approval prompt appearing while the
          agent is busy — with its prefix + submit handler routed by mode; when busy
          with no pending question a spinner sits to the left and submits are ignored.
          NOTE: do NOT split the input back into separate TextInput render branches — a
          freshly-mounted input swapped in mid-turn drops keystrokes in a real TTY,
          so the approval prompt can't be answered. */}
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>{divider}</Text>
        <Box>
          {pendingAsk ? (
            <Text color="magenta">🧑 {pendingAsk.question} </Text>
          ) : busy ? (
            <Box marginRight={1}><Spinner label={status} /></Box>
          ) : (
            <Text color="cyan">{promptLabel} › </Text>
          )}
          <TextInput
            value={input}
            onChange={setInput}
            onSubmit={pendingAsk ? submitAnswer : busy ? () => {} : handleTurn}
            placeholder={pendingAsk || busy ? '' : 'type a message — /clear to reset, /exit or Ctrl+C to quit'}
          />
        </Box>
        <Text dimColor>{divider}</Text>
        <Box flexDirection="column">
          <Text dimColor>{cwdLine()}</Text>
          <Text dimColor>{modelLine(model)}</Text>
          <Text color={barColor}>{contextBar(used, contextWindow)}</Text>
        </Box>
      </Box>
    </>
  );
}
