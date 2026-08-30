/**
 * scanLogModel.js
 * Histórico de execuções de varredura (quantos imóveis encontrados, novos,
 * notificados, erros) — requisito não funcional de logs do prompt.
 */

const JsonStore = require('../config/jsonStore');
const { LOGS_FILE } = require('../config/env');

const store = new JsonStore(LOGS_FILE, []);
const MAX_LOGS = 500; // evita crescimento ilimitado do arquivo

async function registrar(entry) {
  const logs = store.read();
  logs.unshift({
    timestamp: new Date().toISOString(),
    ...entry,
  });
  await store.write(logs.slice(0, MAX_LOGS));
}

function listar({ limit = 50 } = {}) {
  return store.read().slice(0, limit);
}

module.exports = { registrar, listar };
