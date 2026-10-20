import Link from '@/components/experience/route-link';
import { Boxes } from 'lucide-react';
import { requireMember } from '@/lib/auth/session.server';
import { QueueLogoutForm } from '@/features/labels/queue-logout-form';
import { PrivateSpeedInsights } from '@/features/telemetry/private-speed-insights';
import { speedInsightsEnabled } from '@/features/telemetry/speed-insights';
import { MotionPreference } from '@/components/experience/motion-preference';
import { AccountIdentity } from '@/components/experience/account-identity';
import { Navigation } from '@/components/experience/navigation';
import { ProtectedRouteArrival } from '@/components/experience/protected-route-arrival';
import { RouteMotionProvider } from '@/components/experience/route-motion';
import { OperationalTimeProvider } from '@/components/operational-time';
import { AssignmentScopeGuard } from '@/features/scan/assignment-scope-guard';
import { ProtectedPrivacyBoundary } from '@/components/auth/auth-privacy';
import { ProtectedPrivacyContent } from '@/components/auth/privacy-content';
import { readLogoutGeneration } from '@/lib/auth/privacy-barrier.server';
import { RoomSceneBudgetProvider } from '@/features/room/scene/scene-budget-provider';
import { RoomCameraSnapshotProvider } from '@/features/room/scene/camera-snapshot-provider';
import {
  CommandProvider,
  CommandButtons,
} from '@/features/commands/command-provider';
import { admitDocumentRecord } from './document-admission.server';
import { DocumentAdmission } from './document-admission';

export const dynamic = 'force-dynamic';

export default async function ApplicationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { member } = await requireMember();
  const missingDocumentRecord = await admitDocumentRecord();
  const privacy = await readLogoutGeneration();
  return (
    <DocumentAdmission missing={missingDocumentRecord}>
      <ProtectedPrivacyBoundary
        serverGeneration={privacy}
        binding={{
          actorId: member.user_id,
          backend: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').origin,
          role: member.role,
          canManageConfiguration: member.can_manage_configuration === true,
        }}
      >
        <RoomCameraSnapshotProvider
          actorId={member.user_id}
          backend={new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').origin}
        >
          <RoomSceneBudgetProvider>
            <OperationalTimeProvider>
              <AssignmentScopeGuard
                actorId={member.user_id}
                backend={process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''}
              />
              <MotionPreference>
                <RouteMotionProvider actorId={member.user_id}>
                  <CommandProvider
                    actorId={member.user_id}
                    backend={
                      new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').origin
                    }
                    staff={member.role === 'staff'}
                  >
                    <div className="experience-app">
                      <a href="#main-content" className="experience-skip-link">
                        Skip to content
                      </a>
                      <header className="experience-header">
                        <div className="experience-header-inner max-sm:flex-wrap">
                          <ProtectedPrivacyContent>
                            <Link
                              href="/dashboard"
                              className="experience-brand"
                            >
                              <span className="experience-brand-mark">
                                <Boxes
                                  size={19}
                                  strokeWidth={1.8}
                                  aria-hidden="true"
                                />
                              </span>
                              <span>
                                <strong>IT Inventory</strong>
                                <small>Spatial workspace</small>
                              </span>
                            </Link>
                          </ProtectedPrivacyContent>
                          <div className="experience-account">
                            <ProtectedPrivacyContent>
                              <CommandButtons />
                              <AccountIdentity
                                name={member.display_name}
                                role={member.role}
                              />
                            </ProtectedPrivacyContent>
                            <QueueLogoutForm />
                          </div>
                        </div>
                      </header>
                      <div className="experience-workspace">
                        <aside className="experience-sidebar">
                          <ProtectedPrivacyContent>
                            <Navigation />
                          </ProtectedPrivacyContent>
                        </aside>
                        <main
                          id="main-content"
                          className="experience-main"
                          tabIndex={-1}
                        >
                          <ProtectedRouteArrival>
                            {children}
                          </ProtectedRouteArrival>
                        </main>
                      </div>
                      <ProtectedPrivacyContent>
                        {speedInsightsEnabled({
                          VERCEL_ENV: process.env.VERCEL_ENV,
                          SPEED_INSIGHTS_ENABLED:
                            process.env.SPEED_INSIGHTS_ENABLED,
                        }) && <PrivateSpeedInsights />}
                      </ProtectedPrivacyContent>
                    </div>
                  </CommandProvider>
                </RouteMotionProvider>
              </MotionPreference>
            </OperationalTimeProvider>
          </RoomSceneBudgetProvider>
        </RoomCameraSnapshotProvider>
      </ProtectedPrivacyBoundary>
    </DocumentAdmission>
  );
}
