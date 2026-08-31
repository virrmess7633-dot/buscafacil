/**
 * olxClient.js
 * Módulo de coleta de dados da OLX — item 2 do prompt.
 *
 * ATENÇÃO / MANUTENÇÃO:
 * A OLX pode alterar a estrutura HTML e o payload JSON embutido na página
 * (`__NEXT_DATA__` ou similar) a qualquer momento, sem aviso. Este módulo
 * isola TODA a lógica dependente de estrutura de página em dois pontos:
 *   1. buildSearchUrl()   -> como montamos a URL de busca
 *   2. parseListingsFromHtml() -> como extraímos os anúncios do HTML
 * Se a coleta parar de funcionar, o primeiro lugar a olhar é este arquivo.
 * Recomenda-se also verificar periodicamente `${OLX_BASE_URL}/robots.txt`
 * e os Termos de Uso da OLX antes de rodar isso em produção — o scraping
 * deve respeitar as regras da plataforma (rate limiting já está embutido
 * no scraperService.js).
 *
 * Este arquivo não instala nada nem faz chamadas de rede sozinho — apenas
 * define como fazê-las. As dependências (axios, cheerio) precisam ser
 * instaladas via `npm install` (ver package.json).
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');
const { HttpsProxyAgent } = require('https-proxy-agent');
const {
  OLX_BASE_URL,
  SCRAPER_USER_AGENT,
  SCRAPER_TIMEOUT_MS,
  SCRAPER_PROXY_URL,
} = require('../config/env');

/**
 * Sessão HTTP com jar de cookies (compartilhado entre as chamadas) e um
 * conjunto de headers que imita um navegador real. A OLX (como muitos
 * sites com proteção anti-scraping tipo Cloudflare) costuma bloquear com
 * 403 requisições "cruas" sem cookies de sessão prévios e sem os headers
 * que um navegador de verdade sempre envia.
 *
 * IMPORTANTE: isso reduz a chance de bloqueio, mas não elimina — se a
 * proteção da OLX for baseada em reputação de IP (bloquear faixas de
 * datacenter/cloud, como as do Fly.io), nenhum ajuste de headers resolve
 * sozinho. Ver nota no final deste arquivo sobre o plano B (navegador
 * headless) caso o 403 persista mesmo com esta mudança.
 */
const jar = new CookieJar();
const httpClient = wrapper(
  axios.create({
    jar,
    withCredentials: true,
    timeout: SCRAPER_TIMEOUT_MS,
    // Se SCRAPER_PROXY_URL estiver configurado (formato
    // http://usuario:senha@host:porta), roteia as requisições por ele —
    // útil quando o bloqueio da OLX é por reputação do IP do servidor,
    // não pelos headers da requisição. Ver env.js e README.md.
    ...(SCRAPER_PROXY_URL ? { httpsAgent: new HttpsProxyAgent(SCRAPER_PROXY_URL) } : {}),
    headers: {
      'User-Agent': SCRAPER_USER_AGENT,
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
  })
);

let sessaoAquecida = false;

/**
 * Visita a home da OLX uma vez por processo para receber os cookies de
 * sessão (ex.: identificadores anti-bot) antes de bater direto na página
 * de busca — imitando o comportamento de um usuário real navegando.
 */
async function aquecerSessao() {
  if (sessaoAquecida) return;
  try {
    await httpClient.get(OLX_BASE_URL);
    sessaoAquecida = true;
  } catch (err) {
    // Se nem a home responde, deixamos a tentativa seguinte revelar o erro real.
  }
}

const TIPO_IMOVEL_SLUG = {
  apartamento: 'apartamentos',
  casa: 'casas',
  kitnet: 'kitnet-conjugados',
  quitinete: 'kitnet-conjugados',
  studio: 'kitnet-conjugados',
};

/**
 * Monta a URL de busca da OLX a partir de um perfil de configuração.
 * A estrutura de path/query abaixo segue o padrão público de busca de
 * "Imóveis para Alugar" da OLX Brasil (categoria 1020). Ajuste os slugs
 * de cidade/tipo conforme necessário caso a OLX altere as rotas.
 */
function buildSearchUrl(perfil, pagina = 1) {
  const cidadeSlug = slugify(perfil.localizacao?.cidade || '');
  const tipoSlugs = (perfil.tipoImovel || [])
    .map((t) => TIPO_IMOVEL_SLUG[t.toLowerCase()])
    .filter(Boolean);

  // Categoria 1020 = Imóveis para Alugar (ajustar se a OLX renumerar)
  let path = cidadeSlug
    ? `/imoveis/aluguel/estado-pb/${cidadeSlug}`
    : '/imoveis/aluguel';
  if (tipoSlugs.length === 1) {
    path += `/${tipoSlugs[0]}`;
  }

  const params = new URLSearchParams();
  if (perfil.precoMin) params.set('pe', String(perfil.precoMin));
  if (perfil.precoMax) params.set('pe', String(perfil.precoMax)); // OLX usa "ps"/"pe" para faixa
  if (perfil.precoMin) params.set('ps', String(perfil.precoMin));
  if (perfil.quartosMin) params.set('rooms', String(perfil.quartosMin));
  if (pagina > 1) params.set('o', String(pagina));

  const query = params.toString();
  return `${OLX_BASE_URL}${path}${query ? `?${query}` : ''}`;
}

function slugify(str) {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

async function fetchSearchPageHtml(url) {
  await aquecerSessao();
  const { data } = await httpClient.get(url, {
    headers: { Referer: OLX_BASE_URL },
  });
  return data;
}

/**
 * Extrai a lista de anúncios "resumidos" (como aparecem na página de busca)
 * a partir do HTML. Retorna dados parciais — detalhes completos (descrição,
 * WhatsApp) são obtidos depois via fetchListingDetail().
 *
 * A OLX injeta um JSON de estado da aplicação em uma tag <script id="__NEXT_DATA__">
 * na maioria de suas páginas Next.js. Preferimos parsear esse JSON quando
 * disponível (mais estável que depender de classes CSS). Como fallback,
 * tentamos seletores CSS diretos.
 */
function parseListingsFromHtml(html) {
  const $ = cheerio.load(html);

  // --- Tentativa 1: JSON embutido (__NEXT_DATA__) ---
  const nextDataRaw = $('#__NEXT_DATA__').html();
  if (nextDataRaw) {
    try {
      const json = JSON.parse(nextDataRaw);
      const ads = extrairAnunciosDoNextData(json);
      if (ads.length) return ads;
    } catch (err) {
      // segue para o fallback de seletores CSS
    }
  }

  // --- Tentativa 2: fallback via seletores CSS ---
  // Estes seletores são um ponto de manutenção conhecido: inspecione a
  // página de busca da OLX no navegador e ajuste conforme necessário.
  const anuncios = [];
  $('[data-ds-component="DS-AdCard"], li.ad-list-item, div[data-testid="ad-card"]').each((_, el) => {
    const $el = $(el);
    const linkOlx = $el.find('a').first().attr('href');
    const titulo = $el.find('h2, [data-ds-component="DS-Text"]').first().text().trim();
    const precoTexto = $el.find('[data-testid="ad-price"], .price').first().text().trim();
    const enderecoTexto = $el.find('[data-testid="ad-location"], .location').first().text().trim();
    const imagem = $el.find('img').first().attr('src');

    if (!linkOlx || !titulo) return;

    anuncios.push({
      olxId: extrairOlxIdDaUrl(linkOlx),
      titulo,
      preco: parsePreco(precoTexto),
      endereco: enderecoTexto,
      linkOlx: linkOlx.startsWith('http') ? linkOlx : `${OLX_BASE_URL}${linkOlx}`,
      fotos: imagem ? [imagem] : [],
    });
  });

  return anuncios.filter((a) => a.olxId);
}

/**
 * Navega pela estrutura do __NEXT_DATA__ procurando a lista de anúncios.
 * A chave exata (`props.pageProps.ads`, `.listings`, etc.) varia conforme
 * a versão do front da OLX — por isso fazemos uma busca heurística por
 * arrays de objetos que "parecem" anúncios (têm listId/price/title).
 */
function extrairAnunciosDoNextData(json) {
  const encontrados = [];

  function parece_anuncio(obj) {
    return obj && typeof obj === 'object' && ('listId' in obj || 'id' in obj) && ('price' in obj || 'priceValue' in obj);
  }

  function walk(node) {
    if (Array.isArray(node)) {
      if (node.length && node.every(parece_anuncio)) {
        for (const item of node) encontrados.push(normalizarAnuncioNextData(item));
        return;
      }
      node.forEach(walk);
    } else if (node && typeof node === 'object') {
      Object.values(node).forEach(walk);
    }
  }

  walk(json);
  return encontrados.filter((a) => a.olxId);
}

function normalizarAnuncioNextData(item) {
  return {
    olxId: String(item.listId || item.id || ''),
    titulo: item.title || item.subject || '',
    preco: parsePreco(item.price || item.priceValue || ''),
    endereco: item.locationDetails
      ? [item.locationDetails.neighbourhood, item.locationDetails.municipality].filter(Boolean).join(', ')
      : item.location || '',
    linkOlx: item.url ? (item.url.startsWith('http') ? item.url : `${OLX_BASE_URL}${item.url}`) : '',
    fotos: item.images ? item.images.map((img) => img.originalImage || img.url).filter(Boolean) : [],
    // Campos abaixo geralmente só vêm completos na página de detalhe:
    quartos: extrairPropriedade(item, ['rooms', 'quartos']),
    banheiros: extrairPropriedade(item, ['bathrooms', 'banheiros']),
    vagas: extrairPropriedade(item, ['garage_spaces', 'vagas']),
    area: extrairPropriedade(item, ['size', 'area', 'm2']),
  };
}

function extrairPropriedade(item, chaves) {
  if (item.properties && Array.isArray(item.properties)) {
    const prop = item.properties.find((p) => chaves.includes(p.name || p.label));
    if (prop) return parseNumero(prop.value);
  }
  for (const chave of chaves) {
    if (item[chave] !== undefined) return parseNumero(item[chave]);
  }
  return null;
}

function extrairOlxIdDaUrl(url) {
  const match = url.match(/-(\d{6,})$/) || url.match(/\/(\d{6,})/);
  return match ? match[1] : null;
}

function parsePreco(texto) {
  if (typeof texto === 'number') return texto;
  if (!texto) return null;
  const limpo = String(texto).replace(/[^\d,]/g, '').replace(',', '.');
  const n = parseFloat(limpo);
  return Number.isFinite(n) ? n : null;
}

function parseNumero(texto) {
  if (typeof texto === 'number') return texto;
  if (!texto) return null;
  const n = parseFloat(String(texto).replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Busca a página de detalhe de um anúncio para extrair descrição completa,
 * mais fotos e (quando disponível) o contato de WhatsApp do anunciante.
 * A OLX normalmente expõe o WhatsApp só após interação (botão "Ver telefone"),
 * então em muitos casos este campo virá null — nesse caso o app deve
 * direcionar para o próprio anúncio (linkOlx), conforme item 4 do prompt.
 */
async function fetchListingDetail(linkOlx) {
  const html = await fetchSearchPageHtml(linkOlx);
  const $ = cheerio.load(html);

  const nextDataRaw = $('#__NEXT_DATA__').html();
  let detalhe = {};
  if (nextDataRaw) {
    try {
      const json = JSON.parse(nextDataRaw);
      detalhe = extrairDetalheDoNextData(json);
    } catch (err) {
      // fallback abaixo
    }
  }

  if (!detalhe.descricao) {
    detalhe.descricao = $('[data-ds-component="DS-Text"][data-testid="ad-description"], .ad__description').first().text().trim();
  }
  if (!detalhe.fotos || !detalhe.fotos.length) {
    detalhe.fotos = $('img[data-testid="ad-image"], .image-gallery img')
      .map((_, el) => $(el).attr('src'))
      .get()
      .filter(Boolean);
  }

  return detalhe;
}

function extrairDetalheDoNextData(json) {
  const resultado = { descricao: null, fotos: [], whatsapp: null, mobiliado: null, aceitaPets: null, condominio: null, andar: null, temElevador: null };

  function walk(node) {
    if (node && typeof node === 'object') {
      if (node.description && !resultado.descricao) resultado.descricao = node.description;
      if (node.phone && !resultado.whatsapp) resultado.whatsapp = limparTelefone(node.phone);
      if (node.whatsapp && !resultado.whatsapp) resultado.whatsapp = limparTelefone(node.whatsapp);
      Object.values(node).forEach(walk);
    }
  }
  walk(json);
  return resultado;
}

function limparTelefone(numero) {
  if (!numero) return null;
  let limpo = String(numero).replace(/\D/g, '');
  if (limpo.length <= 11) limpo = `55${limpo}`; // assume Brasil se faltar DDI
  return limpo;
}

module.exports = {
  buildSearchUrl,
  fetchSearchPageHtml,
  parseListingsFromHtml,
  fetchListingDetail,
  slugify,
  parsePreco,
};

/**
 * PLANO B — se o 403 persistir mesmo com cookies de sessão e headers de
 * navegador (ver comentário no topo do arquivo):
 *
 * Isso indica que o bloqueio é por REPUTAÇÃO DE IP, não por "parecer bot"
 * na requisição — comum em provedores de nuvem (Fly.io, AWS, etc.), já
 * que sites com proteção anti-scraping costumam listar faixas de IP de
 * datacenter como suspeitas por padrão, independente dos headers enviados.
 *
 * Duas saídas possíveis, em ordem de esforço:
 *
 * 1. Rodar o worker (scraperService/worker.js) a partir de uma máquina
 *    com IP residencial/doméstico em vez do Fly.io — por exemplo, seu
 *    próprio computador ou um mini-servidor em casa, deixando só a API
 *    web (server.js) no Fly. É a mudança mais simples, mas exige deixar
 *    uma máquina sua ligada continuamente.
 *
 * 2. Rotear as requisições de scraping por um serviço de proxy
 *    residencial (pago) — mantém tudo no Fly, mas adiciona custo e mais
 *    uma peça de infraestrutura para gerenciar.
 *
 * Trocar para um navegador headless (Puppeteer/Playwright) SOZINHO não
 * resolve bloqueio por IP — ele ajuda quando o obstáculo é um desafio
 * JavaScript (tipo "verificando seu navegador..."), não quando é a faixa
 * de IP em si que está na lista de bloqueio.
 */
