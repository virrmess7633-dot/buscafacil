/**
 * bot.js
 * Bot do Telegram — item 5 do prompt.
 *
 * Responsabilidades:
 * - Publicar automaticamente imóveis novos que atendem aos critérios
 *   mínimos (chamado pelo worker.js após cada varredura).
 * - Responder comandos administrativos (/status, /pausar, /retomar, /config).
 *
 * Usa a lib `node-telegram-bot-api`. Se TELEGRAM_BOT_TOKEN não estiver
 * configurado, o bot simplesmente não inicia (o resto do sistema — API e
 * scraping manual via app web — continua funcionando normalmente).
 */

const TelegramBot = require('node-telegram-bot-api');
const { TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_CHAT_IDS } = require('../config/env');
const profileModel = require('../models/profileModel');
const scanLogModel = require('../models/scanLogModel');

let bot = null;
let pausado = false;

function iniciarBot() {
  if (!TELEGRAM_BOT_TOKEN) {
    console.warn('[telegram] TELEGRAM_BOT_TOKEN não configurado — bot desativado.');
    return null;
  }

  bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

  bot.onText(/\/status/, async (msg) => {
    const perfis = profileModel.listar();
    const ativos = perfis.filter((p) => p.ativo).length;
    const ultimosLogs = scanLogModel.listar({ limit: 5 });
    const ultima = ultimosLogs[0];

    let texto = `*Status do sistema*\n`;
    texto += `Bot: ${pausado ? '⏸ pausado' : '▶️ ativo'}\n`;
    texto += `Perfis: ${ativos} ativo(s) de ${perfis.length} total\n`;
    if (ultima) {
      texto += `Última varredura: ${new Date(ultima.timestamp).toLocaleString('pt-BR')}\n`;
      texto += ultima.sucesso
        ? `  → ${ultima.totalEncontrados} encontrados, ${ultima.novos} novos (perfil: ${ultima.perfilNome})\n`
        : `  → falhou: ${ultima.erro} (perfil: ${ultima.perfilNome})\n`;
    } else {
      texto += 'Nenhuma varredura executada ainda.\n';
    }

    await bot.sendMessage(msg.chat.id, texto, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/pausar/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return bot.sendMessage(msg.chat.id, 'Comando restrito a administradores.');
    pausado = true;
    await bot.sendMessage(msg.chat.id, '⏸ Notificações pausadas. Use /retomar para reativar.');
  });

  bot.onText(/\/retomar/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return bot.sendMessage(msg.chat.id, 'Comando restrito a administradores.');
    pausado = false;
    await bot.sendMessage(msg.chat.id, '▶️ Notificações reativadas.');
  });

  bot.onText(/\/config/, async (msg) => {
    const perfis = profileModel.listar();
    if (!perfis.length) return bot.sendMessage(msg.chat.id, 'Nenhum perfil de busca configurado ainda.');
    const linhas = perfis.map(
      (p) =>
        `• *${p.nome}* (${p.ativo ? 'ativo' : 'inativo'}) — R$${p.precoMin ?? '?'}–${p.precoMax ?? '?'}, ` +
        `nota mín. p/ notificar: ${p.notificacao.scoreMinimo}`
    );
    await bot.sendMessage(msg.chat.id, `*Perfis configurados:*\n${linhas.join('\n')}`, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/(start|help|ajuda)/, async (msg) => {
    const texto =
      'Comandos disponíveis:\n' +
      '/status — resumo da última varredura\n' +
      '/config — lista os perfis de busca configurados\n' +
      '/pausar — pausa notificações (admin)\n' +
      '/retomar — reativa notificações (admin)';
    await bot.sendMessage(msg.chat.id, texto);
  });

  console.log('[telegram] Bot iniciado (polling).');
  return bot;
}

function isAdmin(chatId) {
  if (!TELEGRAM_ADMIN_CHAT_IDS.length) return true; // sem lista definida = sem restrição
  return TELEGRAM_ADMIN_CHAT_IDS.includes(String(chatId));
}

/**
 * Publica um imóvel novo em um chat/grupo, com foto + botões inline
 * "Ver na OLX" e "Chamar no WhatsApp" (item 5 do prompt).
 */
async function publicarImovel(chatId, listing) {
  if (!bot || pausado) return false;

  const legenda = montarLegenda(listing);
  const botoes = [[{ text: '🔗 Ver na OLX', url: listing.linkOlx }]];
  if (listing.whatsapp) {
    const mensagem = encodeURIComponent(`Olá! Vi seu anúncio "${listing.titulo}" na OLX e tenho interesse.`);
    botoes[0].push({ text: '💬 Chamar no WhatsApp', url: `https://wa.me/${listing.whatsapp}?text=${mensagem}` });
  }

  const opcoes = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: botoes } };
  const foto = listing.fotos?.[0];

  try {
    if (foto) {
      await bot.sendPhoto(chatId, foto, { caption: legenda, ...opcoes });
    } else {
      await bot.sendMessage(chatId, legenda, opcoes);
    }
    return true;
  } catch (err) {
    console.error(`[telegram] Falha ao publicar em ${chatId}:`, err.message);
    return false;
  }
}

function montarLegenda(listing) {
  const partes = [
    `*${listing.titulo}*`,
    `💰 R$ ${listing.preco ?? '?'}${listing.condominio ? ` + R$${listing.condominio} cond.` : ''}`,
    `📍 ${listing.endereco || 'Localização não informada'}`,
  ];
  const caracteristicas = [];
  if (listing.quartos) caracteristicas.push(`${listing.quartos} qtos`);
  if (listing.banheiros) caracteristicas.push(`${listing.banheiros} banh.`);
  if (listing.vagas) caracteristicas.push(`${listing.vagas} vaga(s)`);
  if (listing.area) caracteristicas.push(`${listing.area}m²`);
  if (caracteristicas.length) partes.push(`🏠 ${caracteristicas.join(' • ')}`);

  partes.push(`⭐ Nota: ${listing.score}/100`);
  partes.push(`_${listing.scoreResumo}_`);

  return partes.join('\n');
}

function isPausado() {
  return pausado;
}

module.exports = { iniciarBot, publicarImovel, isPausado };
