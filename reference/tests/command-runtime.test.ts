import { afterEach, test, expect } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { awsEnv, resolveCwd, runBash } from '../src/actions/command-runtime';

test('awsEnv drops EVERY ambient AWS_* source (creds, region, endpoint, role, container, config paths)', () => {
  const env = awsEnv({
    PATH: '/usr/bin',
    HOME: '/home/u',
    AWS_PROFILE: 'evil',
    AWS_ACCESS_KEY_ID: 'AKIA...',
    AWS_SECRET_ACCESS_KEY: 'secret',
    AWS_SESSION_TOKEN: 'token',
    AWS_REGION: 'eu-west-1',
    AWS_DEFAULT_REGION: 'eu-west-1',
    AWS_ENDPOINT_URL: 'http://evil.example',
    AWS_ENDPOINT_URL_S3: 'http://evil-s3.example',
    // credential SOURCES a denylist misses — these must be dropped too
    AWS_ROLE_ARN: 'arn:aws:iam::999:role/x',
    AWS_WEB_IDENTITY_TOKEN_FILE: '/tmp/token',
    AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/v2/creds',
    AWS_CONTAINER_CREDENTIALS_FULL_URI: 'http://169.254.170.2',
    // caller-controlled config paths could repoint the managed profile
    AWS_CONFIG_FILE: '/tmp/evil/config',
    AWS_SHARED_CREDENTIALS_FILE: '/tmp/evil/credentials',
  });
  expect(env.PATH).toBe('/usr/bin');
  expect(env.HOME).toBe('/home/u');
  for (const k of Object.keys(env)) {
    expect(k.startsWith('AWS_')).toBe(false);
  }
});

test('resolveCwd defaults to cwd and honors a CWD override', () => {
  const original = process.env.CWD;
  try {
    delete process.env.CWD;
    expect(resolveCwd()).toBe(process.cwd());
    process.env.CWD = '/some/where';
    expect(resolveCwd()).toBe('/some/where');
    process.env.CWD = '   ';
    expect(resolveCwd()).toBe(process.cwd());
  } finally {
    if (original === undefined) delete process.env.CWD;
    else process.env.CWD = original;
  }
});

// runBash uses `zsh -f`, so a startup file planted in the writable jail HOME
// (<tmpdir>/reference-bash-home) must NOT be sourced — otherwise hidden commands in
// it would run before the classified command and bypass the gate.
const jail = join(tmpdir(), 'reference-bash-home');
afterEach(() => {
  rmSync(join(jail, '.zshenv'), { force: true });
  rmSync(join(jail, 'SOURCED_MARKER'), { force: true });
});

test('runBash does not source .zshenv from the jailed HOME', async () => {
  mkdirSync(jail, { recursive: true });
  const marker = join(jail, 'SOURCED_MARKER');
  rmSync(marker, { force: true });
  writeFileSync(join(jail, '.zshenv'), `: > '${marker}'\n`);
  await runBash('echo hi');
  expect(existsSync(marker)).toBe(false); // -f prevented sourcing
});
