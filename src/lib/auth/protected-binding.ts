/** Captured from a verified protected server render, never from browser claims. */
export type ProtectedPrivacyBinding = {
  actorId: string;
  backend: string;
  role: string;
  canManageConfiguration: boolean;
};

export const protectedBindingKey = (binding: ProtectedPrivacyBinding) =>
  JSON.stringify([
    binding.actorId,
    binding.backend,
    binding.role,
    binding.canManageConfiguration,
  ]);
