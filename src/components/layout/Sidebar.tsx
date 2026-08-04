'use client';

import NextImage from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  GitBranch,
  Image as ImageIcon,
  Zap,
  Music,
  Grid,
  Settings,
  PanelLeft,
  Users,
  BarChart2,
  Bug,
  LoaderCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { createClient } from '@/lib/supabase/client';
import { useGenerationStore } from '@/lib/stores/generationStore';
import { PORT_COLORS } from '@/components/canvas/nodes/TypedHandle';

const NAV_ITEMS = [
  { label: 'Canvas Flow',  icon: GitBranch, href: '/dashboard/canvas-flow'  },
  { label: 'Image & Video',icon: ImageIcon, href: '/dashboard/image-video'  },
  { label: 'Gallery',      icon: Grid,      href: '/dashboard/gallery'      },
];

const ADMIN_ITEMS = [
  { label: 'Users', icon: Users, href: '/dashboard/admin/users' },
  { label: 'All Usage', icon: BarChart2, href: '/dashboard/admin/usage' },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const generationJobs = useGenerationStore((state) => state.jobs);
  const activeGenerations = Object.values(generationJobs)
    .filter((generation) => generation.phase !== 'saving')
    .sort((a, b) => a.startedAt - b.startedAt);

  useEffect(() => {
    const supabase = createClient();
    async function checkAdmin() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single();
      setIsAdmin(profile?.is_admin ?? false);
    }
    checkAdmin();
  }, []);

  const renderNavItem = (label: string, Icon: React.ElementType, href: string) => {
    const active = pathname.startsWith(href);
    return (
      <Link
        key={href}
        href={href}
        className={cn(
          'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 group',
          active ? 'bg-white/10' : 'hover:bg-white/5'
        )}
      >
        <Icon
          size={18}
          className="shrink-0 transition-colors"
          style={{ color: active ? 'var(--color-white)' : 'var(--color-white-muted)' }}
        />
        {!collapsed && (
          <span
            className="text-sm font-bold whitespace-nowrap transition-colors"
            style={{ color: active ? 'var(--color-white)' : 'var(--color-white-muted)' }}
          >
            {label}
          </span>
        )}
        {active && (
          <div
            className="absolute left-0 w-0.5 h-6 rounded-r-full"
            style={{ background: 'var(--color-accent)' }}
          />
        )}
      </Link>
    );
  };

  return (
    <aside
      className="relative flex flex-col h-full transition-all duration-200 shrink-0"
      style={{
        width: collapsed ? '64px' : '220px',
        background: 'var(--color-bg-darkest)',
        borderRight: 'var(--border-default)',
      }}
    >
      {/* Logo */}
      <div
        className="flex items-center gap-3 px-4 py-5 overflow-hidden"
        style={{ borderBottom: 'var(--border-default)' }}
      >
        <div className="w-8 h-8 rounded-lg shrink-0 overflow-hidden">
          <NextImage src="/logo.png" alt="WITHIN Glide" width={32} height={32} className="w-8 h-8 object-cover" priority />
        </div>
        {!collapsed && (
          <span className="text-sm font-semibold whitespace-nowrap" style={{ color: 'var(--color-white)' }}>
            WITHIN Glide
          </span>
        )}
      </div>

      {/* Main nav items */}
      <nav className="flex-1 px-2 py-4 space-y-1 overflow-hidden overflow-y-auto">
        {NAV_ITEMS.map(({ label, icon: Icon, href }) => renderNavItem(label, Icon, href))}

        {/* Realtime — admin only, Coming Soon for everyone else */}
        {isAdmin ? renderNavItem('Realtime', Zap, '/dashboard/realtime') : (
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg w-full cursor-not-allowed opacity-50">
            <Zap size={18} className="shrink-0" style={{ color: 'var(--color-white-muted)' }} />
            {!collapsed && (
              <>
                <span className="text-sm font-bold whitespace-nowrap" style={{ color: 'var(--color-white-muted)' }}>
                  Realtime
                </span>
                <span
                  className="ml-auto text-[9px] font-semibold tracking-wider px-1.5 py-0.5 rounded"
                  style={{ background: 'rgba(255,255,255,0.08)', color: 'var(--color-white-muted)', letterSpacing: '0.08em' }}
                >
                  COMING SOON
                </span>
              </>
            )}
          </div>
        )}

        {/* JamBox (coming soon) */}
        <div
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg w-full cursor-not-allowed opacity-50"
        >
          <Music
            size={18}
            className="shrink-0"
            style={{ color: 'var(--color-white-muted)' }}
          />
          {!collapsed && (
            <>
              <span
                className="text-sm font-bold whitespace-nowrap"
                style={{ color: 'var(--color-white-muted)' }}
              >
                JamBox
              </span>
              <span
                className="ml-auto text-[9px] font-semibold tracking-wider px-1.5 py-0.5 rounded"
                style={{ background: 'rgba(255,255,255,0.08)', color: 'var(--color-white-muted)', letterSpacing: '0.08em' }}
              >
                COMING SOON
              </span>
            </>
          )}
        </div>

        {/* Admin section */}
        {isAdmin && (
          <>
            <div
              className="mx-3 my-2"
              style={{ height: '1px', background: 'var(--color-white-subtle)' }}
            />
            {!collapsed && (
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--color-white-muted)' }}>
                Admin
              </p>
            )}
            {ADMIN_ITEMS.map(({ label, icon: Icon, href }) => renderNavItem(label, Icon, href))}
          </>
        )}
      </nav>

      {/* One compact card per generating node. Multi-image batches stay grouped. */}
      {activeGenerations.length > 0 && (
        <div className={cn('max-h-48 overflow-y-auto px-2 pb-2 space-y-1.5', collapsed && 'px-1.5')}>
          {activeGenerations.map((generation) => {
            const mediaType = generation.kind === 'image-generation' ? 'image' : 'video';
            return (
              <Link
                key={generation.id}
                href={{
                  pathname: `/dashboard/canvas-flow/${generation.flowId}`,
                  query: { focusNode: generation.nodeId },
                }}
                title={`Generating an asset in ${generation.flowTitle}`}
                aria-label={`Generating an asset in ${generation.flowTitle}. Open generating node.`}
                className={cn(
                  'group flex rounded-lg transition-opacity hover:opacity-80',
                  collapsed
                    ? 'h-10 items-center justify-center'
                    : 'items-center gap-2.5 px-2.5 py-2',
                )}
                style={{
                  background: 'var(--color-bg-elevated)',
                  border: 'var(--border-default)',
                }}
              >
                <span className="relative flex h-6 w-6 shrink-0 items-center justify-center">
                  <span
                    className="absolute inset-0 rounded-full animate-pulse"
                    style={{ background: `var(--port-tint-${mediaType})` }}
                  />
                  <LoaderCircle
                    size={14}
                    className="relative animate-spin"
                    style={{ color: PORT_COLORS[mediaType] }}
                  />
                </span>
                {!collapsed && (
                  <span className="min-w-0 text-left">
                    <span
                      className="block truncate text-[11px] font-semibold"
                      style={{ color: 'var(--color-white)' }}
                    >
                      Generating asset
                    </span>
                    <span
                      className="block truncate text-[10px]"
                      style={{ color: 'var(--color-white-muted)' }}
                    >
                      {generation.flowTitle}
                    </span>
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}

      {/* Bottom section */}
      <div className="px-2 pb-4 space-y-1" style={{ borderTop: 'var(--border-default)', paddingTop: '12px' }}>
        {renderNavItem('Bug Reports', Bug, '/dashboard/bug-reports')}
        <Link
          href="/dashboard/settings"
          className={cn(
            'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150',
            pathname === '/dashboard/settings' ? 'bg-white/10' : 'hover:bg-white/5'
          )}
        >
          <Settings
            size={18}
            className="shrink-0"
            style={{ color: pathname === '/dashboard/settings' ? 'var(--color-white)' : 'var(--color-white-muted)' }}
          />
          {!collapsed && (
            <span
              className="text-sm font-bold whitespace-nowrap"
              style={{ color: pathname === '/dashboard/settings' ? 'var(--color-white)' : 'var(--color-white-muted)' }}
            >
              Settings
            </span>
          )}
        </Link>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 w-full hover:bg-white/5"
        >
          <PanelLeft size={18} style={{ color: 'var(--color-white-muted)' }} />
        </button>
      </div>
    </aside>
  );
}
