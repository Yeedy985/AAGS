import { 
  LayoutDashboard, Settings, TrendingUp, Grid3x3, Shield, 
  Wallet, BarChart3, Zap, ChevronLeft, ChevronRight,
  Newspaper, BellRing, MoreHorizontal, X, Globe,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store/useStore';
import { useIsMobile } from '../hooks/useIsMobile';

const navItemDefs = [
  { id: 'dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { id: 'account', labelKey: 'nav.account', icon: Wallet },
  { id: 'market', labelKey: 'nav.market', icon: TrendingUp },
  { id: 'strategies', labelKey: 'nav.strategy', icon: Grid3x3 },
  { id: 'risk', labelKey: 'nav.risk', icon: Shield },
  { id: 'reports', labelKey: 'nav.reports', icon: BarChart3 },
  { id: 'sentiment', labelKey: 'nav.sentiment', icon: Newspaper },
  { id: 'alerts', labelKey: 'nav.alerts', icon: BellRing },
  { id: 'settings', labelKey: 'nav.settings', icon: Settings },
];

// 移动端底部栏显示的主要 Tab（最多5个）
const mobileMainTabs = ['dashboard', 'strategies', 'market', 'account', 'more'];
const mobileMainNav = navItemDefs.filter(n => mobileMainTabs.includes(n.id));
// "更多"菜单里的 Tab
const mobileMoreNav = navItemDefs.filter(n => !mobileMainTabs.includes(n.id));

export default function Layout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const { activeTab, setActiveTab, isConnected } = useStore();
  const isMobile = useIsMobile();
  const { t, i18n } = useTranslation();

  // ==================== 移动端布局 ====================
  if (isMobile) {
    return (
      <div className="flex flex-col h-screen h-[100dvh] overflow-hidden">
        {/* Mobile Header */}
        <header
          className="flex items-center justify-between px-4 shrink-0"
          style={{
            height: 'calc(48px + env(safe-area-inset-top, 0px))',
            paddingTop: 'env(safe-area-inset-top, 0px)',
            background: 'linear-gradient(180deg, rgba(10,15,28,0.98) 0%, rgba(6,8,15,0.95) 100%)',
            borderBottom: '1px solid rgba(51,65,85,0.3)',
          }}
        >
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)' }}>
              <Zap className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-bold text-base tracking-tight bg-gradient-to-r from-blue-400 to-violet-400 bg-clip-text text-transparent">
              AAGS
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { const next = i18n.language === 'zh' ? 'en' : 'zh'; i18n.changeLanguage(next); }}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-white/10 transition-all"
              title={i18n.language === 'zh' ? 'English' : '中文'}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>{i18n.language === 'zh' ? 'EN' : '中'}</span>
            </button>
            <div className="relative">
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-red-400'}`} />
              {isConnected && <div className="absolute inset-0 w-2 h-2 rounded-full bg-emerald-400 animate-ping opacity-40" />}
            </div>
            <span className={`text-xs font-medium ${isConnected ? 'text-emerald-400/80' : 'text-red-400/80'}`}>
              {isConnected ? t('connection.connected') : t('connection.disconnected')}
            </span>
          </div>
        </header>

        {/* Mobile Main Content */}
        <main className="flex-1 overflow-auto">
          <div className="px-3 py-3">
            {children}
          </div>
        </main>

        {/* "更多" 菜单弹出层 */}
        {moreOpen && (
          <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setMoreOpen(false)}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <div
              className="relative rounded-t-2xl overflow-hidden"
              style={{
                background: 'linear-gradient(180deg, rgba(15,23,42,0.98) 0%, rgba(6,8,15,0.99) 100%)',
                paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-4">
                <span className="text-base font-semibold text-slate-200">{t('common.more')}</span>
                <button onClick={() => setMoreOpen(false)} className="p-1 rounded-lg hover:bg-slate-800">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>
              <div className="grid grid-cols-4 gap-2 px-4 pb-2">
                {mobileMoreNav.map((item) => {
                  const Icon = item.icon;
                  const active = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => { setActiveTab(item.id); setMoreOpen(false); }}
                      className={`flex flex-col items-center gap-1.5 py-3 rounded-xl transition-all ${
                        active ? 'bg-blue-500/15' : 'active:bg-slate-800'
                      }`}
                    >
                      <Icon className={`w-6 h-6 ${active ? 'text-blue-400' : 'text-slate-400'}`} />
                      <span className={`text-xs font-medium ${active ? 'text-blue-400' : 'text-slate-500'}`}>{t(item.labelKey)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Mobile Bottom Navigation */}
        <nav
          className="shrink-0 flex items-end"
          style={{
            background: 'linear-gradient(180deg, rgba(10,15,28,0.98) 0%, rgba(6,8,15,1) 100%)',
            borderTop: '1px solid rgba(51,65,85,0.3)',
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          }}
        >
          <div className="flex w-full">
            {mobileMainNav.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`flex-1 flex flex-col items-center gap-0.5 py-2 transition-colors ${
                    active ? 'text-blue-400' : 'text-slate-600 active:text-slate-400'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-[10px] font-medium">{t(item.labelKey)}</span>
                </button>
              );
            })}
            {/* "更多" 按钮 */}
            <button
              onClick={() => setMoreOpen(true)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2 transition-colors ${
                moreOpen || mobileMoreNav.some(n => n.id === activeTab) ? 'text-blue-400' : 'text-slate-600 active:text-slate-400'
              }`}
            >
              <MoreHorizontal className="w-5 h-5" />
              <span className="text-[10px] font-medium">{t('common.more')}</span>
            </button>
          </div>
        </nav>
      </div>
    );
  }

  // ==================== 桌面端布局（原逻辑） ====================
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside
        className={`${collapsed ? 'w-16' : 'w-56'} flex flex-col transition-all duration-300 shrink-0`}
        style={{
          background: 'linear-gradient(180deg, rgba(10,15,28,0.95) 0%, rgba(6,8,15,0.98) 100%)',
          borderRight: '1px solid rgba(51,65,85,0.3)',
        }}
      >
        {/* Logo */}
        <div className="h-14 flex items-center px-4 gap-2.5" style={{ borderBottom: '1px solid rgba(51,65,85,0.25)' }}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)', boxShadow: '0 2px 12px -2px rgba(99,102,241,0.4)' }}>
            <Zap className="w-4 h-4 text-white" />
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-blue-400 to-violet-400 bg-clip-text text-transparent leading-tight">
                AAGS
              </span>
              <span className="text-[9px] text-slate-500 font-medium tracking-wide">{t('settings.aboutDesc')}</span>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 space-y-0.5 px-2 overflow-y-auto">
          {navItemDefs.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200 ${
                  active
                    ? 'text-blue-400'
                    : 'text-slate-500 hover:text-slate-200 hover:bg-white/[0.03]'
                }`}
                style={active ? {
                  background: 'linear-gradient(135deg, rgba(59,130,246,0.12) 0%, rgba(139,92,246,0.08) 100%)',
                  boxShadow: '0 0 12px -3px rgba(59,130,246,0.2)',
                } : undefined}
              >
                <Icon className="w-[18px] h-[18px] shrink-0" />
                {!collapsed && <span>{t(item.labelKey)}</span>}
              </button>
            );
          })}
        </nav>

        {/* Language Switcher */}
        <div className="px-3 py-2" style={{ borderTop: '1px solid rgba(51,65,85,0.25)' }}>
          <button
            onClick={() => { const next = i18n.language === 'zh' ? 'en' : 'zh'; i18n.changeLanguage(next); }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] font-medium text-slate-500 hover:text-slate-200 hover:bg-white/[0.03] transition-all`}
            title={i18n.language === 'zh' ? 'Switch to English' : '切换到中文'}
          >
            <Globe className="w-[18px] h-[18px] shrink-0" />
            {!collapsed && <span>{i18n.language === 'zh' ? 'English' : '中文'}</span>}
          </button>
        </div>

        {/* Connection Status */}
        <div className="px-3 py-3" style={{ borderTop: '1px solid rgba(51,65,85,0.15)' }}>
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-red-400'}`} />
              {isConnected && (
                <div className="absolute inset-0 w-2 h-2 rounded-full bg-emerald-400 animate-ping opacity-40" />
              )}
            </div>
            {!collapsed && (
              <span className={`text-sm font-medium ${isConnected ? 'text-emerald-400/80' : 'text-red-400/80'}`}>
                {isConnected ? 'Binance ' + t('connection.connected') : t('connection.disconnected')}
              </span>
            )}
          </div>
        </div>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="h-10 flex items-center justify-center text-slate-600 hover:text-slate-300 transition-all duration-200"
          style={{ borderTop: '1px solid rgba(51,65,85,0.2)' }}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <div className="p-6 max-w-[1600px] mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
