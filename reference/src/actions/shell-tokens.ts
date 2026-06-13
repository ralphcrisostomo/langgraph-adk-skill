// Minimal, dependency-free shell tokenizer shared by the bash and aws_cli safety
// classifiers. It mirrors what zsh actually RUNS (not the source text) closely
// enough to classify the command word of each simple command, so a delete or a raw
// `aws` can't hide behind quoting, escapes, substitutions, redirections, brace
// groups, here-docs, or line breaks. It is NOT a full shell parser — obfuscation
// that beats string classification (base64, xargs, a child interpreter that calls
// `aws`) is contained by the *env* boundary in command-runtime.ts / shellEnv, not
// here. The classifier is best-effort by design; the env jail is the real boundary.

// Control operators that reset "command position" (the next token starts a new
// simple command). `{` and `}` are included so a brace GROUP / function body
// (`{ rm; }`, even the compact `f(){rm;}`) parses as its own commands rather than
// folding the body into an argument of `function`/`{`. The tokenizer emits `{`/`}`
// at the character level; `${…}` parameter expansions are grouped beforehand so
// they are never split. Newlines are emitted as `;`.
export const SEPARATORS = new Set([';', '|', '||', '&&', '&', '(', ')', '{', '}']);

// Marker prefix for redirection operator tokens (`>`, `2>`, `&>`, `<<`, …). A
// leading redirect (`> /dev/null rm -rf x`) must not be mistaken for the command
// head, so the tokenizer emits these as marked tokens and the head walker skips
// them and their target. Written as the unicode escape (NOT a raw NUL byte) so the
// source stays text and diffs normally; a real command token never contains it.
export const REDIR = '\u0000';

// Strip a leading path so "/usr/local/bin/aws" and "./aws" both resolve to "aws".
export function stripPath(token: string): string {
  const slash = token.lastIndexOf('/');
  return slash === -1 ? token : token.slice(slash + 1);
}

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
  const add = (s: string) => {
    cur += s;
    hasCur = true;
  };
  const n = input.length;
  const pendingHeredocs: string[] = []; // delimiters of `<<DELIM` whose body follows
  let i = 0;
  while (i < n) {
    const ch = input[i]!;
    if (ch === ' ' || ch === '\t') {
      flush();
      i++;
      continue;
    }
    // A newline ends a command — emit `;` so a delete/aws on a later line isn't
    // folded into the first command's arguments. Then skip any pending here-doc
    // BODIES (data written to a file/stdin, NOT commands) up to their delimiter.
    if (ch === '\n' || ch === '\r') {
      flush();
      tokens.push(';');
      i++;
      while (pendingHeredocs.length > 0) {
        const delim = pendingHeredocs.shift()!;
        while (i < n) {
          let line = '';
          while (i < n && input[i] !== '\n' && input[i] !== '\r') {
            line += input[i]!;
            i++;
          }
          if (i < n) i++;
          if (line.trim() === delim) break; // closing delimiter (<<- allows leading tabs)
        }
      }
      continue;
    }
    // ANSI-C ($'…') / locale ($"…") quoting: the shell drops the leading `$`, so
    // `$'rm'` runs `rm`. Skip the `$` and let the quote handler take the body.
    if (ch === '$' && (input[i + 1] === "'" || input[i + 1] === '"')) {
      i++;
      continue;
    }
    // Command substitution $( … ) — keep grouped so the token retains its `$`
    // (drives the "opaque head" gate) and an inner `(`/`)` isn't read as a separator.
    // The depth scan must RESPECT QUOTES, else a quoted paren (`$(printf ')' ; rm …)`)
    // ends the substitution early and the trailing `rm` escapes the body re-check.
    if (ch === '$' && input[i + 1] === '(') {
      add('$(');
      i += 2;
      let depth = 1;
      while (i < n && depth > 0) {
        const c = input[i]!;
        if (c === "'" || c === '"') {
          add(c);
          i++;
          while (i < n && input[i] !== c) {
            add(input[i]!);
            i++;
          }
          if (i < n) {
            add(input[i]!);
            i++;
          }
          continue;
        }
        if (c === '(') depth++;
        else if (c === ')') depth--;
        add(c);
        i++;
      }
      continue;
    }
    // Parameter expansion ${ … } — keep grouped so `${VAR}` stays one token and a
    // bare `{`/`}` below can be treated as a brace-group separator without splitting it.
    // Quote-aware so a quoted `}` (`${x:-'}'}`) doesn't end it early.
    if (ch === '$' && input[i + 1] === '{') {
      add('${');
      i += 2;
      let depth = 1;
      while (i < n && depth > 0) {
        const c = input[i]!;
        if (c === "'" || c === '"') {
          add(c);
          i++;
          while (i < n && input[i] !== c) {
            add(input[i]!);
            i++;
          }
          if (i < n) {
            add(input[i]!);
            i++;
          }
          continue;
        }
        if (c === '{') depth++;
        else if (c === '}') depth--;
        add(c);
        i++;
      }
      continue;
    }
    // Backtick substitution — keep grouped so the token retains its backtick.
    if (ch === '`') {
      add('`');
      i++;
      while (i < n && input[i] !== '`') {
        add(input[i]!);
        i++;
      }
      if (i < n) {
        add('`');
        i++;
      }
      continue;
    }
    if (ch === "'") {
      hasCur = true; // an empty quoted string is still a real (empty) token
      i++;
      while (i < n && input[i] !== "'") {
        cur += input[i]!;
        i++;
      }
      if (i < n) i++; // closing quote
      continue;
    }
    if (ch === '"') {
      hasCur = true;
      i++;
      while (i < n && input[i] !== '"') {
        if (input[i] === '\\' && i + 1 < n) {
          cur += input[i + 1]!;
          i += 2;
          continue;
        }
        cur += input[i]!;
        i++;
      }
      if (i < n) i++; // closing quote
      continue;
    }
    if (ch === '\\') {
      // Unquoted backslash escapes the next char (the shell drops the backslash),
      // so "r\m" tokenizes to "rm". A backslash-newline is a line continuation (elided).
      if (i + 1 < n) {
        if (input[i + 1] === '\n') {
          i += 2;
          continue;
        }
        add(input[i + 1]!);
        i += 2;
      } else {
        i++;
      }
      continue;
    }
    // Redirections (`>`, `>>`, `>|`, `<`, `<<`, `<>`, `>&`, `&>`, `2>`, `2>&1`, …):
    // emit the operator as a marked token so a LEADING redirect (`> /dev/null rm`)
    // isn't taken as the head. Fold a pending all-digit fd prefix (the `2` of `2>`)
    // into the operator; the target file/fd is the next token (skipped by the walker).
    if (ch === '>' || ch === '<' || (ch === '&' && input[i + 1] === '>')) {
      let op = '';
      if (/^\d+$/.test(cur)) {
        op = cur;
        cur = '';
        hasCur = false;
      } else {
        flush();
      }
      while (i < n && '<>&|'.includes(input[i]!)) {
        op += input[i]!;
        i++;
      }
      // `<<-` (tab-stripping here-doc): the `-` isn't an operator char, so fold it in
      // explicitly — else the delimiter is read as `-EOF`, never closes, and the rest
      // of the script is swallowed as body (commands after it would skip the gate).
      if (op === '<<' && input[i] === '-') {
        op += '-';
        i++;
      }
      tokens.push(REDIR + op);
      // here-doc (`<<DELIM` / `<<-DELIM`): capture the delimiter word so its body
      // (lines until DELIM) is skipped as data, not tokenized as commands.
      if (op === '<<' || op === '<<-') {
        while (i < n && (input[i] === ' ' || input[i] === '\t')) i++;
        let delim = '';
        while (i < n && !' \t\n\r;|&<>()'.includes(input[i]!)) {
          const c = input[i]!;
          if (c === "'" || c === '"') {
            i++;
            while (i < n && input[i] !== c) {
              delim += input[i]!;
              i++;
            }
            if (i < n) i++;
            continue;
          }
          if (c === '\\') {
            i++;
            if (i < n) {
              delim += input[i]!;
              i++;
            }
            continue;
          }
          delim += c;
          i++;
        }
        if (delim) pendingHeredocs.push(delim);
      }
      continue;
    }
    if (ch === ';') {
      flush();
      tokens.push(';');
      i++;
      continue;
    }
    // Brace-group / function-body delimiters — emit even when abutting the next word
    // (zsh runs `f(){rm;}`), so `{rm` doesn't fold into one token. `${…}` is already
    // consumed above, so these are never parameter expansions.
    if (ch === '{') {
      flush();
      tokens.push('{');
      i++;
      continue;
    }
    if (ch === '}') {
      flush();
      tokens.push('}');
      i++;
      continue;
    }
    if (ch === '(') {
      flush();
      tokens.push('(');
      i++;
      continue;
    }
    if (ch === ')') {
      flush();
      tokens.push(')');
      i++;
      continue;
    }
    if (ch === '|') {
      flush();
      if (input[i + 1] === '|') {
        tokens.push('||');
        i += 2;
      } else {
        tokens.push('|');
        i++;
      }
      continue;
    }
    if (ch === '&') {
      flush();
      if (input[i + 1] === '&') {
        tokens.push('&&');
        i += 2;
      } else {
        tokens.push('&');
        i++;
      }
      continue;
    }
    add(ch);
    i++;
  }
  flush();
  return tokens;
}
