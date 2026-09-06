import { npm, localStatus } from './runtime.mjs';
import { seedUsers } from './fixtures.mjs';
try {
  const status = localStatus();
  await seedUsers(status);
  const env = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
    // Deliberately differs from Supabase Site URL to exercise preview email redirects.
    APP_ORIGIN: 'http://127.0.0.1:3000',
    APP_ENV: 'local',
    LOCAL_API_URL: status.API_URL,
    LOCAL_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
  };
  // Public environment values are build inputs. Never reuse a build from another backend.
  npm(['run', 'build'], { env });
  npm(['exec', '--', 'playwright', 'test', ...process.argv.slice(2)], { env });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
