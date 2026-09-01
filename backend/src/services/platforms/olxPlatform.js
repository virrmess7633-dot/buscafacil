/**
 * olxPlatform.js
 * Adaptador da plataforma OLX. Dois métodos de coleta, nesta ordem de
 * preferência:
 *
 *   1. Apify — usado quando APIFY_API_TOKEN e APIFY_OLX_ACTOR_ID estão
 *      configurados. Recomendado: resolve o bloqueio Cloudflare/IP de
 *      datacenter sem precisarmos manter nossa própria infraestrutura de
 *      proxy.
 *   2. Scraper direto (olxClient.js + scraperService.js) — mantido como
 *      alternativa gratuita, mas sujeito ao bloqueio 403 já observado a
 *      partir do IP do Fly.io.
 *
 * SOBRE O ATOR DA APIFY ESCOLHIDO POR PADRÃO:
 * O valor de exemplo em README.md/.env.example é "scrapers_lat/olx-scraper",
 * que aceita uma "startUrl" — literalmente a URL de busca da OLX com os
 * filtros já aplicados, que é exatamente o que buildSearchUrl() já monta.
 * Isso é conveniente, mas atores da Apify são mantidos por terceiros/pela
 * comunidade e podem mudar de nome, preço ou formato de entrada/saída sem
 * aviso. Antes de depender disso em produção: abra o ator no Apify
 * Console, rode um teste manual, confira o formato real da resposta, e
 * ajuste normalizarItemApify() abaixo se os nomes de campo vierem
 * diferentes do que assumimos aqui.
 */

const { APIFY_API_TOKEN, APIFY_OLX_ACTOR_ID } = require('../../config/env');
const apifyClient = require('../apifyClient');
const scraperService = require('../scraperService');
const olxClient = require('../olxClient');

const ID = 'olx';
const NOME = 'OLX';

function montarEntradaAtor(perfil) {
  // Reaproveita a mesma lógica de montagem de URL do scraper direto —
  // assim os filtros (cidade, preço, quartos) ficam consistentes entre os
  // dois métodos de coleta.
  const startUrl = olxClient.buildSearchUrl(perfil, 1);
  return {
    startUrl,
    maxItems: 100,
    withDetails: true,
    // Proxy residencial brasileiro — necessário para passar da proteção
    // Cloudflare da OLX (confirmado por múltiplos scrapers de terceiros).
    proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'], apifyProxyCountry: 'BR' },
  };
}

/**
 * Tenta várias chaves possíveis, na ordem, e devolve o primeiro valor
 * definido — necessário porque não temos garantia de qual nome de campo
 * exato o ator escolhido usa (varia entre mantenedores).
 */
function pegar(obj, chaves) {
  for (const chave of chaves) {
    if (obj[chave] !== undefined && obj[chave] !== null && obj[chave] !== '') return obj[chave];
  }
  return null;
}

function numero(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function normalizarItemApify(item) {
  return {
    plataforma: ID,
    anuncioId: String(pegar(item, ['listId', 'id', 'adId', 'listingId']) || ''),
    titulo: pegar(item, ['title', 'subject', 'name']) || '',
    preco: numero(pegar(item, ['price', 'priceValue', 'priceBRL'])),
    endereco: pegar(item, ['location', 'address', 'neighbourhood', 'neighborhood']) || '',
    quartos: numero(pegar(item, ['rooms', 'bedrooms', 'quartos'])),
    banheiros: numero(pegar(item, ['bathrooms', 'banheiros'])),
    vagas: numero(pegar(item, ['parkingSpaces', 'garageSpaces', 'vagas'])),
    area: numero(pegar(item, ['size', 'area', 'usableArea'])),
    condominio: numero(pegar(item, ['condoFee', 'condominio'])),
    descricao: pegar(item, ['description', 'descricao']) || '',
    fotos: pegar(item, ['images', 'photos', 'fotos']) || [],
    linkAnuncio: pegar(item, ['url', 'link', 'adUrl']) || '',
    whatsapp: null, // raramente exposto por scrapers de terceiros
  };
}

async function buscarViaApify(perfil) {
  const itens = await apifyClient.executarAtor(APIFY_OLX_ACTOR_ID, montarEntradaAtor(perfil));
  return itens.map(normalizarItemApify).filter((l) => l.anuncioId);
}

async function buscarViaScraperDireto(perfil) {
  const { listings } = await scraperService.coletarParaPerfil(perfil);
  return listings.map((l) => ({
    ...l,
    plataforma: ID,
    anuncioId: l.olxId,
    linkAnuncio: l.linkOlx,
  }));
}

async function buscar(perfil) {
  if (APIFY_API_TOKEN && APIFY_OLX_ACTOR_ID) {
    return buscarViaApify(perfil);
  }
  return buscarViaScraperDireto(perfil);
}

module.exports = { id: ID, nome: NOME, buscar };
