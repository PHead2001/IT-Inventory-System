import rawRoom from '../../../data/rooms/it-closet.json';
import { roomSchema } from './schema';
// Intentionally independent of Supabase, including during next build.
export function loadItCloset() {
  return roomSchema.parse(rawRoom);
}
