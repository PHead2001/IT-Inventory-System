import { z } from 'zod';

export const locationCodeSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/);
const finite = z.number().finite();
const vector = z.tuple([finite, finite, finite]);
const size = z.tuple([finite.positive(), finite.positive(), finite.positive()]);
const limits = z
  .tuple([finite, finite])
  .refine(([min, max]) => min < max, 'Limits must increase');

const roomNodeFields = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  kind: z.enum(['group', 'box']),
  position: vector,
  rotationZDegrees: finite,
  size: size.optional(),
  locationCode: locationCodeSchema.optional(),
  measuredTopElevation: finite.nonnegative().optional(),
  visual: z
    .strictObject({
      style: z
        .enum(['shelf-section', 'drawer', 'rack', 'container', 'shelving'])
        .optional(),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      opacity: finite.min(0).max(1),
      edges: z.boolean(),
      reveal: z
        .strictObject({
          offset: z.tuple([
            finite.min(-24).max(24),
            finite.min(-24).max(24),
            finite.min(-24).max(24),
          ]),
        })
        .optional(),
    })
    .optional(),
  interaction: z
    .strictObject({
      selectable: z.boolean(),
      primaryBinding: z.boolean(),
      label: z.string().trim().min(1),
      focusPoint: vector,
      labelAnchor: vector.optional(),
      hitBox: z.strictObject({ center: vector, size }).optional(),
    })
    .optional(),
});
export type RoomNode = z.infer<typeof roomNodeFields> & {
  children?: RoomNode[];
};
export const roomNodeSchema: z.ZodType<RoomNode> = roomNodeFields
  .extend({
    children: z.lazy(() => z.array(roomNodeSchema)).optional(),
  })
  .superRefine((node, ctx) => {
    if (node.kind !== 'box' && node.visual?.reveal !== undefined)
      ctx.addIssue({
        code: 'custom',
        path: ['visual', 'reveal'],
        message: 'Only boxes support visual reveal metadata',
      });
  });

export const roomSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    roomId: z.string().regex(/^[a-z][a-z0-9-]*$/),
    locationCode: locationCodeSchema,
    units: z.literal('in'),
    coordinateSystem: z.literal('x-right-y-back-z-up'),
    dimensions: size,
    geometryBasis: z.strictObject({
      room: z.literal('measured'),
      doorOpening: z.literal('measured'),
      rack: z.literal('measured'),
      shelving: z.literal('measured'),
      sections: z.literal('measured'),
      drawers: z.literal('measured'),
      containerDimensions: z.literal('measured'),
      containerXY: z.literal('visual-default'),
      doorHinge: z.literal('visual-default'),
      shelfThickness: z.literal('visual-default'),
      drawerOrdering: z.literal('assumption'),
    }),
    visualDefaults: z.strictObject({ shelfThickness: finite.positive() }),
    assumptions: z.strictObject({ drawerOrdering: z.string().min(1) }),
    envelope: z.strictObject({
      wallThickness: finite.positive(),
      showCeiling: z.boolean(),
      frontWallMode: z.enum(['cutaway', 'solid']),
    }),
    openings: z.array(
      z.strictObject({
        id: z.string().min(1),
        wall: z.enum(['front', 'back', 'left', 'right']),
        offset: finite.nonnegative(),
        width: finite.positive(),
        height: finite.positive(),
        door: z.strictObject({
          hinge: z.enum(['left', 'right']),
          swing: z.literal('inward'),
          openAngleDegrees: finite.min(0).max(180),
        }),
      }),
    ),
    rackFaceProfiles: z.array(
      z.strictObject({
        id: z.string().min(1),
        width: finite.positive(),
        height: finite.positive(),
      }),
    ),
    camera: z.strictObject({
      projection: z.literal('orthographic'),
      target: vector,
      azimuthDegrees: finite,
      elevationDegrees: finite,
      azimuthLimitsDegrees: limits,
      elevationLimitsDegrees: limits,
      zoomLimits: z
        .tuple([finite.positive(), finite.positive()])
        .refine(([a, b]) => a < b),
      fitPadding: finite.min(1),
    }),
    nodes: z.array(roomNodeSchema).min(1),
  })
  .superRefine((room, ctx) => {
    const ids = new Set<string>();
    const primary = new Set<string>();
    const visit = (nodes: RoomNode[], depth = 0) => {
      if (depth > 16) {
        ctx.addIssue({ code: 'custom', message: 'Node hierarchy is too deep' });
        return;
      }
      for (const node of nodes) {
        if (ids.has(node.id))
          ctx.addIssue({
            code: 'custom',
            message: 'Duplicate node ID: ' + node.id,
          });
        ids.add(node.id);
        if (node.kind === 'box' && (!node.size || node.children))
          ctx.addIssue({
            code: 'custom',
            message: 'Boxes require size and cannot contain children',
          });
        if (node.kind === 'group' && (!node.children?.length || node.size))
          ctx.addIssue({
            code: 'custom',
            message: 'Groups require children and cannot have size',
          });
        if (node.kind === 'group' && node.interaction?.selectable)
          ctx.addIssue({
            code: 'custom',
            message:
              'Groups cannot be directly selectable; select aggregate locations through the location picker',
          });
        if (node.interaction && !node.locationCode)
          ctx.addIssue({
            code: 'custom',
            message: 'Interactive nodes require a location code',
          });
        if (node.interaction?.primaryBinding) {
          if (!node.interaction.selectable)
            ctx.addIssue({
              code: 'custom',
              message: 'Primary bindings must be selectable',
            });
          if (primary.has(node.locationCode!))
            ctx.addIssue({
              code: 'custom',
              message: 'Duplicate primary binding',
            });
          primary.add(node.locationCode!);
        }
        if (node.children) visit(node.children, depth + 1);
      }
    };
    visit(room.nodes);
    for (const opening of room.openings) {
      const span =
        opening.wall === 'front' || opening.wall === 'back'
          ? room.dimensions[0]
          : room.dimensions[1];
      if (
        opening.offset + opening.width > span ||
        opening.height > room.dimensions[2]
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Opening exceeds room dimensions',
        });
    }
    const c = room.camera;
    if (
      c.azimuthDegrees < c.azimuthLimitsDegrees[0] ||
      c.azimuthDegrees > c.azimuthLimitsDegrees[1] ||
      c.elevationDegrees < c.elevationLimitsDegrees[0] ||
      c.elevationDegrees > c.elevationLimitsDegrees[1]
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Initial camera exceeds limits',
      });
  });
export type RoomDefinition = z.infer<typeof roomSchema>;
