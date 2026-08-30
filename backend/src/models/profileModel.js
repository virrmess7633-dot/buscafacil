/**
 * profileModel.js
 * CRUD de "perfis de busca" — a configuração de especificações do item 1
 * do prompt (cidade, faixa de preço, tipo de imóvel, quartos, m², etc.).
 *
 * Vários perfis podem coexistir (ex.: um para o usuário, outro para um
 * cliente), cada um com seus próprios pesos de scoring e destino no Telegram.
 */

const crypto = require('crypto');
const JsonStore = require('../config/jsonStore');
const { PROFILES_FILE, DEFAULT_WEIGHTS } = require('../config/env');

const store = new JsonStore(PROFILES_FILE, []);

/**
 * Shape de um perfil (documentação viva do "schema"):
 * {
 *   id: string,
 *   nome: string,
 *   ativo: boolean,
 *   localizacao: {
 *     cidade: string,
 *     bairros: string[],          // opcional
 *     lat: number|null,           // opcional, para busca por raio
 *     lng: number|null,
 *     raioKm: number|null,
 *   },
 *   precoMin: number|null,
 *   precoMax: number|null,
 *   tipoImovel: string[],         // ['apartamento','casa','kitnet',...]
 *   quartosMin: number|null,
 *   quartosMax: number|null,
 *   banheirosMin: number|null,
 *   vagasMin: number|null,
 *   areaMin: number|null,
 *   areaMax: number|null,
 *   mobiliado: 'sim'|'nao'|'indiferente',
 *   aceitaPets: 'sim'|'nao'|'indiferente',
 *   condominioMax: number|null,
 *   palavrasIncluir: string[],
 *   palavrasExcluir: string[],
 *   andarMax: number|null,
 *   exigeElevador: boolean,
 *   pesos: { preco, localizacao, quartos, area, extras },  // somam 1.0
 *   notificacao: {
 *     scoreMinimo: number,        // sobrescreve NOTIFY_MIN_SCORE global
 *     telegramChatIds: string[],  // grupos/comunidades de destino
 *   },
 *   criadoEm: string (ISO),
 *   atualizadoEm: string (ISO),
 * }
 */

function novoId() {
  return crypto.randomUUID();
}

function validarPesos(pesos) {
  const soma = Object.values(pesos).reduce((a, b) => a + b, 0);
  if (Math.abs(soma - 1) > 0.01) {
    throw new Error(
      `A soma dos pesos deve ser 1.0 (100%). Soma atual: ${soma.toFixed(2)}`
    );
  }
}

function normalizarPerfil(input, existente = {}) {
  const pesos = { ...DEFAULT_WEIGHTS, ...(existente.pesos || {}), ...(input.pesos || {}) };
  validarPesos(pesos);

  return {
    id: existente.id || novoId(),
    nome: input.nome ?? existente.nome ?? 'Perfil sem nome',
    ativo: input.ativo ?? existente.ativo ?? true,
    localizacao: {
      cidade: input.localizacao?.cidade ?? existente.localizacao?.cidade ?? '',
      bairros: input.localizacao?.bairros ?? existente.localizacao?.bairros ?? [],
      lat: input.localizacao?.lat ?? existente.localizacao?.lat ?? null,
      lng: input.localizacao?.lng ?? existente.localizacao?.lng ?? null,
      raioKm: input.localizacao?.raioKm ?? existente.localizacao?.raioKm ?? null,
    },
    precoMin: input.precoMin ?? existente.precoMin ?? null,
    precoMax: input.precoMax ?? existente.precoMax ?? null,
    tipoImovel: input.tipoImovel ?? existente.tipoImovel ?? [],
    quartosMin: input.quartosMin ?? existente.quartosMin ?? null,
    quartosMax: input.quartosMax ?? existente.quartosMax ?? null,
    banheirosMin: input.banheirosMin ?? existente.banheirosMin ?? null,
    vagasMin: input.vagasMin ?? existente.vagasMin ?? null,
    areaMin: input.areaMin ?? existente.areaMin ?? null,
    areaMax: input.areaMax ?? existente.areaMax ?? null,
    mobiliado: input.mobiliado ?? existente.mobiliado ?? 'indiferente',
    aceitaPets: input.aceitaPets ?? existente.aceitaPets ?? 'indiferente',
    condominioMax: input.condominioMax ?? existente.condominioMax ?? null,
    palavrasIncluir: input.palavrasIncluir ?? existente.palavrasIncluir ?? [],
    palavrasExcluir: input.palavrasExcluir ?? existente.palavrasExcluir ?? [],
    andarMax: input.andarMax ?? existente.andarMax ?? null,
    exigeElevador: input.exigeElevador ?? existente.exigeElevador ?? false,
    pesos,
    notificacao: {
      scoreMinimo:
        input.notificacao?.scoreMinimo ?? existente.notificacao?.scoreMinimo ?? 70,
      telegramChatIds:
        input.notificacao?.telegramChatIds ?? existente.notificacao?.telegramChatIds ?? [],
    },
    criadoEm: existente.criadoEm || new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
  };
}

function listar() {
  return store.read();
}

function buscarPorId(id) {
  return store.read().find((p) => p.id === id) || null;
}

async function criar(input) {
  if (!input.nome) throw new Error('Campo "nome" é obrigatório.');
  const perfil = normalizarPerfil(input);
  const perfis = store.read();
  perfis.push(perfil);
  await store.write(perfis);
  return perfil;
}

async function atualizar(id, input) {
  const perfis = store.read();
  const idx = perfis.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error(`Perfil ${id} não encontrado.`);
  const atualizado = normalizarPerfil(input, perfis[idx]);
  perfis[idx] = atualizado;
  await store.write(perfis);
  return atualizado;
}

async function remover(id) {
  const perfis = store.read();
  const restante = perfis.filter((p) => p.id !== id);
  if (restante.length === perfis.length) {
    throw new Error(`Perfil ${id} não encontrado.`);
  }
  await store.write(restante);
  return true;
}

async function definirAtivo(id, ativo) {
  return atualizar(id, { ativo });
}

module.exports = {
  listar,
  buscarPorId,
  criar,
  atualizar,
  remover,
  definirAtivo,
};
