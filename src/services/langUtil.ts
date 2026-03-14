/**
 * Shared language utility for services layer (non-React context).
 * Reads language from localStorage or navigator, matching i18n config.
 */
export function getLang(): 'zh' | 'en' {
  try {
    const stored = localStorage.getItem('aags_language');
    if (stored === 'zh' || stored === 'en') return stored;
    if (typeof navigator !== 'undefined' && navigator.language?.startsWith('zh')) return 'zh';
  } catch {}
  return 'en';
}

export function getLocale(): string {
  return getLang() === 'zh' ? 'zh-CN' : 'en-US';
}
