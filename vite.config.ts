import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Apex Adaptive Grid System',
        short_name: 'AAGS',
        description: '自适应波动率三层网格量化交易系统',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  base: './',
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/tgapi': {
        target: 'https://api.telegram.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/tgapi/, ''),
        secure: true,
      },
      '/proxy/binance': {
        target: 'https://api.binance.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy\/binance/, ''),
        secure: true,
      },
      '/proxy/binance-futures': {
        target: 'https://fapi.binance.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy\/binance-futures/, ''),
        secure: true,
      },
      '/proxy/okx': {
        target: 'https://www.okx.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy\/okx/, ''),
        secure: true,
      },
      '/proxy/bybit': {
        target: 'https://api.bybit.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy\/bybit/, ''),
        secure: true,
      },
      '/proxy/gate': {
        target: 'https://api.gateio.ws',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy\/gate/, ''),
        secure: true,
      },
      '/proxy/bitget': {
        target: 'https://api.bitget.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy\/bitget/, ''),
        secure: true,
      },
      '/proxy/kucoin': {
        target: 'https://api.kucoin.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy\/kucoin/, ''),
        secure: true,
      },
      '/proxy/huobi': {
        target: 'https://api.huobi.pro',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy\/huobi/, ''),
        secure: true,
      },
      '/proxy/mexc': {
        target: 'https://api.mexc.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy\/mexc/, ''),
        secure: true,
      },
      '/llmapi/deepseek': {
        target: 'https://api.deepseek.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/llmapi\/deepseek/, ''),
        secure: true,
      },
      '/llmapi/openai': {
        target: 'https://api.openai.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/llmapi\/openai/, ''),
        secure: true,
      },
      '/llmapi/anthropic': {
        target: 'https://api.anthropic.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/llmapi\/anthropic/, ''),
        secure: true,
      },
      '/llmapi/perplexity': {
        target: 'https://api.perplexity.ai',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/llmapi\/perplexity/, ''),
        secure: true,
      },
      '/llmapi/gemini': {
        target: 'https://generativelanguage.googleapis.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/llmapi\/gemini/, ''),
        secure: true,
      },
      '/dataapi/cryptocompare': {
        target: 'https://min-api.cryptocompare.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/dataapi\/cryptocompare/, ''),
        secure: true,
      },
      '/dataapi/coingecko': {
        target: 'https://api.coingecko.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/dataapi\/coingecko/, ''),
        secure: true,
      },
      '/dataapi/alternative': {
        target: 'https://api.alternative.me',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/dataapi\/alternative/, ''),
        secure: true,
      },
      // DeFi Llama (免费, 无需API Key)
      '/dataapi/defillama': {
        target: 'https://api.llama.fi',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/dataapi\/defillama/, ''),
        secure: true,
      },
      // 公共扫描服务
      '/scanapi': {
        target: 'https://alphinel.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/scanapi/, ''),
        secure: true,
      },
    },
  },
})
