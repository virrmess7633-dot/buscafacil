/**
 * listingModel.js
 * Armazena os imóveis coletados da OLX, com deduplicação por ID do anúncio
 * e histórico de primeira detecção — item 2 do prompt.
 */

const JsonStore = require('../config/jsonStore');
const { LISTINGS_FILE } = require('../config/env');

const store = new JsonStore(LISTINGS_FILE, []);

/**
 * Shape de um listing:
 * {
 *   olxId: string,            // ID único do anúncio na OLX (chave de dedupe)
 *   profileId: string,        // perfil de busca que originou a coleta
 *   titulo, preco, endereco, tipoImovel,
 *   quartos, banheiros, vagas, area, andar, temElevador,
 *   mobiliado, aceitaPets, condominio,
 *   descricao, fotos: string[],
 *   linkOlx: string,
 *   whatsapp: string|null,    // número já limpo, formato E.164 quando possível
 *   score: number,            // 0-100, calculado pelo scoring engine
 *   scoreResumo: string,      // texto explicando pontos fortes/fracos
 *   scoreDetalhes: object,    // breakdown por critério
 *   status: 'novo'|'notificado'|'favorito'|'descartado'|'visto',
 *   primeiraDeteccaoEm: string (ISO),
 *   atualizadoEm: string (ISO),
 * }
 */

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

function buscarPorOlxId(olxId) {
  return store.read().find((l) => l.olxId === olxId) || null;
}

/**
 * Insere ou atualiza um lote de imóveis coletados (upsert por olxId).
 * Retorna { novos, atualizados } para fins de log/notificação.
 */
async function upsertLote(listingsColetados) {
  const existentes = store.read();
  const porId = new Map(existentes.map((l) => [l.olxId, l]));
  const novos = [];
  const atualizados = [];

  for (const coletado of listingsColetados) {
    const anterior = porId.get(coletado.olxId);
    if (!anterior) {
      const registro = {
        ...coletado,
        status: 'novo',
        primeiraDeteccaoEm: new Date().toISOString(),
        atualizadoEm: new Date().toISOString(),
      };
      porId.set(coletado.olxId, registro);
      novos.push(registro);
    } else {
      const registro = {
        ...anterior,
        ...coletado,
        status: anterior.status, // preserva favorito/descartado/notificado
        primeiraDeteccaoEm: anterior.primeiraDeteccaoEm,
        atualizadoEm: new Date().toISOString(),
      };
      porId.set(coletado.olxId, registro);
      atualizados.push(registro);
    }
  }

  await store.write(Array.from(porId.values()));
  return { novos, atualizados };
}

async function atualizarStatus(olxId, status) {
  const validos = ['novo', 'notificado', 'favorito', 'descartado', 'visto'];
  if (!validos.includes(status)) {
    throw new Error(`Status inválido: ${status}. Use um de: ${validos.join(', ')}`);
  }
  const listings = store.read();
  const idx = listings.findIndex((l) => l.olxId === olxId);
  if (idx === -1) throw new Error(`Imóvel ${olxId} não encontrado.`);
  listings[idx].status = status;
  listings[idx].atualizadoEm = new Date().toISOString();
  await store.write(listings);
  return listings[idx];
}

module.exports = {
  listarPorPerfil,
  listarTodos,
  buscarPorOlxId,
  upsertLote,
  atualizarStatus,
};
