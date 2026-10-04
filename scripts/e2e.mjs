import { npm, localStatus } from './runtime.mjs';
import { seedUsers } from './fixtures.mjs';
import {
  installLocalFileKey,
  retireLocalFileKey,
} from './file-key-fixture.mjs';
let fileKey = null;
let fileStatus = null;
try {
  const playwrightArgs = process.argv.slice(2);
  // The telemetry spec needs the same server-side Preview opt-in as the hosted
  // feature. Keep ordinary focused E2E runs in the default, disabled state.
  const testTelemetry =
    playwrightArgs.length === 0 ||
    playwrightArgs.some((argument) => argument.includes('telemetry'));
  const status = localStatus();
  fileStatus = status;
  await seedUsers(status);
  fileKey = await installLocalFileKey(status);
  const env = {
    ...process.env,
    // Focused invocations keep their exact selection and avoid project dependencies.
    E2E_FULL_SUITE: playwrightArgs.length === 0 ? '1' : '0',
    NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
    // Deliberately differs from Supabase Site URL to exercise preview email redirects.
    APP_ORIGIN: 'http://127.0.0.1:3000',
    APP_ENV: 'local',
    LOCAL_API_URL: status.API_URL,
    LOCAL_DB_URL: status.DB_URL,
    LOCAL_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
    VERCEL_ENV: testTelemetry ? 'preview' : 'development',
    SPEED_INSIGHTS_ENABLED: testTelemetry ? 'true' : 'false',
    INVENTORY_FILE_KEYS_JSON: JSON.stringify({
      [fileKey.keyId]: fileKey.secret,
    }),
  };
  // Public environment values are build inputs. Never reuse a build from another backend.
  npm(['run', 'build'], { env });
  npm(['exec', '--', 'playwright', 'test', ...playwrightArgs], { env });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (fileKey && fileStatus) {
    try {
      await retireLocalFileKey(fileStatus, fileKey.keyId);
    } catch {
      console.error('Local file signing key could not be retired.');
      process.exitCode = 1;
    }
  }
}
