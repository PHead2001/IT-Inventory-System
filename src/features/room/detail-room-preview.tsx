import 'server-only';
import type { LocationRef } from '../inventory/contracts-ui';
import { DetailRoomPreviewClient } from './detail-room-preview-client';
import { hasModeledRoomBinding } from './room-map-model';
import { ShowInRoom } from './show-in-room';

/** Resolve canonical geometry capability on the server, before the optional
 * client region. The eager client receives flags and rendered navigation only. */
export function DetailRoomPreview({
  locations,
  choices,
  context,
  showRoomLink = true,
}: {
  locations: LocationRef[];
  choices: { code: string; label: string }[];
  context?: string;
  showRoomLink?: boolean;
}) {
  return (
    <DetailRoomPreviewClient
      locations={locations}
      context={context}
      choices={choices.map((choice) => {
        const location = locations.find((entry) => entry.code === choice.code);
        return {
          ...choice,
          modeled: Boolean(
            location && hasModeledRoomBinding(locations, choice.code),
          ),
          roomLink:
            showRoomLink && location ? (
              <ShowInRoom location={location} />
            ) : undefined,
        };
      })}
    />
  );
}
