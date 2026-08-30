/**
 * scraperService.js
 * Orquestra a coleta para um perfil: monta URLs, respeita rate limiting,
 * pagina resultados, busca detalhes e devolve uma lista "crua" de imóveis
 * (ainda sem score — quem avalia é o scoringEngine, chamado pelo
 * searchService.js).
 */

const olxClient = require('./olxClient');
const { SCRAPER_REQUEST_DELAY_MS, SCRAPER_MAX_PAGES_PER_RUN } = require('../config/env');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Cache simples em memória para evitar buscar o detalhe do mesmo anúncio
 * mais de uma vez por processo (o dedupe "permanente" por olxId já
 * acontece no listingModel; este cache só evita chamadas redundantes
 * dentro de uma mesma varredura/execução).
 */
const detailCache = new Map();

/**
 * Coleta imóveis da OLX para um perfil de busca.
 * @param {object} perfil perfil de busca (profileModel)
 * @param {object} opts { comDetalhes: boolean } — buscar página de detalhe
 *                        de cada anúncio (mais lento, mas traz descrição
 *                        completa e WhatsApp quando disponível)
 * @returns {Promise<Array>} lista de imóveis crus (shape parcial de listingModel)
 */
async function coletarParaPerfil(perfil, { comDetalhes = true } = {}) {
  const resultados = [];
  let pagina = 1;
  let paginasComResultado = 0;

  while (pagina <= SCRAPER_MAX_PAGES_PER_RUN) {
    const url = olxClient.buildSearchUrl(perfil, pagina);
    let html;
    try {
      html = await olxClient.fetchSearchPageHtml(url);
    } catch (err) {
      // Falha controlada: loga e para de paginar, mas não derruba o worker.
      throw new ScraperError(`Falha ao buscar página ${pagina} (${url}): ${err.message}`, { url, pagina, causa: err });
    }

    const anunciosDaPagina = olxClient.parseListingsFromHtml(html);
    if (!anunciosDaPagina.length) break; // fim da paginação

    resultados.push(...anunciosDaPagina);
    paginasComResultado += 1;
    pagina += 1;

    await sleep(SCRAPER_REQUEST_DELAY_MS); // respeita rate limit entre páginas
  }

  if (comDetalhes) {
    for (let i = 0; i < resultados.length; i++) {
      const item = resultados[i];
      try {
        const detalhe = await buscarDetalheComCache(item.olxId, item.linkOlx);
        resultados[i] = { ...item, ...detalhe, fotos: detalhe.fotos?.length ? detalhe.fotos : item.fotos };
      } catch (err) {
        // Um anúncio individual falhar não deve derrubar a varredura toda.
        resultados[i] = { ...item, descricao: item.descricao || '' };
      }
      if (i < resultados.length - 1) await sleep(SCRAPER_REQUEST_DELAY_MS);
    }
  }

  return { listings: resultados, paginasVarridas: paginasComResultado };
}

async function buscarDetalheComCache(olxId, linkOlx) {
  if (detailCache.has(olxId)) return detailCache.get(olxId);
  const detalhe = await olxClient.fetchListingDetail(linkOlx);
  detailCache.set(olxId, detalhe);
  return detalhe;
}

class ScraperError extends Error {
  constructor(message, context) {
    super(message);
    this.name = 'ScraperError';
    this.context = context;
  }
}

module.exports = { coletarParaPerfil, ScraperError };
