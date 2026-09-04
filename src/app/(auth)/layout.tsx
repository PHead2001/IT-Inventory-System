import Link from 'next/link';
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center p-5">
      <section className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900/60 p-6 sm:p-8">
        <Link
          href="/login"
          className="mb-8 block text-sm font-semibold tracking-widest text-cyan-300"
        >
          IT INVENTORY
        </Link>
        {children}
      </section>
    </main>
  );
}
