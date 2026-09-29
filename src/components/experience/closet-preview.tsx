import room from '../../../data/rooms/it-closet.json';

type Vec3 = [number, number, number];
type RoomNode = {
  id: string;
  position: Vec3;
  rotationZDegrees?: number;
  size?: Vec3;
  children?: RoomNode[];
};
type Fixture = { id: string; position: Vec3; rotation: number; size: Vec3 };

function flatten(
  nodes: RoomNode[],
  origin: Vec3 = [0, 0, 0],
  parentRotation = 0,
): Fixture[] {
  return nodes.flatMap((node) => {
    const c = Math.cos(parentRotation);
    const s = Math.sin(parentRotation);
    const [x, y, z] = node.position;
    const position: Vec3 = [
      origin[0] + x * c - y * s,
      origin[1] + x * s + y * c,
      origin[2] + z,
    ];
    const rotation =
      parentRotation + ((node.rotationZDegrees ?? 0) * Math.PI) / 180;
    const children = flatten(node.children ?? [], position, rotation);
    return node.size
      ? [{ id: node.id, position, rotation, size: node.size }, ...children]
      : children;
  });
}

function point(x: number, y: number, z: number) {
  return `${(180 + (x - y) * 1.15).toFixed(1)},${(50 + (x + y) * 0.48 - z * 0.68).toFixed(1)}`;
}

function faces(node: Fixture) {
  const [x, y, z] = node.position;
  const [w, d, h] = node.size;
  const c = Math.cos(node.rotation);
  const s = Math.sin(node.rotation);
  const corner = (dx: number, dy: number, dz: number) =>
    point(x + dx * c - dy * s, y + dx * s + dy * c, z + dz);
  return {
    top: [
      corner(-w / 2, -d / 2, h / 2),
      corner(w / 2, -d / 2, h / 2),
      corner(w / 2, d / 2, h / 2),
      corner(-w / 2, d / 2, h / 2),
    ],
    front: [
      corner(-w / 2, -d / 2, -h / 2),
      corner(w / 2, -d / 2, -h / 2),
      corner(w / 2, -d / 2, h / 2),
      corner(-w / 2, -d / 2, h / 2),
    ],
    side: [
      corner(w / 2, -d / 2, -h / 2),
      corner(w / 2, d / 2, -h / 2),
      corner(w / 2, d / 2, h / 2),
      corner(w / 2, -d / 2, h / 2),
    ],
  };
}

const fixtures = flatten(room.nodes as unknown as RoomNode[])
  .filter(
    (node) =>
      /^shelf-[1-4][abc]$/.test(node.id) ||
      /^drawer-\d+$/.test(node.id) ||
      node.id === 'server-rack',
  )
  .sort(
    (a, b) => a.position[0] + a.position[1] - b.position[0] - b.position[1],
  );

export function ClosetPreview() {
  const [width, depth] = room.dimensions;
  return (
    <svg
      viewBox="0 0 360 180"
      role="img"
      aria-labelledby="closet-preview-title"
      aria-describedby="closet-preview-description"
    >
      <title id="closet-preview-title">IT closet spatial preview</title>
      <desc id="closet-preview-description">
        Static illustration derived from the measured closet floor, shelf
        sections, drawers and server rack. Open Spaces and maps for the
        interactive room.
      </desc>
      <defs>
        <linearGradient id="closet-floor" x2="1" y2="1">
          <stop stopColor="#193f55" />
          <stop offset="1" stopColor="#0a1b2d" />
        </linearGradient>
      </defs>
      <polygon
        points={[
          point(0, 0, 0),
          point(width, 0, 0),
          point(width, depth, 0),
          point(0, depth, 0),
        ].join(' ')}
        fill="url(#closet-floor)"
        stroke="#50def2"
        strokeOpacity=".5"
        strokeWidth="1.3"
      />
      {fixtures.map((node) => {
        const shape = faces(node);
        const rack = node.id === 'server-rack';
        const drawer = node.id.startsWith('drawer-');
        return (
          <g
            key={node.id}
            data-fixture={node.id}
            stroke="#9bebfa"
            strokeOpacity={rack ? '.9' : '.6'}
            strokeWidth={rack ? '1' : '.55'}
            strokeLinejoin="round"
          >
            <polygon
              points={shape.front.join(' ')}
              fill={rack ? '#14516b' : drawer ? '#143c54' : '#245c74'}
            />
            <polygon
              points={shape.side.join(' ')}
              fill={rack ? '#0b3048' : drawer ? '#0d2d44' : '#17445d'}
            />
            <polygon
              points={shape.top.join(' ')}
              fill={rack ? '#3db9d0' : drawer ? '#2d7992' : '#57abc0'}
            />
          </g>
        );
      })}
      <path d="M26 167h40" stroke="#50def2" strokeWidth="1.5" />
      <text x="26" y="161" fill="#b7d2e0" fontSize="8" letterSpacing="1.4">
        IT CLOSET
      </text>
    </svg>
  );
}
