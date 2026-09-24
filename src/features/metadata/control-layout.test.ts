import { describe, expect, it } from 'vitest';
import { controlLayoutStyle } from './control-layout';

describe('metadata control layout', () => {
  it('keeps explicit widths gap-aware and wraps below a usable minimum', () => {
    expect(controlLayoutStyle(6)).toMatchObject({
      flexBasis: 'max(min(100%, 14rem), calc(50.000000% - 0.375000rem))',
      minWidth: 'min(100%, 14rem)',
      maxWidth: '100%',
    });
    expect(controlLayoutStyle(12).flexBasis).toBe(
      'max(min(100%, 14rem), calc(100.000000% - 0.000000rem))',
    );
  });

  it('lets Auto grow in available space and short controls share a phone row', () => {
    expect(controlLayoutStyle('Auto')).toMatchObject({
      flexBasis: 'max(min(100%, 14rem), calc(33.333333% - 0.500000rem))',
      flexGrow: 1,
    });
    expect(controlLayoutStyle('Auto', true)).toMatchObject({
      flexBasis: 'max(min(100%, 5.5rem), calc(25.000000% - 0.562500rem))',
      minWidth: 'min(100%, 5.5rem)',
    });
    expect(controlLayoutStyle(4, true).flexBasis).toContain('33.333333%');
  });
});
