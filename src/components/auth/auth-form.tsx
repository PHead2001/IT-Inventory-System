'use client';
import { useActionState } from 'react';
import { login, recover, confirmAuth, setPassword } from '@/lib/auth/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { AuthState } from '@/lib/auth/schemas';
import { QueueLogoutForm } from '@/features/labels/queue-logout-form';
const actions = { login, recover, confirm: confirmAuth, password: setPassword };
export function AuthForm({
  mode,
  tokenHash,
  tokenType,
  next,
  emailedCompletion = false,
}: {
  mode: keyof typeof actions;
  tokenHash?: string;
  tokenType?: string;
  next?: string;
  emailedCompletion?: boolean;
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
  if (state.passwordUpdated)
    return (
      <div className="space-y-5">
        <p role="alert" className="experience-feedback" data-tone="error">
          {state.error}
        </p>
        <QueueLogoutForm />
      </div>
    );
  return (
    <form action={action} className="space-y-5 text-sm" aria-label={label}>
      {mode === 'login' && next && (
        <input type="hidden" name="next" value={next} />
      )}
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
      {mode === 'password' && !emailedCompletion && (
        <div className="space-y-2">
          <label htmlFor="current-password">Current password</label>
          <Input
            id="current-password"
            name="current_password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
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
          <p id="password-help" className="experience-muted text-sm">
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
        <p role="alert" className="experience-feedback" data-tone="error">
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="experience-feedback" data-tone="success">
          {state.message}
        </p>
      )}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Please wait…' : label}
      </Button>
    </form>
  );
}
