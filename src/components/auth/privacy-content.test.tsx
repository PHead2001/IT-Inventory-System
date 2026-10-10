import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { PrivacyReadinessContext } from './privacy-readiness';
import { ProtectedPrivacyContent } from './privacy-content';

it('never server-renders a private bootstrap consumer before readiness', () => {
  const bootstrap = vi.fn();
  function PrivateConsumer() {
    bootstrap();
    return <p>Private restored command</p>;
  }
  const html = renderToStaticMarkup(
    <PrivacyReadinessContext value={{ ready: false, generation: '' }}>
      <ProtectedPrivacyContent>
        <PrivateConsumer />
      </ProtectedPrivacyContent>
    </PrivacyReadinessContext>,
  );
  expect(bootstrap).not.toHaveBeenCalled();
  expect(html).not.toContain('Private restored command');
});

it('server-renders accepted content when its enclosing controller is ready', () => {
  const bootstrap = vi.fn();
  function PrivateConsumer() {
    bootstrap();
    return <p>Verified private command</p>;
  }
  const html = renderToStaticMarkup(
    <PrivacyReadinessContext value={{ ready: true, generation: 'absent' }}>
      <ProtectedPrivacyContent>
        <PrivateConsumer />
      </ProtectedPrivacyContent>
    </PrivacyReadinessContext>,
  );
  expect(bootstrap).toHaveBeenCalledOnce();
  expect(html).toContain('Verified private command');
});
