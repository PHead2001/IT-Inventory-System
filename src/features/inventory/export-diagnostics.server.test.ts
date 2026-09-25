import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createExportDiagnostics } from './export-diagnostics.server';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('preview export diagnostic startup', () => {
  it('fails closed when generating its anonymous ID fails', () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('EXPORT_DIAGNOSTICS_ENABLED', 'true');
    expect(
      createExportDiagnostics(() => {
        throw new Error('ID source unavailable');
      }),
    ).toBeNull();
  });

  it('does not request an ID outside explicit preview opt-in', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('EXPORT_DIAGNOSTICS_ENABLED', 'true');
    const generateId = vi.fn();
    expect(createExportDiagnostics(generateId)).toBeNull();
    expect(generateId).not.toHaveBeenCalled();
  });
});
