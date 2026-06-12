import { test, expect } from 'bun:test';
import { assignsAwsEnv, containsRawAws, requestsDelete, shellEnv } from '../src/actions/bash-core';

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
    assignsAwsEnv('AWS_CONFIG_FILE=~/.aws/config AWS_SHARED_CREDENTIALS_FILE=~/.aws/credentials $cmd --profile other s3 ls'),
  ).toBe(true);
  expect(assignsAwsEnv('AWS_PROFILE=other aws s3 ls')).toBe(true);
  expect(assignsAwsEnv('bash -c "AWS_CONFIG_FILE=/tmp/c aws s3 ls"')).toBe(true); // nested
  // Non-AWS inline assignments are fine.
  expect(assignsAwsEnv('FOO=bar rg pattern src')).toBe(false);
  expect(assignsAwsEnv('ls -la')).toBe(false);
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
