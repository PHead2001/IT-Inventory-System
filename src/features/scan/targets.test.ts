import { describe, expect, it } from 'vitest';
import {
  assetLabelPath,
  locationLabelPath,
  parseScan,
  quantityLabelPath,
  validReturnPath,
  loginDestination,
} from './targets';
const origin = 'https://inventory.example.test';
const id = '7b84a7cf-197b-45b1-8016-87482d124cb4';
describe('label destinations', () => {
  it('accepts a bounded long bare serial without changing typed tag limits or unsafe parsing', () => {
    expect(parseScan('x'.repeat(200), origin)?.kind).toBe('bare');
    expect(parseScan('x'.repeat(201), origin)).toBeNull();
    expect(parseScan('AST:' + 'x'.repeat(101), origin)).toBeNull();
  });
  it('trims only pasted outer whitespace and preserves internal punctuation and zero padding', () => {
    expect(
      parseScan(' \r\n' + origin + quantityLabelPath(id) + '\n ', origin),
    ).toEqual(parseScan(origin + quantityLabelPath(id), origin));
    expect(parseScan('\t 0007-A/B \r\n', origin)).toEqual({
      kind: 'bare',
      identifier: '0007-A/B',
    });
    expect(parseScan('0007\nA/B', origin)).toBeNull();
    expect(parseScan(' '.repeat(1025) + 'ITC', origin)).toBeNull();
  });
  it('resolves stable identity without names or storage in the payload', () => {
    expect(parseScan(origin + locationLabelPath('ITC-S1A'), origin)).toEqual({
      kind: 'location',
      code: 'ITC-S1A',
      path: '/locations/ITC-S1A',
    });
    expect(parseScan(origin + assetLabelPath(id), origin)).toEqual({
      kind: 'asset',
      id,
      path: '/inventory/assets/' + id,
    });
    expect(parseScan(origin + quantityLabelPath(id), origin)).toEqual({
      kind: 'quantity',
      id,
      path: '/inventory/quantity/' + id,
    });
    expect(parseScan('LOC:ITC', origin)?.kind).toBe('location');
    expect(parseScan('AST:tag-001', origin)).toEqual({
      kind: 'tag',
      tag: 'tag-001',
    });
    expect(parseScan('AST:tag/a%b?#', origin)).toEqual({
      kind: 'tag',
      tag: 'tag/a%b?#',
    });
    expect(parseScan('München № 4', origin)).toEqual({
      kind: 'bare',
      identifier: 'München № 4',
    });
    expect(parseScan('ITC', origin)).toEqual({
      kind: 'bare',
      identifier: 'ITC',
    });
    expect(parseScan('😀'.repeat(100), origin)).toEqual({
      kind: 'bare',
      identifier: '😀'.repeat(100),
    });
  });
  it.each([
    'https://evil.test/locations/ITC',
    'https://inventory-commit.test/locations/ITC',
    '//inventory.example.test/locations/ITC',
    '/locations/ITC?status=all',
    '/inventory/assets/' + id + '#x',
    '/locations/%49TC',
    '/locations/ITC%2fS1',
    'https://inventory.example.test/locations/../locations/ITC',
    'https://user@inventory.example.test/locations/ITC',
    'https://inventory.example.test/locations/ITC?next=/inventory',
    'AST:' + 'x'.repeat(101),
    'javascript:alert(1)',
    'HTTP://inventory.example.test/locations/ITC',
    'LOC:ITC S1',
    'a'.repeat(1025),
  ])('rejects unsafe or unsupported text %s', (value) => {
    expect(parseScan(value, origin)).toBeNull();
  });
  it('accepts return only to canonical detail paths', () => {
    expect(validReturnPath('/locations/ITC')).toBe('/locations/ITC');
    expect(validReturnPath('/inventory/assets/' + id)).toBe(
      '/inventory/assets/' + id,
    );
    expect(validReturnPath('/inventory/quantity/' + id)).toBe(
      '/inventory/quantity/' + id,
    );
    expect(validReturnPath('/scan')).toBeNull();
    expect(
      validReturnPath('https://inventory.example.test/locations/ITC'),
    ).toBeNull();
  });
  it('allows the exact Overview login return without turning it into a label target', () => {
    expect(validReturnPath('/dashboard')).toBe('/dashboard');
    expect(parseScan('/dashboard', origin)).toBeNull();
  });
  it.each([
    [undefined, '/inventory'],
    [null, '/inventory'],
    ['', '/inventory'],
    ['https://evil.test', '/inventory'],
    ['//evil.test', '/inventory'],
    ['/dashboard?next=https://evil.test', '/inventory'],
    ['/login', '/inventory'],
    ['/dashboard', '/dashboard'],
    ['/locations/ITC', '/locations/ITC'],
  ])('uses one safe login landing for %s', (next, expected) => {
    expect(loginDestination(next)).toBe(expected);
  });
  it.each([
    '/dashboard/',
    '/dashboard/settings',
    '/dashboard?next=https://evil.test',
    '/dashboard#https://evil.test',
    '/dashboard.evil.test',
    '//dashboard',
    'https://inventory.example.test/dashboard',
    '/%64ashboard',
    '/dashboard%2f',
    '/dashboard\\evil.test',
    ' /dashboard',
    ['/dashboard'],
  ])('rejects noncanonical Overview return %s', (value) => {
    expect(validReturnPath(value)).toBeNull();
  });
});

it('accepts 200 supplementary bare serial characters while keeping AST and return destinations unchanged', () => {
  const serial = '😀'.repeat(200);
  expect(
    parseScan(' \t' + serial + '\n ', 'https://inventory.example.test'),
  ).toEqual({ kind: 'bare', identifier: serial });
  expect(parseScan(serial + '😀', 'https://inventory.example.test')).toBeNull();
  expect(
    parseScan('AST:' + serial, 'https://inventory.example.test'),
  ).toBeNull();
  expect(validReturnPath(serial)).toBeNull();
});
