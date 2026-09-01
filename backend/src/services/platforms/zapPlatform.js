/**
 * zapPlatform.js
 * Adaptador da plataforma ZAP Imóveis (zapimoveis.com.br).
 *
 * Diferente da OLX, não construímos um scraper direto para o ZAP nesta
 * versão — a coleta acontece exclusivamente via Apify. Se
 * APIFY_API_TOKEN ou APIFY_ZAP_ACTOR_ID não estiverem configurados, esta
 * plataforma simplesmente não retorna resultados (falha controlada, não
 * derruba a varredura dos outros perfis/plataformas).
 *
 * SOBRE O ATOR DA APIFY ESCOLHIDO POR PADRÃO:
 * O valor de exemplo em README.md/.env.example é "haketa/zapimoveis-scraper",
 * que documenta um formato de entrada rico (business, states, cities,
 * neighborhoods, minPrice/maxPrice, minBedrooms, minParkingSpaces) e um
 * formato de saída com campos como listingId/neighborhood/priceBRL/
 * usableArea. Como em olxPlatform.js: teste o ator escolhido manualmente
 * no Apify Console antes de depender disso em produção, e ajuste
 * normalizarItemApify()/montarEntradaAtor() se necessário — atores de
 * terceiros podem mudar sem aviso.
 */

const { APIFY_API_TOKEN, APIFY_ZAP_ACTOR_ID } = require('../../config/env');
const apifyClient = require('../apifyClient');
const { slugify } = require('../olxClient');

const ID = 'zap';
const NOME = 'ZAP Imóveis';

function montarEntradaAtor(perfil) {
  return {
    mode: 'listings',
    portal: 'ZAP',
    business: ['RENTAL'],
    usageTypes: ['RESIDENTIAL'],
    // O ZAP exige a sigla do estado (UF) na busca. O perfil de busca do
    // Radar de Imóveis não tem esse campo por padrão — se
    // perfil.localizacao.uf não estiver preenchido, o ator pode retornar
    // vazio ou exigir ajuste manual aqui.
    states: perfil.localizacao?.uf ? [perfil.localizacao.uf] : undefined,
    cities: perfil.localizacao?.cidade ? [slugify(perfil.localizacao.cidade)] : undefined,
    neighborhoods: (perfil.localizacao?.bairros || []).map(slugify),
    minPrice: perfil.precoMin ?? undefined,
    maxPrice: perfil.precoMax ?? undefined,
    minBedrooms: perfil.quartosMin ?? undefined,
    minParkingSpaces: perfil.vagasMin ?? undefined,
    maxListings: 100,
  };
}

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
    anuncioId: String(pegar(item, ['listingId', 'id', 'adId']) || ''),
    titulo: pegar(item, ['title', 'name']) || `Imóvel em ${pegar(item, ['neighborhood', 'address']) || 'local não informado'}`,
    preco: numero(pegar(item, ['priceBRL', 'price', 'rentPrice'])),
    endereco: pegar(item, ['address', 'neighborhood', 'street']) || '',
    quartos: numero(pegar(item, ['bedrooms', 'rooms'])),
    banheiros: numero(pegar(item, ['bathrooms'])),
    vagas: numero(pegar(item, ['parkingSpaces'])),
    area: numero(pegar(item, ['usableArea', 'area', 'totalArea'])),
    condominio: numero(pegar(item, ['condoFee', 'condominium'])),
    descricao: pegar(item, ['description']) || '',
    fotos: pegar(item, ['images', 'photos']) || [],
    linkAnuncio: pegar(item, ['url', 'link']) || '',
    whatsapp: null,
  };
}

async function buscar(perfil) {
  if (!APIFY_API_TOKEN || !APIFY_ZAP_ACTOR_ID) {
    return []; // plataforma não configurada — falha silenciosa e controlada
  }
  const itens = await apifyClient.executarAtor(APIFY_ZAP_ACTOR_ID, montarEntradaAtor(perfil));
  return itens.map(normalizarItemApify).filter((l) => l.anuncioId);
}

module.exports = { id: ID, nome: NOME, buscar };
