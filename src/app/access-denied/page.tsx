import { QueueLogoutForm } from '@/features/labels/queue-logout-form';
import {
  MotionPreference,
  MotionToggle,
} from '@/components/experience/motion-preference';
export const dynamic = 'force-dynamic';
export default function AccessDeniedPage() {
  return (
    <MotionPreference>
      <main className="experience-auth experience-access-denied">
        <section className="experience-auth-panel experience-surface-bright mx-auto w-full max-w-xl">
          <p className="experience-eyebrow">IT Inventory · Access</p>
          <h1 className="experience-heading mt-3">Access is not enabled</h1>
          <p className="experience-muted my-6 leading-7">
            Your account does not have an active application membership. Contact
            the application owner to request access.
          </p>
          <QueueLogoutForm />
          <footer className="mt-7 border-t border-cyan-200/15 pt-4">
            <MotionToggle />
          </footer>
        </section>
      </main>
    </MotionPreference>
  );
}
