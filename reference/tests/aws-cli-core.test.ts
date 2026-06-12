import { test, expect } from 'bun:test';
import {
  isApproval,
  isReadCommand,
  isWriteCommand,
  serviceAndOperation,
  stripManagedFlags,
} from '../src/actions/aws-cli-core';
import { tokenize } from '../src/actions/shell-tokens';

const args = (cmd: string) => tokenize(cmd);
const classify = (cmd: string) => (isReadCommand(args(cmd)) ? 'read' : 'write');

test('read verbs classify as reads', () => {
  expect(classify('ec2 describe-instances')).toBe('read');
  expect(classify('iam list-users')).toBe('read');
  expect(classify('dynamodb get-item --table-name T --key {}')).toBe('read');
  expect(classify('sts get-caller-identity')).toBe('read');
  expect(classify('s3api get-object-acl --bucket b --key k')).toBe('read');
});

test('non-read operations fail safe to write', () => {
  expect(classify('ec2 run-instances --image-id ami-1')).toBe('write');
  expect(classify('lambda invoke out.json')).toBe('write');
  expect(classify('ec2 terminate-instances --instance-ids i-1')).toBe('write');
});

test('high-level s3: only `ls` is a read', () => {
  expect(classify('s3 ls')).toBe('read');
  expect(classify('s3 ls s3://bucket')).toBe('read');
  expect(classify('s3 cp a s3://bucket/b')).toBe('write');
  expect(classify('s3 sync . s3://bucket')).toBe('write');
  expect(classify('s3 rm s3://bucket/key')).toBe('write');
  expect(classify('s3 mb s3://bucket')).toBe('write');
});

test('s3api local-file writes are forced to write despite get-/select- prefix', () => {
  expect(classify('s3api get-object --bucket b --key k out.txt')).toBe('write');
  expect(classify('s3api select-object-content --bucket b --key k out.txt')).toBe('write');
  // ...but other s3api get-* that only print stay reads
  expect(classify('s3api get-bucket-policy --bucket b')).toBe('read');
});

test('isWriteCommand is the inverse of isReadCommand', () => {
  expect(isWriteCommand(args('s3 ls'))).toBe(false);
  expect(isWriteCommand(args('s3 rm s3://b/k'))).toBe(true);
});

test('stripManagedFlags removes value flags and their value token', () => {
  expect(stripManagedFlags(args('--profile evil ec2 describe-instances'))).toEqual([
    'ec2',
    'describe-instances',
  ]);
  expect(stripManagedFlags(args('--region us-west-1 s3 ls'))).toEqual(['s3', 'ls']);
  expect(stripManagedFlags(args('--endpoint-url http://evil s3 ls'))).toEqual(['s3', 'ls']);
  expect(stripManagedFlags(args('--output json ec2 describe-instances'))).toEqual([
    'ec2',
    'describe-instances',
  ]);
});

test('stripManagedFlags handles the --flag=value form', () => {
  expect(stripManagedFlags(args('--profile=evil ec2 describe-instances'))).toEqual([
    'ec2',
    'describe-instances',
  ]);
});

test('stripManagedFlags drops only the boolean flag, never the next token', () => {
  // --no-sign-request must NOT eat "s3"; the command must stay runnable.
  expect(stripManagedFlags(args('--no-sign-request s3 ls bucket'))).toEqual(['s3', 'ls', 'bucket']);
});

test('serviceAndOperation skips the value of a global value-flag', () => {
  const { service, operation } = serviceAndOperation(args('ec2 --query foo describe-instances'));
  expect(service).toBe('ec2');
  expect(operation).toBe('describe-instances');
});

test('isApproval accepts only explicit y/yes', () => {
  expect(isApproval('y')).toBe(true);
  expect(isApproval('YES')).toBe(true);
  expect(isApproval('  yes  ')).toBe(true);
  expect(isApproval('')).toBe(false);
  expect(isApproval('n')).toBe(false);
  expect(isApproval('sure')).toBe(false);
});
