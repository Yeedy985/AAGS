import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import zh from './locales/zh.json';
import en from './locales/en.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      zh: { translation: zh },
      en: { translation: en },
    },
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'aags_language',
      caches: ['localStorage'],
    },
    // 中文系统默认中文，其他默认英文
    lng: undefined, // 让 detector 决定
  });

// 自定义: navigator 检测后，如果是 zh 开头的就用 zh，否则 en
const detectedLng = i18n.language;
if (detectedLng && !['zh', 'en'].includes(detectedLng)) {
  if (detectedLng.startsWith('zh')) {
    i18n.changeLanguage('zh');
  } else {
    i18n.changeLanguage('en');
  }
}

export default i18n;
