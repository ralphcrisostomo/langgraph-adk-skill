import { test, expect } from 'bun:test';
import { awsEnv } from '../src/actions/command-runtime';

test('awsEnv drops ambient credentials, profile, region, and endpoint overrides', () => {
  const env = awsEnv({
    PATH: '/usr/bin',
    AWS_PROFILE: 'evil',
    AWS_ACCESS_KEY_ID: 'AKIA...',
    AWS_SECRET_ACCESS_KEY: 'secret',
    AWS_SESSION_TOKEN: 'token',
    AWS_REGION: 'eu-west-1',
    AWS_DEFAULT_REGION: 'eu-west-1',
    AWS_ENDPOINT_URL: 'http://evil.example',
    AWS_ENDPOINT_URL_S3: 'http://evil-s3.example',
  });
  expect(env.PATH).toBe('/usr/bin');
  expect(env.AWS_PROFILE).toBeUndefined();
  expect(env.AWS_ACCESS_KEY_ID).toBeUndefined();
  expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  expect(env.AWS_SESSION_TOKEN).toBeUndefined();
  expect(env.AWS_REGION).toBeUndefined();
  expect(env.AWS_DEFAULT_REGION).toBeUndefined();
  expect(env.AWS_ENDPOINT_URL).toBeUndefined();
  expect(env.AWS_ENDPOINT_URL_S3).toBeUndefined();
});

test('awsEnv keeps config-file locations so the pinned profile resolves', () => {
  const env = awsEnv({
    AWS_CONFIG_FILE: '/home/u/.aws/config',
    AWS_SHARED_CREDENTIALS_FILE: '/home/u/.aws/credentials',
  });
  expect(env.AWS_CONFIG_FILE).toBe('/home/u/.aws/config');
  expect(env.AWS_SHARED_CREDENTIALS_FILE).toBe('/home/u/.aws/credentials');
});
