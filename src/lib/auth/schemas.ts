import { z } from 'zod';
export const emailSchema = z.string().trim().email().max(254);
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export const confirmationSchema = z.object({
  token_hash: z
    .string()
    .min(1)
    .max(2048)
    .regex(/^[A-Za-z0-9_-]+$/),
  type: z.enum(['invite', 'recovery']),
});
export const passwordSchema = z
  .object({
    password: z.string().min(12).max(128),
    confirmation: z.string(),
  })
  .refine((value) => value.password === value.confirmation, {
    message: 'Passwords must match',
    path: ['confirmation'],
  });
export type AuthState = {
  error?: string;
  message?: string;
  passwordUpdated?: boolean;
};
