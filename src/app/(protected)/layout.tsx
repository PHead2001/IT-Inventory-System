import Link from 'next/link';
import { Boxes } from 'lucide-react';
import { requireMember } from '@/lib/auth/session.server';
import { QueueLogoutForm } from '@/features/labels/queue-logout-form';
import { PrivateSpeedInsights } from '@/features/telemetry/private-speed-insights';
import { speedInsightsEnabled } from '@/features/telemetry/speed-insights';
import { MotionPreference } from '@/components/experience/motion-preference';
import { Navigation } from '@/components/experience/navigation';
import { PageArrival } from '@/components/experience/page-arrival';
import { OperationalTimeProvider } from '@/components/operational-time';

export const dynamic = 'force-dynamic';

export default async function ApplicationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { member } = await requireMember();
  return (
    <OperationalTimeProvider>
      <MotionPreference>
        <div className="experience-app">
          <a href="#main-content" className="experience-skip-link">
            Skip to content
          </a>
          <header className="experience-header">
            <div className="experience-header-inner">
              <Link href="/dashboard" className="experience-brand">
                <span className="experience-brand-mark">
                  <Boxes size={19} strokeWidth={1.8} aria-hidden="true" />
                </span>
                <span>
                  <strong>IT Inventory</strong>
                  <small>Spatial workspace</small>
                </span>
              </Link>
              <div className="experience-account">
                <span className="experience-account-name">
                  {member.display_name}
                </span>
                <span className="experience-role">{member.role}</span>
                <QueueLogoutForm />
              </div>
            </div>
          </header>
          <div className="experience-workspace">
            <aside className="experience-sidebar">
              <Navigation />
            </aside>
            <main id="main-content" className="experience-main" tabIndex={-1}>
              <PageArrival>{children}</PageArrival>
            </main>
          </div>
          {speedInsightsEnabled({
            VERCEL_ENV: process.env.VERCEL_ENV,
            SPEED_INSIGHTS_ENABLED: process.env.SPEED_INSIGHTS_ENABLED,
          }) && <PrivateSpeedInsights />}
        </div>
      </MotionPreference>
    </OperationalTimeProvider>
  );
}
