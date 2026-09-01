/**
 * env.js
 * Carrega variáveis de ambiente e expõe defaults centralizados.
 * Nunca commitar um .env real — use .env.example como referência.
 */

require('dotenv').config();
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', '..', 'data');

module.exports = {
  PORT: parseInt(process.env.PORT || '3000', 10),

  DATA_DIR,
  PROFILES_FILE: path.join(DATA_DIR, 'profiles.json'),
  LISTINGS_FILE: path.join(DATA_DIR, 'listings.json'),
  LOGS_FILE: path.join(DATA_DIR, 'scan-logs.json'),

  // --- Apify (serviço de scraping de terceiros — método recomendado para
  // OLX e ZAP Imóveis, já resolve Cloudflare/bloqueio de IP; ver
  // README.md > "Buscando via Apify") ---
  APIFY_API_TOKEN: process.env.APIFY_API_TOKEN || '',
  // IDs no formato "dono/nome-do-ator". Deixe em branco para usar o
  // scraper direto como alternativa gratuita (só existe para OLX; ZAP
  // Imóveis funciona exclusivamente via Apify nesta versão).
  APIFY_OLX_ACTOR_ID: process.env.APIFY_OLX_ACTOR_ID || '',
  APIFY_ZAP_ACTOR_ID: process.env.APIFY_ZAP_ACTOR_ID || '',

  // --- Scraper direto (fallback gratuito, só para OLX) ---
  OLX_BASE_URL: process.env.OLX_BASE_URL || 'https://www.olx.com.br',
  SCRAPER_USER_AGENT:
    process.env.SCRAPER_USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  SCRAPER_REQUEST_DELAY_MS: parseInt(process.env.SCRAPER_REQUEST_DELAY_MS || '2500', 10),
  SCRAPER_MAX_PAGES_PER_RUN: parseInt(process.env.SCRAPER_MAX_PAGES_PER_RUN || '3', 10),
  SCRAPER_TIMEOUT_MS: parseInt(process.env.SCRAPER_TIMEOUT_MS || '15000', 10),
  // URL de um proxy residencial/móvel, no formato:
  //   http://usuario:senha@host:porta
  // Deixe vazio para não usar proxy (requisição direta do IP do servidor).
  // Ver README.md > "Se a OLX continuar bloqueando (403)" para contexto.
  SCRAPER_PROXY_URL: process.env.SCRAPER_PROXY_URL || '',

  // --- Worker / agendamento ---
  SCAN_CRON: process.env.SCAN_CRON || '*/10 * * * *', // a cada 10 min
  NOTIFY_MIN_SCORE: parseFloat(process.env.NOTIFY_MIN_SCORE || '70'),

  // --- Telegram ---
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_ADMIN_CHAT_IDS: (process.env.TELEGRAM_ADMIN_CHAT_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // --- Scoring: pesos padrão (podem ser sobrescritos por perfil) ---
  DEFAULT_WEIGHTS: {
    preco: 0.30,
    localizacao: 0.25,
    quartos: 0.15,
    area: 0.15,
    extras: 0.15, // mobiliado, pet, condomínio, palavras-chave, andar/elevador
  },
};
