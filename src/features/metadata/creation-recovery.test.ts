import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  creationRecoveryLimits,
  parseCreationEnvelope,
  pendingCreations,
  readCreation,
  writeCreation,
  type CreationEnvelope,
} from './creation-recovery';
import { initialCore } from './reconciliation';
const actor = '00000000-0000-4000-8000-000000000001';
const instance = '00000000-0000-4000-8000-000000000002';
const field = '00000000-0000-4000-8000-000000000003';
const category = '00000000-0000-4000-8000-000000000004';
const revision = '00000000-0000-4000-8000-000000000005';
const scope = {
  origin: 'https://preview.example',
  backend: 'https://backend.example',
  actor,
  kind: 'quantity' as const,
  site: null,
};
function editing(): CreationEnvelope {
  const core = initialCore(undefined, [
    { id: category, name: 'Parts', active: true },
  ]);
  return {
    version: 1,
    scope,
    instance,
    status: 'editing',
    command: null,
    entityId: null,
    completedRequestId: null,
    inputs: {
      core: { ...core, name: 'Draft' },
      cleanCore: core,
      custom: { [field]: false },
      touched: [field],
      reviewedForms: {},
      priorForms: {},
      dateTimes: { [field]: { wall: '2026-10-03T', zone: 'America/Chicago' } },
      openingQuantity: '1',
      openingReason: '',
      openingReference: '',
    },
  };
}
function submitted(): CreationEnvelope {
  return {
    ...editing(),
    status: 'submitted',
    command: {
      operation: 'quantity_create_v2',
      requestId: revision,
      expectedActorId: actor,
      payload: {
        name: 'Draft',
        category_id: category,
        description: null,
        manufacturer: null,
        model: null,
        expected_published_revision_id: revision,
        custom_patch: { set: { [field]: false }, unset: [] },
        initial_quantity: 0,
        initial_location_id: null,
      },
    },
  };
}
describe('creation recovery storage boundary', () => {
  it.each([
    'asset_create_v2',
    'asset_create_v3',
    'asset_site_open',
    'asset_site_open_v3',
  ] as const)(
    'retains the exact uncertain %s command without upgrading its receipt identity',
    (operation) => {
      const envelope = submitted();
      envelope.scope = {
        ...envelope.scope,
        kind: 'asset',
        site: operation.startsWith('asset_site_open') ? category : null,
      };
      envelope.command = {
        operation,
        requestId: revision,
        expectedActorId: actor,
        payload: {
          name: 'Device',
          category_id: category,
          description: null,
          manufacturer: null,
          model: null,
          asset_tag: '000Ab/C.02',
          serial_number: null,
          expected_published_revision_id: revision,
          custom_patch: { set: {}, unset: [] },
          ...(envelope.scope.site
            ? { site_id: category, reason: null, reference: null }
            : { location_id: category }),
        },
      };
      expect(
        parseCreationEnvelope(
          JSON.stringify(envelope),
          envelope.scope,
          instance,
        )?.command,
      ).toEqual(envelope.command);
    },
  );
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });
  it('retains false, zero, empty, missing, touched clears and incomplete wall time independently', () => {
    const envelope = editing();
    envelope.inputs!.custom = { [field]: false, [category]: 0, [revision]: '' };
    envelope.inputs!.touched.push(instance);
    expect(writeCreation(envelope)).toBe(true);
    const recovered = readCreation(scope, instance).envelope!;
    expect(recovered.inputs?.custom).toEqual(envelope.inputs?.custom);
    expect(recovered.inputs?.custom).not.toHaveProperty(instance);
    expect(recovered.inputs?.touched).toContain(instance);
    expect(recovered.inputs?.dateTimes[field]).toEqual({
      wall: '2026-10-03T',
      zone: 'America/Chicago',
    });
  });
  it('isolates actor, backend, origin, kind, site and individual instances', () => {
    const raw = JSON.stringify(editing());
    for (const changed of [
      { actor: instance },
      { backend: 'https://other.example' },
      { origin: 'https://other.example' },
      { kind: 'asset' as const },
      { site: category },
    ])
      expect(
        parseCreationEnvelope(raw, { ...scope, ...changed }, instance),
      ).toBeNull();
    expect(parseCreationEnvelope(raw, scope, category)).toBeNull();
    expect(writeCreation(editing())).toBe(true);
    expect(
      readCreation({ ...scope, actor: instance }, instance).envelope,
    ).toBeNull();
    expect(pendingCreations(scope, category)).toHaveLength(1);
  });
  it('rejects corrupt, outdated, unknown, over-deep and oversized envelopes without deleting them', () => {
    const envelope = editing();
    for (const raw of [
      '{',
      JSON.stringify({ ...envelope, version: 0 }),
      JSON.stringify({ ...envelope, secret: 'token' }),
      JSON.stringify({
        ...envelope,
        inputs: {
          ...envelope.inputs,
          custom: {
            [field]: { nested: Array.from({ length: 6001 }, () => false) },
          },
        },
      }),
      ' '.repeat(creationRecoveryLimits.entryBytes + 1),
    ])
      expect(parseCreationEnvelope(raw, scope, instance)).toBeNull();
    expect(writeCreation(envelope)).toBe(true);
    const key = sessionStorage.key(0)!;
    sessionStorage.setItem(key, '{"version":0}');
    expect(readCreation(scope, instance).error).toMatch(/incompatible/);
    expect(writeCreation(editing())).toBe(false);
    expect(sessionStorage.getItem(key)).toBe('{"version":0}');
  });
  it('only accepts the four exact create commands with matching actor/kind/site and strict server payload shape', () => {
    const command = submitted();
    expect(writeCreation(command)).toBe(true);
    for (const changed of [
      { operation: 'quantity_move' },
      { expectedActorId: instance },
      { operation: 'asset_create_v2' },
      { payload: { ...command.command!.payload, site_id: category } },
      { payload: { ...command.command!.payload, token: 'secret' } },
    ])
      expect(
        parseCreationEnvelope(
          JSON.stringify({
            ...command,
            command: { ...command.command, ...changed },
          }),
          scope,
          instance,
        ),
      ).toBeNull();
  });
  it('keeps submitted requests immutable until definitive rejection and never lets stale writers overwrite terminal markers', () => {
    const command = submitted();
    expect(writeCreation(command)).toBe(true);
    expect(writeCreation(editing())).toBe(false);
    expect(
      writeCreation({
        ...command,
        command: { ...command.command!, requestId: category },
      }),
    ).toBe(false);
    expect(writeCreation(editing(), revision)).toBe(true);
    expect(writeCreation(command)).toBe(true);
    const saved: CreationEnvelope = {
      ...command,
      status: 'saved',
      inputs: null,
      command: null,
      entityId: category,
      completedRequestId: revision,
    };
    expect(writeCreation(saved, revision)).toBe(true);
    expect(writeCreation(editing())).toBe(false);
    expect(writeCreation(command)).toBe(false);
    expect(readCreation(scope, instance).envelope).toEqual(saved);
    expect(pendingCreations(scope, category)).toEqual([]);
  });
  it('retains the original submitted command when quota prevents the completion marker', () => {
    const command = submitted();
    expect(writeCreation(command)).toBe(true);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(
      writeCreation(
        {
          ...command,
          status: 'saved',
          inputs: null,
          command: null,
          entityId: category,
          completedRequestId: revision,
        },
        revision,
      ),
    ).toBe(false);
    expect(readCreation(scope, instance).envelope).toEqual(command);
  });
  it('rejects discard of a submitted operation and late completion of A after B was submitted', () => {
    const a = submitted();
    expect(writeCreation(a)).toBe(true);
    expect(
      writeCreation({ ...a, status: 'discarded', inputs: null, command: null }),
    ).toBe(false);
    expect(writeCreation(editing(), revision)).toBe(true);
    const b = {
      ...submitted(),
      command: { ...a.command!, requestId: category },
    };
    expect(writeCreation(b)).toBe(true);
    expect(
      writeCreation(
        {
          ...a,
          status: 'saved',
          inputs: null,
          command: null,
          entityId: field,
          completedRequestId: revision,
        },
        revision,
      ),
    ).toBe(false);
    expect(writeCreation(editing(), revision)).toBe(false);
    expect(readCreation(scope, instance).envelope).toEqual(b);
  });
  it('bounds instance count without evicting unresolved requests or terminal markers', () => {
    for (let i = 0; i < creationRecoveryLimits.instances; i++)
      expect(
        writeCreation({
          ...editing(),
          instance: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
          status: 'discarded',
          inputs: null,
        }),
      ).toBe(true);
    expect(
      writeCreation({
        ...submitted(),
        instance: '00000000-0000-4000-8000-999999999999',
      }),
    ).toBe(false);
    expect(sessionStorage.length).toBe(creationRecoveryLimits.instances);
  });
  it('fits representative supported maximum schema, custom values and duplicated submitted payload within the envelope ceiling', () => {
    const envelope = submitted();
    const fields = Array.from({ length: 100 }, (_, i) => ({
      id: `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      type: 'long_text' as const,
      label: 'L'.repeat(200),
      help: 'h'.repeat(2000),
      applies_to: ['quantity' as const],
      required: false,
      rules: {},
      options: [],
    }));
    const definition = {
      fields,
      layout: [
        {
          id: instance,
          label: 'Fields',
          controls: fields.map((field) => ({
            id: field.id,
            kind: 'field' as const,
            field_id: field.id,
            width: 12 as const,
          })),
        },
      ],
    };
    const form = {
      category_id: category,
      published_revision_id: revision,
      published_number: '1',
      published_definition: definition,
      draft_id: null,
      draft_version: null,
      draft_definition: null,
    };
    expect(
      new TextEncoder().encode(JSON.stringify(definition)).length,
    ).toBeLessThanOrEqual(262144);
    expect(
      new TextEncoder().encode(
        JSON.stringify(
          Object.fromEntries(
            fields.map((field) => [field.id, 'v'.repeat(2500)]),
          ),
        ),
      ).length,
    ).toBeLessThanOrEqual(262144);
    envelope.inputs!.reviewedForms = { [category]: form };
    envelope.inputs!.priorForms = { [category]: form };
    envelope.inputs!.custom = Object.fromEntries(
      fields.map((field) => [field.id, 'v'.repeat(2500)]),
    );
    envelope.command!.payload.custom_patch = {
      set: envelope.inputs!.custom,
      unset: [],
    };
    expect(
      new TextEncoder().encode(JSON.stringify(envelope)).length,
    ).toBeGreaterThan(300 * 1024);
    expect(writeCreation(envelope)).toBe(true);
    expect(readCreation(scope, instance).envelope).toEqual(envelope);
  });
});
