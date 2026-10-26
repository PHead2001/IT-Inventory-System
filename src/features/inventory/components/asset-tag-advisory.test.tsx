import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AssetTagAdvisory, useAssetTagAdvisory } from './asset-tag-advisory';
import type { ComponentProps } from 'react';
const mocks = vi.hoisted(() => ({ check: vi.fn(), prefetch: vi.fn() }));
vi.mock('../asset-tag.actions', () => ({ checkAssetTag: mocks.check }));
vi.mock('next/link', () => ({
  default: ({
    prefetch,
    ...props
  }: ComponentProps<'a'> & { prefetch?: boolean }) => {
    mocks.prefetch(prefetch);
    return <a {...props} />;
  },
}));
const id = '70000000-0000-4000-8000-000000000001';
const conflict = {
  id,
  name: 'Existing device',
  asset_tag: 'Mixed',
  status: 'retired' as const,
};
function Harness({
  value = 'Mixed',
  owner = 'original',
  enabled = true,
}: {
  value?: string;
  owner?: string;
  enabled?: boolean;
}) {
  const advisory = useAssetTagAdvisory({
    value,
    owner,
    excludeId: id,
    enabled,
  });
  return (
    <>
      <button onClick={() => void advisory.check()}>Blur</button>
      <AssetTagAdvisory id="tag-advisory" result={advisory.result} />
    </>
  );
}
beforeEach(() => {
  vi.resetAllMocks();
});
it('shows a named link and only the actual lifecycle of a conflicting record', async () => {
  mocks.check.mockResolvedValue(conflict);
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Blur' }));
  expect(
    await screen.findByRole('link', { name: 'Existing device' }),
  ).toHaveAttribute('href', '/inventory/assets/' + id);
  expect(screen.getByRole('status')).toHaveTextContent('(retired)');
  expect(mocks.prefetch).toHaveBeenLastCalledWith(false);
  expect(mocks.check).toHaveBeenCalledExactlyOnceWith('Mixed', id);
});
it('failure says could not check and never claims availability', async () => {
  mocks.check.mockRejectedValue(new Error('private failure'));
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Blur' }));
  expect(
    await screen.findByText(/Asset tag could not be checked/),
  ).toBeVisible();
  expect(screen.getByRole('status')).not.toHaveTextContent(
    /available|No conflicting|private/i,
  );
});
it.each(['input', 'owner', 'disabled', 'unmount'])(
  'ignores an obsolete %s response',
  async (change) => {
    let finish!: (value: typeof conflict) => void;
    mocks.check.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const view = render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Blur' }));
    if (change === 'unmount') view.unmount();
    else
      view.rerender(
        <Harness
          value={change === 'input' ? 'Other' : 'Mixed'}
          owner={change === 'owner' ? 'new owner' : 'original'}
          enabled={change !== 'disabled'}
        />,
      );
    await act(async () => {
      finish(conflict);
    });
    expect(
      screen.queryByRole('link', { name: 'Existing device' }),
    ).not.toBeInTheDocument();
  },
);
it('a second blur wins over an earlier response and empty input does not query', async () => {
  let finish!: (value: typeof conflict) => void;
  mocks.check
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    )
    .mockResolvedValue(null);
  const view = render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Blur' }));
  fireEvent.click(screen.getByRole('button', { name: 'Blur' }));
  expect(
    await screen.findByText('No conflicting tag found. Saving checks again.'),
  ).toBeVisible();
  await act(async () => {
    finish(conflict);
  });
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  view.rerender(<Harness value="   " />);
  fireEvent.click(screen.getByRole('button', { name: 'Blur' }));
  expect(mocks.check).toHaveBeenCalledTimes(2);
});
