/**
 * worker.js
 * Processo separado (item 6 do prompt: "worker/scheduler separado para
 * scraping periódico e notificações no Telegram").
 *
 * Roda em cron (padrão: a cada 10 min, configurável via SCAN_CRON) e, para
 * cada perfil ativo:
 *   1. Executa a varredura via searchService (mesma lógica usada pela API).
 *   2. Para cada imóvel NOVO com nota >= limiar configurado, publica no(s)
 *      grupo(s) do Telegram associados ao perfil.
 *
 * Rodar com: `npm run worker` (ver package.json). Em produção, use PM2,
 * systemd ou um serviço de worker do seu provedor de hospedagem — ver
 * README.md > "Instruções de deploy".
 */

const cron = require('node-cron');
const profileModel = require('./models/profileModel');
const listingModel = require('./models/listingModel');
const searchService = require('./services/searchService');
const scanLogModel = require('./models/scanLogModel');
const { iniciarBot, publicarImovel } = require('./telegram/bot');
const { SCAN_CRON, NOTIFY_MIN_SCORE } = require('./config/env');

async function rodarCicloDeVarredura() {
  console.log(`[worker] Iniciando varredura — ${new Date().toISOString()}`);
  const perfis = profileModel.listar().filter((p) => p.ativo);

  if (!perfis.length) {
    console.log('[worker] Nenhum perfil ativo. Nada a fazer.');
    return;
  }

  for (const perfil of perfis) {
    const resultado = await searchService.executarVarreduraPerfil(perfil);

    if (resultado.erro) {
      console.error(`[worker] Perfil "${perfil.nome}" falhou: ${resultado.erro}`);
      continue;
    }

    console.log(
      `[worker] Perfil "${perfil.nome}": ${resultado.total} encontrados, ${resultado.novos.length} novos.`
    );

    await notificarNovosImoveis(perfil, resultado.novos);
  }

  console.log('[worker] Ciclo de varredura concluído.\n');
}

async function notificarNovosImoveis(perfil, novos) {
  const limiar = perfil.notificacao?.scoreMinimo ?? NOTIFY_MIN_SCORE;
  const chatIds = perfil.notificacao?.telegramChatIds ?? [];

  if (!chatIds.length) return; // perfil sem grupo configurado — não notifica

  const elegiveis = novos.filter((l) => l.score >= limiar);
  for (const listing of elegiveis) {
    for (const chatId of chatIds) {
      const publicado = await publicarImovel(chatId, listing);
      if (publicado) {
        await listingModel.atualizarStatus(listing.plataforma, listing.anuncioId, 'notificado');
      }
    }
  }

  if (elegiveis.length) {
    await scanLogModel.registrar({
      profileId: perfil.id,
      perfilNome: perfil.nome,
      evento: 'notificacao',
      notificados: elegiveis.length,
      grupos: chatIds.length,
    });
  }
}

function iniciar() {
  iniciarBot();

  if (!cron.validate(SCAN_CRON)) {
    console.error(`[worker] Expressão cron inválida: "${SCAN_CRON}". Worker não iniciado.`);
    process.exit(1);
  }

  console.log(`[worker] Agendado com cron "${SCAN_CRON}".`);
  cron.schedule(SCAN_CRON, () => {
    rodarCicloDeVarredura().catch((err) => {
      console.error('[worker] Erro não tratado no ciclo de varredura:', err);
    });
  });

  // Roda uma vez imediatamente ao subir, além de seguir o agendamento.
  rodarCicloDeVarredura().catch((err) => {
    console.error('[worker] Erro não tratado na varredura inicial:', err);
  });
}

if (require.main === module) {
  iniciar();
}

module.exports = { iniciar, rodarCicloDeVarredura };
