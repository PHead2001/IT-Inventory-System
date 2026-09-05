export function canHoldInventory(location: {
  active: boolean;
  can_hold_inventory: boolean;
}) {
  return location.active && location.can_hold_inventory;
}
