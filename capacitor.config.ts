import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.aags.grid.trading',
  appName: 'AAGS',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
