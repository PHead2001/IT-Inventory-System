import { act, render, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SafeCanvas, GraphicsBoundary } from './safe-canvas';
const driver = vi.hoisted(() => ({
  configure: vi.fn(),
  render: vi.fn(),
  unmount: vi.fn(),
  create: vi.fn(),
}));
vi.mock('@react-three/fiber', () => ({
  createRoot: driver.create,
  events: vi.fn(),
  extend: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  driver.configure.mockResolvedValue(undefined);
  driver.create.mockReturnValue(driver);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 600,
    height: 400,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 600,
    bottom: 400,
    toJSON() {},
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('keeps canvas fallback markup inert while configuring the actual renderer', async () => {
  const onFailure = vi.fn();
  const { container } = render(
    <SafeCanvas onFailure={onFailure} fallback="Graphics unavailable">
      scene
    </SafeCanvas>,
  );
  await waitFor(() => expect(driver.render).toHaveBeenCalledOnce());
  expect(container.querySelector('canvas')?.textContent).toBe(
    'Graphics unavailable',
  );
  expect(onFailure).not.toHaveBeenCalled();
  expect(driver.configure).toHaveBeenCalledOnce();
});
it('handles the actual configure rejection locally without rendering or claiming readiness', async () => {
  driver.configure.mockRejectedValue(new Error('Renderer construction failed'));
  const onFailure = vi.fn();
  render(<SafeCanvas onFailure={onFailure}>scene</SafeCanvas>);
  await waitFor(() => expect(onFailure).toHaveBeenCalledOnce());
  expect(driver.render).not.toHaveBeenCalled();
});
it('ignores late initialization after unmount and disposes the graphics root', async () => {
  let finish!: (value: unknown) => void;
  driver.configure.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const onFailure = vi.fn();
  const view = render(<SafeCanvas onFailure={onFailure}>scene</SafeCanvas>);
  await waitFor(() => expect(driver.configure).toHaveBeenCalledOnce());
  view.unmount();
  await act(async () => finish(undefined));
  expect(driver.render).not.toHaveBeenCalled();
  expect(driver.unmount).toHaveBeenCalledOnce();
  expect(onFailure).not.toHaveBeenCalled();
});
it('does not allocate a root for the provisional StrictMode mount', async () => {
  render(
    <StrictMode>
      <SafeCanvas onFailure={vi.fn()}>scene</SafeCanvas>
    </StrictMode>,
  );
  await waitFor(() => expect(driver.render).toHaveBeenCalledOnce());
  expect(driver.create).toHaveBeenCalledOnce();
});
it('reports child scene errors from the separate graphics React root', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  function Broken(): never {
    throw new Error('Scene failure');
  }
  const onFailure = vi.fn();
  render(
    <GraphicsBoundary onFailure={onFailure}>
      <Broken />
    </GraphicsBoundary>,
  );
  expect(onFailure).toHaveBeenCalledOnce();
});

it('connects pointer events to the host so Html portals stay outside canvas fallback content', async () => {
  const { container } = render(
    <SafeCanvas onFailure={vi.fn()}>scene</SafeCanvas>,
  );
  await waitFor(() => expect(driver.configure).toHaveBeenCalledOnce());
  const connect = vi.fn();
  driver.configure.mock.calls[0][0].onCreated({ events: { connect } });
  expect(connect).toHaveBeenCalledWith(
    container.querySelector('canvas')?.parentElement,
  );
  expect(connect).not.toHaveBeenCalledWith(container.querySelector('canvas'));
});
