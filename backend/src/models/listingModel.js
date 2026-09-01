/**
 * listingModel.js
 * Armazena os imóveis coletados (de qualquer plataforma suportada — OLX,
 * ZAP Imóveis, etc.), com deduplicação e histórico de primeira detecção.
 *
 * A chave de deduplicação é o par (plataforma, anuncioId), não só o ID
 * do anúncio isolado — necessário desde que o sistema passou a buscar em
 * mais de uma fonte: dois anúncios de plataformas diferentes podem, em
 * teoria, ter o mesmo ID numérico por coincidência.
 */

const JsonStore = require('../config/jsonStore');
const { LISTINGS_FILE } = require('../config/env');

const store = new JsonStore(LISTINGS_FILE, []);

/**
 * Shape de um listing:
 * {
 *   plataforma: 'olx'|'zap',   // fonte do anúncio
 *   anuncioId: string,         // ID único do anúncio NA PLATAFORMA (chave de dedupe, junto com "plataforma")
 *   profileId: string,         // perfil de busca que originou a coleta
 *   titulo, preco, endereco, tipoImovel,
 *   quartos, banheiros, vagas, area, andar, temElevador,
 *   mobiliado, aceitaPets, condominio,
 *   descricao, fotos: string[],
 *   linkAnuncio: string,       // link direto pro anúncio na plataforma de origem
 *   whatsapp: string|null,     // número já limpo, formato E.164 quando possível
 *   score: number,             // 0-100, calculado pelo scoring engine
 *   scoreResumo: string,       // texto explicando pontos fortes/fracos
 *   scoreDetalhes: object,     // breakdown por critério
 *   status: 'novo'|'notificado'|'favorito'|'descartado'|'visto',
 *   primeiraDeteccaoEm: string (ISO),
 *   atualizadoEm: string (ISO),
 * }
 */

function chave(plataforma, anuncioId) {
  return `${plataforma}:${anuncioId}`;
}

function listarPorPerfil(profileId, { minScore } = {}) {
  let listings = store.read().filter((l) => l.profileId === profileId);
  if (typeof minScore === 'number') {
    listings = listings.filter((l) => l.score >= minScore);
  }
  return listings.sort((a, b) => b.score - a.score);
}

function listarTodos({ minScore } = {}) {
  let listings = store.read();
  if (typeof minScore === 'number') {
    listings = listings.filter((l) => l.score >= minScore);
  }
  return listings.sort((a, b) => b.score - a.score);
}

function buscarPorChave(plataforma, anuncioId) {
  return store.read().find((l) => l.plataforma === plataforma && l.anuncioId === anuncioId) || null;
}

/**
 * Insere ou atualiza um lote de imóveis coletados (upsert por
 * plataforma+anuncioId). Retorna { novos, atualizados } para fins de
 * log/notificação.
 */
async function upsertLote(listingsColetados) {
  const existentes = store.read();
  const porChave = new Map(existentes.map((l) => [chave(l.plataforma, l.anuncioId), l]));
  const novos = [];
  const atualizados = [];

  for (const coletado of listingsColetados) {
    const k = chave(coletado.plataforma, coletado.anuncioId);
    const anterior = porChave.get(k);
    if (!anterior) {
      const registro = {
        ...coletado,
        status: 'novo',
        primeiraDeteccaoEm: new Date().toISOString(),
        atualizadoEm: new Date().toISOString(),
      };
      porChave.set(k, registro);
      novos.push(registro);
    } else {
      const registro = {
        ...anterior,
        ...coletado,
        status: anterior.status, // preserva favorito/descartado/notificado
        primeiraDeteccaoEm: anterior.primeiraDeteccaoEm,
        atualizadoEm: new Date().toISOString(),
      };
      porChave.set(k, registro);
      atualizados.push(registro);
    }
  }

  await store.write(Array.from(porChave.values()));
  return { novos, atualizados };
}

async function atualizarStatus(plataforma, anuncioId, status) {
  const validos = ['novo', 'notificado', 'favorito', 'descartado', 'visto'];
  if (!validos.includes(status)) {
    throw new Error(`Status inválido: ${status}. Use um de: ${validos.join(', ')}`);
  }
  const listings = store.read();
  const idx = listings.findIndex((l) => l.plataforma === plataforma && l.anuncioId === anuncioId);
  if (idx === -1) throw new Error(`Imóvel ${plataforma}:${anuncioId} não encontrado.`);
  listings[idx].status = status;
  listings[idx].atualizadoEm = new Date().toISOString();
  await store.write(listings);
  return listings[idx];
}

module.exports = {
  listarPorPerfil,
  listarTodos,
  buscarPorChave,
  upsertLote,
  atualizarStatus,
};
