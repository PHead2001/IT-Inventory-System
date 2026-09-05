'use client';
import { useActionState } from 'react';
import { login, recover, confirmAuth, setPassword } from '@/lib/auth/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { AuthState } from '@/lib/auth/schemas';
const actions = { login, recover, confirm: confirmAuth, password: setPassword };
export function AuthForm({
  mode,
  tokenHash,
  tokenType,
}: {
  mode: keyof typeof actions;
  tokenHash?: string;
  tokenType?: string;
}) {
  const [state, action, pending] = useActionState<AuthState, FormData>(
    actions[mode],
    {},
  );
  const label = {
    login: 'Sign in',
    recover: 'Send reset email',
    confirm: 'Continue securely',
    password: 'Set password',
  }[mode];
  return (
    <form action={action} className="space-y-5" aria-label={label}>
      {(mode === 'login' || mode === 'recover') && (
        <div className="space-y-2">
          <label htmlFor="email">Email</label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
          />
        </div>
      )}
      {(mode === 'login' || mode === 'password') && (
        <div className="space-y-2">
          <label htmlFor="password">Password</label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={
              mode === 'login' ? 'current-password' : 'new-password'
            }
            required
            minLength={mode === 'password' ? 12 : 1}
            maxLength={128}
            aria-describedby={mode === 'password' ? 'password-help' : undefined}
          />
        </div>
      )}
      {mode === 'password' && (
        <>
          <p id="password-help" className="text-sm text-slate-400">
            Use at least 12 characters.
          </p>
          <div className="space-y-2">
            <label htmlFor="confirmation">Confirm password</label>
            <Input
              id="confirmation"
              name="confirmation"
              type="password"
              autoComplete="new-password"
              required
              maxLength={128}
            />
          </div>
        </>
      )}
      {mode === 'confirm' && (
        <>
          <input type="hidden" name="token_hash" value={tokenHash ?? ''} />
          <input type="hidden" name="type" value={tokenType ?? ''} />
        </>
      )}
      {state.error && (
        <p role="alert" className="text-sm text-red-300">
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="text-sm text-cyan-200">
          {state.message}
        </p>
      )}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Please wait…' : label}
      </Button>
    </form>
  );
}
