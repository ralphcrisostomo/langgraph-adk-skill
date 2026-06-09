import { useCallback, useRef, useState } from 'react';
import { Box, Static, Text, useApp, useInput } from 'ink';
import { Spinner } from '@inkjs/ui';
import TextInput from 'ink-text-input';
import { contextBar, historyBudget, modelLine, QUIT_WORDS, trimHistory, usedTokens, type ChatMsg } from '../session-core';

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

      {/* Pinned footer: input/spinner above, context bar pinned at the very bottom. */}
      <Box flexDirection="column" marginTop={1}>
        {pendingAsk ? (
          <Box>
            <Text color="magenta">🧑 {pendingAsk.question} </Text>
            <TextInput value={input} onChange={setInput} onSubmit={submitAnswer} />
          </Box>
        ) : busy ? (
          <Spinner label={status} />
        ) : (
          <Box>
            <Text color="cyan">{promptLabel} › </Text>
            <TextInput
              value={input}
              onChange={setInput}
              onSubmit={handleTurn}
              placeholder="type a message — /exit or Ctrl+C to quit"
            />
          </Box>
        )}
        <Text dimColor>{modelLine(model)}</Text>
        <Text color={barColor}>{contextBar(used, contextWindow)}</Text>
      </Box>
    </>
  );
}
