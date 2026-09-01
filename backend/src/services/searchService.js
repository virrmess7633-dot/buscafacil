/**
 * searchService.js
 * Ponto único que integra coleta (scraperService) + avaliação
 * (scoringEngine) + persistência (listingModel/scanLogModel).
 *
 * Tanto a API REST (rota "rodar varredura agora") quanto o worker do
 * Telegram (agendado) chamam APENAS este serviço — garantindo que app web
 * e bot usem exatamente a mesma lógica de busca/filtragem/avaliação,
 * como pede o prompt.
 */

const profileModel = require('../models/profileModel');
const listingModel = require('../models/listingModel');
const scanLogModel = require('../models/scanLogModel');
const { obterPlataformasDoPerfil } = require('./platforms');
const { avaliarImovel } = require('./scoringEngine');

/**
 * Executa uma varredura completa para um único perfil: coleta em todas as
 * plataformas configuradas (OLX, ZAP Imóveis, ...), avalia, persiste
 * (upsert com dedupe por plataforma+anuncioId) e registra log.
 * @returns {Promise<{ perfil, novos, atualizados, total, erro }>}
 */
async function executarVarreduraPerfil(perfil) {
  const inicio = Date.now();
  const plataformas = obterPlataformasDoPerfil(perfil);
  const errosPorPlataforma = [];

  try {
    const resultadosPorPlataforma = await Promise.all(
      plataformas.map(async (plataforma) => {
        try {
          return await plataforma.buscar(perfil);
        } catch (err) {
          // Falha controlada: uma plataforma com erro não derruba as
          // demais nem a varredura do perfil inteiro.
          errosPorPlataforma.push(`${plataforma.nome}: ${err.message}`);
          return [];
        }
      })
    );

    const listings = resultadosPorPlataforma.flat();

    const avaliados = listings.map((item) => {
      const { score, resumo, detalhes } = avaliarImovel(item, perfil);
      return {
        ...item,
        profileId: perfil.id,
        score,
        scoreResumo: resumo,
        scoreDetalhes: detalhes,
      };
    });

    const { novos, atualizados } = await listingModel.upsertLote(avaliados);

    await scanLogModel.registrar({
      profileId: perfil.id,
      perfilNome: perfil.nome,
      sucesso: true,
      plataformas: plataformas.map((p) => p.nome),
      totalEncontrados: avaliados.length,
      novos: novos.length,
      atualizados: atualizados.length,
      duracaoMs: Date.now() - inicio,
      ...(errosPorPlataforma.length ? { avisos: errosPorPlataforma.join(' | ') } : {}),
    });

    return { perfil, novos, atualizados, total: avaliados.length, erro: null };
  } catch (err) {
    await scanLogModel.registrar({
      profileId: perfil.id,
      perfilNome: perfil.nome,
      sucesso: false,
      erro: err.message,
      duracaoMs: Date.now() - inicio,
    });
    // Falha controlada: não relança — quem chamou decide o que fazer
    // (o worker segue para o próximo perfil; a API retorna o erro no payload).
    return { perfil, novos: [], atualizados: [], total: 0, erro: err.message };
  }
}

/**
 * Executa a varredura para todos os perfis ativos.
 */
async function executarVarreduraTodosPerfis() {
  const perfis = profileModel.listar().filter((p) => p.ativo);
  const resultados = [];
  for (const perfil of perfis) {
    resultados.push(await executarVarreduraPerfil(perfil));
  }
  return resultados;
}

module.exports = { executarVarreduraPerfil, executarVarreduraTodosPerfis };
