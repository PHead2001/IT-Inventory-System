// The actual server service uses real caller-scoped Storage and RPCs. Only
// delivery of a successfully committed confirmation response is lost.
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { cleanupTerminalFiles } from '../../src/features/files/cleanup.server';
import type { FileClient } from '../../src/features/files/rpc.server';
import authFixture from '../fixtures/auth.json' with { type: 'json' };

process.once(
  'message',
  async (input: {
    email: string;
    actorId: string;
    parentId: string;
    keyId: string;
    secret: string;
  }) => {
    try {
      const target = new URL(process.env.LOCAL_API_URL!);
      assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname));
      assert.equal(target.port, '54321');
      process.env.INVENTORY_FILE_KEYS_JSON = JSON.stringify({
        [input.keyId]: input.secret,
      });
      const client = createClient(target.href, process.env.LOCAL_ANON_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const login = await client.auth.signInWithPassword({
        email: input.email,
        password: authFixture.password,
      });
      assert.ifError(login.error);
      assert.equal(login.data.user?.id, input.actorId);
      let committed = 0;
      const serviceClient = {
        storage: client.storage,
        rpc: async (name: string, args: Record<string, unknown>) => {
          const response = await client.rpc(name, args);
          if (name === 'inventory_file_cleanup_confirm' && !response.error) {
            committed++;
            throw new Error(
              'Simulated lost response after real confirmation commit',
            );
          }
          return response;
        },
      } as unknown as FileClient;
      const result = await cleanupTerminalFiles(
        { client: serviceClient, userId: input.actorId },
        { parentType: 'asset', parentId: input.parentId },
      );
      process.send?.({ result, committed });
      await client.auth.signOut({ scope: 'local' });
    } catch {
      process.send?.({ failure: true });
      process.exitCode = 1;
    } finally {
      delete process.env.INVENTORY_FILE_KEYS_JSON;
      process.disconnect();
    }
  },
);
