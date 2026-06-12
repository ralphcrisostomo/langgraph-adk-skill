// Minimal, dependency-free shell tokenizer shared by the bash and aws_cli safety
// classifiers. It is intentionally conservative: quoted segments collapse to a
// single token (surrounding quotes stripped, inner content preserved) and the
// common control operators become their own tokens. It is NOT a full shell
// parser — obfuscation that beats string classification (command substitution,
// base64, xargs, …) is contained by the *env* boundary in command-runtime.ts,
// not here.

// Control operators that reset "command position" (the next token starts a new
// simple command). Emitted as standalone tokens by `tokenize`.
export const SEPARATORS = new Set([';', '|', '||', '&&', '&', '(', ')']);

const OPERATOR_CHARS = new Set([';', '|', '&', '(', ')']);

export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let hasCur = false;
  const flush = () => {
    if (hasCur) {
      tokens.push(cur);
      cur = '';
      hasCur = false;
    }
  };

  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (ch === '$' && (input[i + 1] === "'" || input[i + 1] === '"')) {
      // ANSI-C ($'…') / locale ($"…") quoting: the shell drops the leading `$`,
      // so `$'rm'` runs `rm`. Skip the `$` and let the quote handler take the body,
      // otherwise an escaped-quoted command name slips past the classifiers.
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      hasCur = true; // an empty quoted string is still a real (empty) token
      while (i < input.length && input[i] !== quote) {
        cur += input[i];
        i++;
      }
      i++; // skip the closing quote
      continue;
    }
    if (ch === '\\') {
      // Unquoted backslash escapes the next char (the shell drops the backslash),
      // so "r\m" must tokenize to "rm" — otherwise an escaped command name slips
      // past the delete / raw-aws classifiers.
      i++;
      if (i < input.length) {
        cur += input[i];
        hasCur = true;
        i++;
      }
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      flush();
      i++;
      continue;
    }
    if (OPERATOR_CHARS.has(ch)) {
      flush();
      let op = ch;
      if ((ch === '&' || ch === '|') && input[i + 1] === ch) {
        op = ch + ch; // && or ||
        i++;
      }
      tokens.push(op);
      i++;
      continue;
    }
    cur += ch;
    hasCur = true;
    i++;
  }
  flush();
  return tokens;
}

// Strip a leading path so "/usr/local/bin/aws" and "./aws" both resolve to "aws".
export function stripPath(token: string): string {
  const slash = token.lastIndexOf('/');
  return slash === -1 ? token : token.slice(slash + 1);
}
