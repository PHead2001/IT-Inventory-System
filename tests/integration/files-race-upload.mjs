import { createClient } from '@supabase/supabase-js';
import authFixture from '../fixtures/auth.json' with { type: 'json' };

let client;
let path;
process.on('message', async (message) => {
  try {
    if (message?.type === 'prepare') {
      const url = new URL(process.env.LOCAL_API_URL);
      if (
        !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
        Number(url.port) !== 54321
      )
        throw new Error('Nonlocal Storage target');
      client = createClient(url.toString(), process.env.LOCAL_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const login = await client.auth.signInWithPassword({
        email: message.email,
        password: authFixture.password,
      });
      if (login.error) throw login.error;
      path = message.path;
      process.send({ type: 'ready' });
    } else if (message?.type === 'go' && client && path) {
      const bytes = Buffer.alloc(2 * 1048576, 0x20);
      Buffer.from('%PDF-').copy(bytes);
      const upload = client.storage
        .from('inventory-files')
        .upload(path, bytes, { contentType: 'application/pdf' });
      process.send({ type: 'started' });
      const result = await upload;
      process.send({ type: 'result', error: result.error?.message ?? null });
    } else if (message?.type === 'shutdown') {
      // Let the fetch transport drain/close after an early RLS denial before
      // the parent proceeds to another large Storage request.
      process.disconnect();
    } else {
      throw new Error('Invalid race helper phase');
    }
  } catch {
    process.send({ type: 'failure' });
  }
});
