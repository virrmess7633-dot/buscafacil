/**
 * platforms/index.js
 * Registro central das plataformas de imóveis suportadas pelo Radar de
 * Imóveis. Adicionar uma nova plataforma no futuro (ex.: QuintoAndar,
 * Viva Real) significa: criar um adaptador seguindo o mesmo contrato
 * (buscar(perfil) -> array de imóveis normalizados) e registrá-lo aqui.
 */

const olxPlatform = require('./olxPlatform');
const zapPlatform = require('./zapPlatform');

const REGISTRO = {
  [olxPlatform.id]: olxPlatform,
  [zapPlatform.id]: zapPlatform,
};

function listarPlataformas() {
  return Object.values(REGISTRO);
}

function obterPlataforma(id) {
  return REGISTRO[id] || null;
}

/**
 * Retorna os adaptadores de plataforma configurados em um perfil de
 * busca, ignorando IDs desconhecidos silenciosamente (não derruba a
 * varredura por causa de uma plataforma mal configurada).
 */
function obterPlataformasDoPerfil(perfil) {
  const ids = perfil.plataformas?.length ? perfil.plataformas : Object.keys(REGISTRO);
  return ids.map(obterPlataforma).filter(Boolean);
}

module.exports = { listarPlataformas, obterPlataforma, obterPlataformasDoPerfil };
