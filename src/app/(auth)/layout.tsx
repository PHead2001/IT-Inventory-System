import Link from 'next/link';
import { Boxes } from 'lucide-react';
import { MotionPreference } from '@/components/experience/motion-preference';
import { AmbientLight } from '@/components/experience/ambient-light';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <MotionPreference>
      <main className="experience-auth">
        <AmbientLight className="experience-ambient-auth" />
        <div className="experience-auth-story" aria-hidden="true">
          <p className="experience-eyebrow">Inventory · space · custody</p>
          <h2>Know where everything belongs.</h2>
          <p>
            A clear view of equipment, storage and the spaces connecting them.
          </p>
          <div className="experience-auth-orbit" />
        </div>
        <section className="experience-auth-panel experience-surface-bright w-full">
          <Link href="/login" className="experience-brand mb-9">
            <span className="experience-brand-mark">
              <Boxes size={19} strokeWidth={1.8} aria-hidden="true" />
            </span>
            <span>
              <strong>IT Inventory</strong>
              <small>Secure workspace</small>
            </span>
          </Link>
          {children}
        </section>
      </main>
    </MotionPreference>
  );
}
