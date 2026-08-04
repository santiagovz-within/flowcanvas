import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Sidebar } from '@/components/layout/Sidebar';
import { ThemeProvider } from '@/components/layout/ThemeProvider';
import { BackgroundGenerationManager } from '@/components/layout/BackgroundGenerationManager';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('approved')
    .eq('id', user.id)
    .single();

  if (!profile?.approved) {
    redirect('/pending');
  }

  return (
    <ThemeProvider>
      <div className="flex h-screen overflow-hidden" style={{ background: 'var(--color-bg-darkest)' }}>
        <BackgroundGenerationManager />
        <Sidebar />
        <main className="flex-1 overflow-hidden min-w-0">
          {children}
        </main>
      </div>
    </ThemeProvider>
  );
}
