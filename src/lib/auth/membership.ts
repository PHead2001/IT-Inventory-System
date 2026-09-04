export type Member = {
  user_id: string;
  display_name: string;
  role: string;
  active: boolean;
};
export function isActiveMember(member: Member | null): member is Member {
  return (
    member !== null &&
    member.active &&
    (member.role === 'viewer' || member.role === 'staff')
  );
}
export function mayMutateInventory(member: Member | null) {
  return isActiveMember(member) && member.role === 'staff';
}
