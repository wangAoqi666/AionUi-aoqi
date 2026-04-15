import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getDefaultLogDir } from '../../../src/common/config/appPathConfig';

/**
 * The inline auto-registered platform services in index.ts use a dynamic
 * `require('electron')` call that cannot be intercepted by Vitest mocks.
 * The actual getLogsDir fallback logic is tested through
 * ElectronPlatformServices.test.ts (same pattern).
 *
 * This test verifies that the inline implementation in index.ts contains
 * the required shared log-dir helper — guarding against regressions where
 * the inline path diverges from ElectronPlatformServices.
 */
describe('inline platform services getLogsDir fallback', () => {
  const indexSource = fs.readFileSync(path.resolve(__dirname, '../../../src/common/platform/index.ts'), 'utf-8');

  it('uses the shared log-dir helper in the inline path', () => {
    expect(indexSource).toContain("getDefaultLogDir(app.getPath('home'), app.isPackaged)");
  });

  it('shared log-dir helper produces the expected dev path', () => {
    expect(getDefaultLogDir('/Users/test', false)).toBe('/Users/test/Library/Logs/agent-factory-dev');
  });
});
