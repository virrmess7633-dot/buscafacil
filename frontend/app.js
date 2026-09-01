/**
 * app.js
 * Frontend puro (sem build step) do painel de imóveis — item 4 do prompt.
 * Consome a API REST do backend (mesma lógica de busca/avaliação do bot).
 */

const API = '/api';

let perfis = [];
let perfilSelecionadoId = null;

const el = {
  listaPerfis: document.getElementById('lista-perfis'),
  listaLogs: document.getElementById('lista-logs'),
  grid: document.getElementById('grid-imoveis'),
  scanStatus: document.getElementById('scan-status'),
  scanCount: document.getElementById('scan-count'),
  resultsCount: document.getElementById('results-count'),
  filtroScore: document.getElementById('filtro-score'),
  btnVarrer: document.getElementById('btn-varrer'),
  btnNovoPerfil: document.getElementById('btn-novo-perfil'),
  modal: document.getElementById('modal-perfil'),
  formPerfil: document.getElementById('form-perfil'),
  btnCancelarPerfil: document.getElementById('btn-cancelar-perfil'),
};

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const erro = await res.json().catch(() => ({ erro: res.statusText }));
    throw new Error(erro.erro || 'Erro na requisição');
  }
  return res.status === 204 ? null : res.json();
}

// --- Perfis ---

async function carregarPerfis() {
  perfis = await api('/profiles');
  renderPerfis();
  if (!perfilSelecionadoId && perfis.length) {
    perfilSelecionadoId = perfis[0].id;
  }
  await carregarListings();
}

function renderPerfis() {
  if (!perfis.length) {
    el.listaPerfis.innerHTML = '<li class="ledger__empty">Nenhum perfil ainda. Clique em "+ novo".</li>';
    return;
  }
  el.listaPerfis.innerHTML = perfis
    .map(
      (p) => `
      <li class="perfil-item ${p.id === perfilSelecionadoId ? 'ativo-selecionado' : ''}" data-id="${p.id}">
        <span class="perfil-item__dot ${p.ativo ? 'ativo' : ''}"></span>
        <span style="flex:1">
          <div class="perfil-item__nome">${escapeHtml(p.nome)}</div>
          <div class="perfil-item__meta">R$${p.precoMin ?? '?'}–${p.precoMax ?? '?'}</div>
        </span>
      </li>`
    )
    .join('');

  el.listaPerfis.querySelectorAll('.perfil-item').forEach((li) => {
    li.addEventListener('click', () => {
      perfilSelecionadoId = li.dataset.id;
      renderPerfis();
      carregarListings();
    });
  });
}

// --- Listings ---

async function carregarListings() {
  if (!perfilSelecionadoId) {
    el.grid.innerHTML = '<p class="grid__empty">Crie um perfil de busca para começar.</p>';
    el.resultsCount.textContent = '0 imóveis';
    return;
  }
  const minScore = el.filtroScore.value || 0;
  const listings = await api(`/listings?profileId=${perfilSelecionadoId}&minScore=${minScore}`);
  renderListings(listings);
}

function renderListings(listings) {
  el.resultsCount.textContent = `${listings.length} imóvel(is)`;
  if (!listings.length) {
    el.grid.innerHTML = '<p class="grid__empty">Nenhum imóvel avaliado ainda para este perfil. Rode uma varredura.</p>';
    return;
  }

  el.grid.innerHTML = listings.map(renderCard).join('');
}

function classeStamp(score) {
  if (score >= 80) return { classe: 'stamp--good', label: 'APROVADO' };
  if (score >= 55) return { classe: 'stamp--mid', label: 'A AVALIAR' };
  return { classe: 'stamp--low', label: 'ATENÇÃO' };
}

function renderCard(l) {
  const { classe, label } = classeStamp(l.score);
  const foto = l.fotos && l.fotos[0];
  const nomePlataforma = { olx: 'OLX', zap: 'ZAP Imóveis' }[l.plataforma] || l.plataforma;
  const stats = [
    l.quartos ? `${l.quartos} qtos` : null,
    l.banheiros ? `${l.banheiros} banh.` : null,
    l.vagas ? `${l.vagas} vagas` : null,
    l.area ? `${l.area}m²` : null,
  ].filter(Boolean).join(' · ');

  const whatsappHref = l.whatsapp
    ? `https://wa.me/${l.whatsapp}?text=${encodeURIComponent('Olá! Vi seu anúncio "' + l.titulo + '" na ' + nomePlataforma + ' e tenho interesse.')}`
    : null;

  return `
  <article class="card">
    ${foto ? `<img class="card__photo" src="${foto}" alt="${escapeHtml(l.titulo)}" loading="lazy" />` : ''}
    <div class="card__body">
      <div class="stamp ${classe}">
        <span class="stamp__score">${Math.round(l.score)}</span>
        <span class="stamp__label">${label}</span>
      </div>
      <span class="card__platform">${nomePlataforma}</span>
      <h3 class="card__title">${escapeHtml(l.titulo)}</h3>
      <p class="card__price">R$ ${l.preco ?? '?'}${l.condominio ? ` + R$${l.condominio} cond.` : ''}</p>
      <p class="card__address">${escapeHtml(l.endereco || 'Localização não informada')}</p>
      ${stats ? `<div class="card__stats">${stats}</div>` : ''}
      <p class="card__resumo">${escapeHtml(l.scoreResumo || '')}</p>
      <div class="card__actions">
        <a href="${l.linkAnuncio}" target="_blank" rel="noopener">Ver na ${nomePlataforma}</a>
        ${whatsappHref ? `<a href="${whatsappHref}" target="_blank" rel="noopener" class="whatsapp">Chamar no WhatsApp</a>` : ''}
      </div>
    </div>
  </article>`;
}

// --- Logs ---

async function carregarLogs() {
  const logs = await api('/logs?limit=10');
  el.scanCount.textContent = String(logs.length).padStart(3, '0');
  if (!logs.length) {
    el.listaLogs.innerHTML = '<li class="ledger__empty">Sem execuções ainda.</li>';
    return;
  }
  el.listaLogs.innerHTML = logs
    .map((log) => {
      const hora = new Date(log.timestamp).toLocaleString('pt-BR');
      if (!log.sucesso && log.erro) {
        return `<li class="log-item erro">${hora} — <strong>${escapeHtml(log.perfilNome || '')}</strong> falhou: ${escapeHtml(log.erro)}</li>`;
      }
      if (log.evento === 'notificacao') {
        return `<li class="log-item">${hora} — ${log.notificados} notificado(s) em ${log.grupos} grupo(s) (<strong>${escapeHtml(log.perfilNome || '')}</strong>)</li>`;
      }
      return `<li class="log-item">${hora} — <strong>${escapeHtml(log.perfilNome || '')}</strong>: ${log.totalEncontrados} encontrados, ${log.novos} novos</li>`;
    })
    .join('');
}

// --- Ações ---

el.btnVarrer.addEventListener('click', async () => {
  el.btnVarrer.disabled = true;
  el.scanStatus.textContent = 'Varrendo… isso pode levar alguns minutos.';
  try {
    const body = perfilSelecionadoId ? { profileId: perfilSelecionadoId } : {};
    await api('/listings/scan', { method: 'POST', body: JSON.stringify(body) });
    el.scanStatus.textContent = 'Varredura concluída.';
    await Promise.all([carregarListings(), carregarLogs()]);
  } catch (err) {
    el.scanStatus.textContent = `Erro: ${err.message}`;
  } finally {
    el.btnVarrer.disabled = false;
  }
});

el.filtroScore.addEventListener('change', carregarListings);

el.btnNovoPerfil.addEventListener('click', () => {
  el.formPerfil.reset();
  el.modal.showModal();
});

el.btnCancelarPerfil.addEventListener('click', () => el.modal.close());

el.formPerfil.addEventListener('submit', async (e) => {
  const fd = new FormData(el.formPerfil);
  const payload = {
    nome: fd.get('nome'),
    localizacao: {
      cidade: fd.get('cidade') || '',
      uf: fd.get('uf') || null,
      bairros: splitCsv(fd.get('bairros')),
    },
    precoMin: numOrNull(fd.get('precoMin')),
    precoMax: numOrNull(fd.get('precoMax')),
    quartosMin: numOrNull(fd.get('quartosMin')),
    vagasMin: numOrNull(fd.get('vagasMin')),
    areaMin: numOrNull(fd.get('areaMin')),
    condominioMax: numOrNull(fd.get('condominioMax')),
    mobiliado: fd.get('mobiliado'),
    aceitaPets: fd.get('aceitaPets'),
    tipoImovel: splitCsv(fd.get('tipoImovel')),
    plataformas: fd.getAll('plataformas'),
    notificacao: {
      scoreMinimo: numOrNull(fd.get('scoreMinimo')) ?? 70,
      telegramChatIds: splitCsv(fd.get('telegramChatIds')),
    },
  };

  try {
    const perfil = await api('/profiles', { method: 'POST', body: JSON.stringify(payload) });
    perfilSelecionadoId = perfil.id;
    await carregarPerfis();
  } catch (err) {
    alert(`Erro ao salvar perfil: ${err.message}`);
  }
});

function splitCsv(v) {
  return (v || '').split(',').map((s) => s.trim()).filter(Boolean);
}
function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// --- Boot ---
(async function init() {
  try {
    await carregarPerfis();
    await carregarLogs();
  } catch (err) {
    el.grid.innerHTML = `<p class="grid__empty">Falha ao carregar dados: ${escapeHtml(err.message)}</p>`;
  }
})();
