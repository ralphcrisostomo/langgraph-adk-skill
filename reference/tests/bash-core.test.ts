import { test, expect } from 'bun:test';
import { tampersWithAwsEnv, containsRawAws, requestsDelete, shellEnv } from '../src/actions/bash-core';

test('non-delete commands pass through', () => {
  expect(requestsDelete('ls -la')).toBe(false);
  expect(requestsDelete('cat package.json')).toBe(false);
  expect(requestsDelete('rg delete src')).toBe(false); // "delete" is just an argument
  expect(requestsDelete('git status')).toBe(false);
});

test('delete operations are detected', () => {
  expect(requestsDelete('rm file')).toBe(true);
  expect(requestsDelete('rm -rf build')).toBe(true);
  expect(requestsDelete('/bin/rm file')).toBe(true);
  expect(requestsDelete('git rm tracked.ts')).toBe(true);
  expect(requestsDelete('docker rm container')).toBe(true);
  expect(requestsDelete('kubectl delete pod x')).toBe(true);
  expect(requestsDelete('find . -name "*.tmp" -delete')).toBe(true);
  expect(requestsDelete('echo done && rm tmp')).toBe(true);
  expect(requestsDelete('bash -c "rm secret"')).toBe(true); // nested
});

test('backslash-escaped command names still trip the delete gate', () => {
  // zsh strips the backslash and runs `rm`, so the classifier must too.
  expect(requestsDelete('r\\m -rf build')).toBe(true);
  expect(requestsDelete('bash -c "r\\m secret"')).toBe(true); // escaped + nested
});

test('ANSI-C quoted command names trip the delete gate', () => {
  // zsh runs $'rm' as `rm`.
  expect(requestsDelete("$'rm' -rf build")).toBe(true);
  expect(requestsDelete("bash -c \"$'rm' secret\"")).toBe(true); // quoted + nested
});

test('a value-taking interpreter option before -c does not hide the nested command', () => {
  expect(requestsDelete('bash -o pipefail -c "rm tmp"')).toBe(true);
});

test('a shell-expanded command name in command position requires approval', () => {
  // `$cmd` could be `rm`; we cannot know statically, so gate it.
  expect(requestsDelete('$cmd -rf build')).toBe(true);
  expect(requestsDelete('cmd=rm; $cmd -rf build')).toBe(true);
  expect(requestsDelete('`echo rm` -rf build')).toBe(true);
  expect(requestsDelete('bash -c "$cmd -rf build"')).toBe(true); // nested
  // ...but expansion only in ARGUMENTS of a known command is fine.
  expect(requestsDelete('cat $file')).toBe(false);
  expect(requestsDelete('rg $pattern src')).toBe(false);
});

test('raw aws invocation is rejected, including nested forms', () => {
  expect(containsRawAws('aws s3 ls')).toBe(true);
  expect(containsRawAws('aws s3 rm s3://prod/key')).toBe(true);
  expect(containsRawAws('/usr/local/bin/aws s3 ls')).toBe(true);
  expect(containsRawAws('AWS_PROFILE=other aws s3 rm s3://prod/key')).toBe(true);
  expect(containsRawAws('sudo aws s3 ls')).toBe(true);
  expect(containsRawAws('ls; aws s3 ls')).toBe(true);
  expect(containsRawAws('bash -lc "aws s3 rm s3://prod/key --profile other"')).toBe(true);
  expect(containsRawAws('sh -c "aws s3 ls"')).toBe(true);
  expect(containsRawAws('eval "aws s3 ls"')).toBe(true);
  expect(containsRawAws('timeout 5 bash -c "aws s3 ls"')).toBe(true);
});

test('aws hidden behind env/sudo/timeout options is still rejected', () => {
  // `env -i` rebuilds the environment, defeating the stripped-env boundary, so the
  // classifier must catch it. `-i` itself takes no value.
  expect(containsRawAws('env -i aws s3 ls')).toBe(true);
  expect(containsRawAws('env -i AWS_CONFIG_FILE=/tmp/c aws s3 rm s3://prod/key')).toBe(true);
  // value-taking wrapper options must not let the real command slip past.
  expect(containsRawAws('sudo -u root aws s3 ls')).toBe(true);
  expect(containsRawAws('timeout 5 aws s3 ls')).toBe(true);
  expect(containsRawAws('nice -n 5 aws s3 ls')).toBe(true);
  // backslash-escaped program name (zsh runs `aws`).
  expect(containsRawAws('a\\ws s3 ls')).toBe(true);
  // ANSI-C quoted program name (zsh runs `aws`).
  expect(containsRawAws("$'aws' s3 ls")).toBe(true);
  // value-taking interpreter option before -c (e.g. `-o pipefail`).
  expect(containsRawAws('bash -o pipefail -c "aws s3 ls"')).toBe(true);
});

test('long-form wrapper value-options do not hide the real command', () => {
  // Second Codex P1 finding: WRAPPER_VALUE_FLAGS only held the short forms. The walker
  // over `env --unset AWS_CONFIG_FILE aws s3 ls` did not skip `AWS_CONFIG_FILE`, so it
  // landed on `AWS_CONFIG_FILE` as the head and missed the real `aws`. Same containment
  // for sudo --user, nice --adjustment, timeout --kill-after, env --chdir, etc.
  expect(
    containsRawAws('env --unset AWS_CONFIG_FILE --unset AWS_SHARED_CREDENTIALS_FILE aws s3 ls'),
  ).toBe(true);
  // --flag=value (inline) form: value rides in the same token, so nothing extra to skip.
  expect(containsRawAws('env --unset=AWS_CONFIG_FILE aws s3 ls')).toBe(true);
  expect(containsRawAws('sudo --user root aws s3 ls')).toBe(true);
  expect(containsRawAws('sudo --chdir /tmp aws s3 ls')).toBe(true);
  expect(containsRawAws('nice --adjustment 5 aws s3 ls')).toBe(true);
  expect(containsRawAws('timeout --kill-after 5 timeout 3 aws s3 ls')).toBe(true);
  // Combined with shell expansion (covers the layered bypass).
  expect(containsRawAws('env --unset AWS_CONFIG_FILE $(echo aws) s3 ls')).toBe(true);
  // And the false-positive guard: a long-form value-flag does NOT swallow a real
  // command argument when the real program is a non-aws binary.
  expect(containsRawAws('env --chdir /tmp rg aws src')).toBe(false);
});

test('a shell-expanded command head is refused for raw AWS (could resolve to `aws`)', () => {
  // Codex review caught this bypass: `env -u` unsets the AWS_CONFIG_FILE / SHARED_CREDENTIALS_FILE
  // pins shellEnv set to /dev/null, and `$(echo aws)` puts a shell-expanded token in command
  // position so the literal-aws scan in commandHeads misses it. At runtime zsh expands the
  // head to `aws` and the CLI walks the user's real ~/.aws/config. Mirror requestsDelete:
  // any opaque head could be `aws`, so refuse.
  expect(
    containsRawAws('env -u AWS_CONFIG_FILE -u AWS_SHARED_CREDENTIALS_FILE $(echo aws) s3 ls'),
  ).toBe(true);
  expect(containsRawAws('$(echo aws) s3 ls')).toBe(true);
  expect(containsRawAws('`echo aws` s3 ls')).toBe(true);
  expect(containsRawAws('$cmd s3 ls')).toBe(true);
  // Nested form: the bypass hiding inside `bash -c "…"`.
  expect(containsRawAws('bash -c "$(echo aws) s3 ls"')).toBe(true);
});

test('wrapper / interpreter options do not over-reject aws used as a plain argument', () => {
  expect(containsRawAws('timeout 5 rg aws src')).toBe(false);
  expect(containsRawAws('sudo -u root rg aws src')).toBe(false);
  expect(containsRawAws('bash -o pipefail -c "rg aws src"')).toBe(false);
});

test('aws as a mere argument is NOT rejected', () => {
  expect(containsRawAws('rg aws src')).toBe(false);
  expect(containsRawAws('echo "deploy aws later"')).toBe(false);
  expect(containsRawAws('bash -c "rg aws src"')).toBe(false);
  expect(containsRawAws('cat aws-notes.txt')).toBe(false);
});

test('inline AWS_* assignments are rejected (they would re-point the AWS CLI)', () => {
  // The classic env-jail escape: re-point config at the real creds inline.
  expect(
    tampersWithAwsEnv('AWS_CONFIG_FILE=~/.aws/config AWS_SHARED_CREDENTIALS_FILE=~/.aws/credentials $cmd --profile other s3 ls'),
  ).toBe(true);
  expect(tampersWithAwsEnv('AWS_PROFILE=other aws s3 ls')).toBe(true);
  expect(tampersWithAwsEnv('bash -c "AWS_CONFIG_FILE=/tmp/c aws s3 ls"')).toBe(true); // nested
  // Non-AWS inline assignments are fine.
  expect(tampersWithAwsEnv('FOO=bar rg pattern src')).toBe(false);
  expect(tampersWithAwsEnv('ls -la')).toBe(false);
});

test('unsetting AWS_* env vars is rejected (it would arm a child process for ~/.aws fallback)', () => {
  // Third Codex P1 finding: a bash command that unsets the /dev/null pins, then
  // delegates to ANY interpreter (python, perl, node, sh, ruby) that calls `aws`
  // bypasses the string classifier — `aws` is never a head, the interpreter is. The
  // only correct defense is to refuse mutating AWS env at all so the pins survive
  // into every child.
  //   env -u short form, single and chained
  expect(tampersWithAwsEnv('env -u AWS_CONFIG_FILE python -c "import subprocess; subprocess.run([\\"aws\\",\\"s3\\",\\"ls\\"])"')).toBe(true);
  expect(tampersWithAwsEnv('env -u AWS_CONFIG_FILE -u AWS_SHARED_CREDENTIALS_FILE python -c "…"')).toBe(true);
  //   env --unset long form (space and inline)
  expect(tampersWithAwsEnv('env --unset AWS_CONFIG_FILE python -c "…"')).toBe(true);
  expect(tampersWithAwsEnv('env --unset=AWS_CONFIG_FILE python -c "…"')).toBe(true);
  //   `unset AWS_FOO` builtin, including after other names and via -v/-f options
  expect(tampersWithAwsEnv('unset AWS_CONFIG_FILE; python -c "…"')).toBe(true);
  expect(tampersWithAwsEnv('unset PATH AWS_CONFIG_FILE; cmd')).toBe(true);
  expect(tampersWithAwsEnv('unset -v AWS_CONFIG_FILE; cmd')).toBe(true);
  //   Nested in `bash -c "…"` / `eval "…"`
  expect(tampersWithAwsEnv('bash -c "env -u AWS_CONFIG_FILE python -c …"')).toBe(true);
  expect(tampersWithAwsEnv('eval "unset AWS_CONFIG_FILE; cmd"')).toBe(true);
  //   False-positive guards: unsetting NON-AWS vars is fine.
  expect(tampersWithAwsEnv('env -u PATH /usr/bin/python -c "…"')).toBe(false);
  expect(tampersWithAwsEnv('unset PATH FOO_BAR')).toBe(false);
  expect(tampersWithAwsEnv('env --unset=PATH cmd')).toBe(false);
});

test('shellEnv strips every inherited AWS_* and pins discovery at nothing', () => {
  const env = shellEnv({
    PATH: '/usr/bin',
    HOME: '/home/u',
    AWS_PROFILE: 'doki',
    AWS_ACCESS_KEY_ID: 'AKIA...',
    AWS_SECRET_ACCESS_KEY: 'secret',
    AWS_CONFIG_FILE: '/home/u/.aws/config',
  });
  expect(env.PATH).toBe('/usr/bin');
  expect(env.HOME).toBe('/home/u');
  expect(env.AWS_PROFILE).toBeUndefined();
  expect(env.AWS_ACCESS_KEY_ID).toBeUndefined();
  expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  expect(env.AWS_CONFIG_FILE).toBe('/dev/null');
  expect(env.AWS_SHARED_CREDENTIALS_FILE).toBe('/dev/null');
  expect(env.AWS_EC2_METADATA_DISABLED).toBe('true');
});

test('shellEnv allowlists: non-AWS secrets are dropped too', () => {
  const env = shellEnv({
    PATH: '/usr/bin',
    HOME: '/home/u',
    LC_ALL: 'en_US.UTF-8',
    OPENAI_API_KEY: 'sk-secret',
    ANTHROPIC_API_KEY: 'sk-ant',
    GH_TOKEN: 'ghp_x',
    SSH_AUTH_SOCK: '/tmp/agent',
    MY_APP_SECRET: 'shh',
  });
  expect(env.PATH).toBe('/usr/bin');
  expect(env.HOME).toBe('/home/u');
  expect(env.LC_ALL).toBe('en_US.UTF-8');
  for (const k of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GH_TOKEN', 'SSH_AUTH_SOCK', 'MY_APP_SECRET']) {
    expect(env[k]).toBeUndefined();
  }
});

test('shellEnv jails HOME when a home override is given', () => {
  const env = shellEnv({ HOME: '/Users/me', PATH: '/usr/bin' }, '/tmp/jail');
  expect(env.HOME).toBe('/tmp/jail');
  expect(env.PATH).toBe('/usr/bin');
});

test('delete: git clean / find -exec / subcommand-after-global-option', () => {
  expect(requestsDelete('git clean -fd')).toBe(true);
  expect(requestsDelete('git clean -fdx')).toBe(true);
  expect(requestsDelete('git -C . rm file')).toBe(true);
  expect(requestsDelete('kubectl -n default delete pod x')).toBe(true);
  expect(requestsDelete('docker --context prod rm c')).toBe(true);
  expect(requestsDelete("find . -name '*.tmp' -exec rm -f {} +")).toBe(true);
  expect(requestsDelete("find . -exec sh -c 'rm -f \"$1\"' sh {} ;")).toBe(true);
  // -delete anywhere is gated, even after an escaped -exec terminator that fragments
  // the find command across separators
  expect(requestsDelete('find . -delete')).toBe(true);
  expect(requestsDelete('find . -exec grep foo {} \\; -delete')).toBe(true);
  // false-positive guards
  expect(requestsDelete('git -C rm status')).toBe(false); // 'rm' is the -C value
  expect(requestsDelete('find . -exec grep foo {} +')).toBe(false);
});

test('delete: command substitution / env -S / git alias bodies', () => {
  expect(requestsDelete('echo $(rm -rf output)')).toBe(true);
  expect(requestsDelete('echo `rm -rf output`')).toBe(true);
  // quoted paren inside the substitution must not end it early
  expect(requestsDelete("echo $(printf ')' ; rm -rf build)")).toBe(true);
  expect(containsRawAws("echo $(printf ')' ; aws s3 ls)")).toBe(true);
  expect(requestsDelete("env -S 'rm -rf build'")).toBe(true);
  expect(requestsDelete("git -c alias.clean='!rm -rf build' clean")).toBe(true);
  expect(requestsDelete('echo $(date)')).toBe(false);
});

test('delete: newlines, brace/function bodies, compound blocks, redirections', () => {
  expect(requestsDelete('echo ok\nrm -rf build')).toBe(true);
  expect(requestsDelete('function clean { rm -rf build; }; clean')).toBe(true);
  expect(requestsDelete('f(){rm -rf build;}; f')).toBe(true); // compact, no space
  expect(requestsDelete('if true; then rm -rf build; fi')).toBe(true);
  expect(requestsDelete('for f in a b; do rm $f; done')).toBe(true);
  expect(requestsDelete('> /dev/null rm -rf build')).toBe(true); // leading redirect
  expect(requestsDelete('2>err.log rm -rf x')).toBe(true);
  // ${…} stays intact; redirect AFTER a non-delete head is fine
  expect(requestsDelete('cat ${HOME}/notes.txt')).toBe(false);
  expect(requestsDelete('echo hi > out.log')).toBe(false);
});

test('grouped short wrapper options (sudo -Eu root) do not hide the real command', () => {
  expect(containsRawAws('sudo -Eu root aws s3 ls')).toBe(true);
  expect(requestsDelete('sudo -Eu root rm -rf x')).toBe(true);
  expect(containsRawAws('sudo -u root aws s3 ls')).toBe(true); // ungrouped still works
  // attached value (`-uroot`) and a false-positive guard
  expect(containsRawAws('sudo -uroot rg aws src')).toBe(false);
  expect(containsRawAws('sudo -Eu root rg aws src')).toBe(false);
});

test('the time wrapper --format value does not hide the real command', () => {
  expect(containsRawAws("time --format '%E' aws s3 ls")).toBe(true);
  expect(requestsDelete("time --format '%E' rm x")).toBe(true);
  expect(requestsDelete('time rm x')).toBe(true); // bare time prefix
  expect(containsRawAws("time --format '%E' rg aws src")).toBe(false); // false-positive guard
});

test('delete: interpreters running opaque code/scripts are gated', () => {
  expect(requestsDelete("printf 'rm -rf build\\n' | sh")).toBe(true);
  expect(requestsDelete('bash deploy.sh')).toBe(true);
  expect(requestsDelete('python -c \'import os; os.remove("x")\'')).toBe(true);
  expect(requestsDelete('node -e \'require("fs").rmSync("x")\'')).toBe(true);
  expect(requestsDelete('bun run build')).toBe(true);
  // inspected -c / pure info invocations are not blindly gated
  expect(requestsDelete('bash -c "echo hi"')).toBe(false);
  expect(requestsDelete('python --version')).toBe(false);
  expect(requestsDelete('node -v')).toBe(false);
});

test('raw aws: substitution / env -S / find -exec / leading redirect / later line', () => {
  expect(containsRawAws('echo $(aws s3 ls)')).toBe(true);
  expect(containsRawAws('echo `aws s3 ls`')).toBe(true);
  expect(containsRawAws("env -S 'aws s3 ls'")).toBe(true);
  expect(containsRawAws("find . -exec sh -c 'aws s3 rm s3://p/$1' sh {} ;")).toBe(true);
  expect(containsRawAws('> /dev/null aws s3 ls')).toBe(true);
  expect(containsRawAws('echo ok\naws s3 ls')).toBe(true);
  expect(containsRawAws('function f { aws s3 ls; }; f')).toBe(true);
  // false-positive guards
  expect(containsRawAws('echo $(date)')).toBe(false);
  expect(containsRawAws('rg aws src > out.log')).toBe(false);
});

test('export/declare of an AWS_* var is rejected (it re-points child processes)', () => {
  expect(tampersWithAwsEnv('export AWS_CONFIG_FILE=/tmp/c')).toBe(true);
  expect(tampersWithAwsEnv('export AWS_CONFIG_FILE=/tmp/c; python -c "x"')).toBe(true);
  expect(tampersWithAwsEnv('declare -x AWS_PROFILE=other')).toBe(true);
  expect(tampersWithAwsEnv('readonly AWS_PROFILE=other')).toBe(true);
  expect(tampersWithAwsEnv('bash -c "export AWS_CONFIG_FILE=/tmp/c; aws s3 ls"')).toBe(true); // nested
  // false-positive guards: non-assignment-builtin and non-AWS exports are fine
  expect(tampersWithAwsEnv("rg 'AWS_PROFILE=' src")).toBe(false);
  expect(tampersWithAwsEnv('export PATH=/usr/bin')).toBe(false);
  expect(tampersWithAwsEnv('export FOO=bar')).toBe(false);
});

test('false-positive: AWS_* as an argument and here-doc bodies are not refused', () => {
  // AWS_* only counts as a leading assignment, not an argument
  expect(tampersWithAwsEnv("rg 'AWS_PROFILE=' src")).toBe(false);
  expect(tampersWithAwsEnv('echo AWS_PROFILE=other')).toBe(false);
  expect(tampersWithAwsEnv('AWS_PROFILE=other aws s3 ls')).toBe(true); // real leading still caught
  // here-doc bodies are data, not commands
  expect(requestsDelete("cat > notes.md <<'EOF'\nrm -rf build is dangerous\nEOF")).toBe(false);
  expect(containsRawAws("cat > notes.md <<'EOF'\nrun aws s3 ls to list\nEOF")).toBe(false);
  // a real command AFTER the here-doc still classifies
  expect(requestsDelete("cat > a <<'EOF'\nx\nEOF\nrm -rf build")).toBe(true);
  // tab-stripping `<<-` heredoc must close on its delimiter, not swallow the rest
  expect(requestsDelete('cat <<-EOF\nbody\nEOF\nrm -rf build')).toBe(true);
  expect(containsRawAws('cat <<-EOF\nbody\nEOF\naws s3 ls')).toBe(true);
  expect(requestsDelete('cat <<-EOF\nrm -rf build is just text\nEOF')).toBe(false);
});
