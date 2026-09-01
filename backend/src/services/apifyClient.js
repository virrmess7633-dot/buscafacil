/**
 * apifyClient.js
 * Wrapper fino sobre a API REST da Apify (https://apify.com) — usado para
 * rodar "atores" (scrapers prontos, mantidos por terceiros ou pela
 * comunidade) que já lidam com Cloudflare/bloqueio de IP por trás de
 * proxies residenciais, em vez de fazer scraping direto do nosso servidor.
 *
 * Isso resolve o problema descrito no README (seção "Se a OLX continuar
 * bloqueando"): o bloqueio 403 que a OLX retorna para o IP do Fly.io é,
 * com boa confiança, proteção Cloudflare por reputação de IP de
 * datacenter — pagar por um serviço de scraping que já roda atrás de
 * proxies residenciais brasileiros ataca a causa raiz sem exigirmos criar
 * nossa própria infraestrutura de proxy.
 *
 * Não usamos o SDK oficial (`apify-client`) para manter as dependências
 * enxutas — a API REST é simples o suficiente para uma chamada via axios.
 */

const axios = require('axios');
const { APIFY_API_TOKEN } = require('../config/env');

/**
 * Roda um ator até o fim e retorna os itens do dataset resultante.
 * Endpoint: POST /v2/acts/{actorId}/run-sync-get-dataset-items
 * (documentado em https://docs.apify.com/api/v2 — "Run Actor synchronously
 * and get dataset items").
 *
 * @param {string} actorId no formato "dono/nome-do-ator" (ex.: "scrapers_lat/olx-scraper")
 * @param {object} input payload de entrada específico do ator escolhido
 * @param {object} opts { timeoutMs }
 * @returns {Promise<object[]>} itens do dataset (formato depende do ator)
 */
async function executarAtor(actorId, input, { timeoutMs = 120000 } = {}) {
  if (!APIFY_API_TOKEN) {
    throw new Error('APIFY_API_TOKEN não configurado — veja README.md > "Buscando via Apify".');
  }
  if (!actorId) {
    throw new Error('ID do ator da Apify não configurado para esta plataforma.');
  }

  const url = `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items`;

  const { data } = await axios.post(url, input, {
    params: { token: APIFY_API_TOKEN },
    timeout: timeoutMs,
  });

  return Array.isArray(data) ? data : [];
}

module.exports = { executarAtor };
