/**
 * scoringEngine.js
 * Motor de avaliação — item 3 do prompt.
 *
 * Calcula uma pontuação de aderência (0-100) de um imóvel coletado em
 * relação a um perfil de busca, além de um resumo textual dos pontos
 * fortes/fracos. É usado tanto pelo app web quanto pelo bot do Telegram
 * (mesma lógica, sem duplicação — chamado a partir de searchService.js).
 */

/**
 * Pontuação de "proximidade de faixa" para critérios numéricos.
 * - Dentro da faixa [min, max] => 100
 * - Fora da faixa => decresce proporcionalmente ao desvio percentual,
 *   até um piso de 0 (limitado a um desvio de referência configurável).
 *
 * @param {number|null} valor
 * @param {number|null} min
 * @param {number|null} max
 * @param {number} desvioReferencia percentual de desvio que já zera a nota (ex.: 0.5 = 50%)
 */
function pontuarFaixa(valor, min, max, desvioReferencia = 0.5) {
  if (valor === null || valor === undefined) return { nota: 50, motivo: 'Informação não disponível no anúncio' };
  if (min === null && max === null) return { nota: 100, motivo: 'Sem restrição definida' };

  if (min !== null && valor < min) {
    const desvio = (min - valor) / min;
    const nota = Math.max(0, 100 * (1 - desvio / desvioReferencia));
    return { nota, motivo: `${Math.round(desvio * 100)}% abaixo do mínimo desejado (${min})` };
  }
  if (max !== null && valor > max) {
    const desvio = (valor - max) / max;
    const nota = Math.max(0, 100 * (1 - desvio / desvioReferencia));
    return { nota, motivo: `${Math.round(desvio * 100)}% acima do máximo desejado (${max})` };
  }
  return { nota: 100, motivo: 'Dentro da faixa desejada' };
}

function pontuarPreco(listing, perfil) {
  return pontuarFaixa(listing.preco, perfil.precoMin, perfil.precoMax, 0.4);
}

function pontuarArea(listing, perfil) {
  return pontuarFaixa(listing.area, perfil.areaMin, perfil.areaMax, 0.5);
}

function pontuarQuartos(listing, perfil) {
  const { nota, motivo } = pontuarFaixa(listing.quartos, perfil.quartosMin, perfil.quartosMax, 0.5);
  // banheiros e vagas entram como ajuste leve dentro do mesmo critério
  let ajuste = 0;
  let extraMotivo = '';
  if (perfil.banheirosMin !== null && listing.banheiros !== null && listing.banheiros !== undefined) {
    if (listing.banheiros < perfil.banheirosMin) {
      ajuste -= 15;
      extraMotivo += ` | banheiros abaixo do mínimo (${listing.banheiros}<${perfil.banheirosMin})`;
    }
  }
  if (perfil.vagasMin !== null && listing.vagas !== null && listing.vagas !== undefined) {
    if (listing.vagas < perfil.vagasMin) {
      ajuste -= 15;
      extraMotivo += ` | vagas abaixo do mínimo (${listing.vagas}<${perfil.vagasMin})`;
    }
  }
  return { nota: Math.max(0, Math.min(100, nota + ajuste)), motivo: motivo + extraMotivo };
}

/**
 * Localização: se houver lat/lng no perfil e no listing, usa distância
 * (haversine) contra o raioKm. Caso contrário, cai para correspondência
 * textual de cidade/bairro.
 */
function pontuarLocalizacao(listing, perfil) {
  const loc = perfil.localizacao || {};

  if (loc.lat != null && loc.lng != null && loc.raioKm != null && listing.lat != null && listing.lng != null) {
    const distKm = haversineKm(loc.lat, loc.lng, listing.lat, listing.lng);
    if (distKm <= loc.raioKm) {
      return { nota: 100, motivo: `A ${distKm.toFixed(1)}km do ponto de referência (dentro do raio)` };
    }
    const desvio = (distKm - loc.raioKm) / loc.raioKm;
    const nota = Math.max(0, 100 * (1 - desvio / 0.6));
    return { nota, motivo: `${distKm.toFixed(1)}km do ponto de referência, fora do raio de ${loc.raioKm}km` };
  }

  const enderecoLower = (listing.endereco || '').toLowerCase();
  const cidadeOk = !loc.cidade || enderecoLower.includes(loc.cidade.toLowerCase());
  const bairros = loc.bairros || [];
  const bairroOk = bairros.length === 0 || bairros.some((b) => enderecoLower.includes(b.toLowerCase()));

  if (cidadeOk && bairroOk) return { nota: 100, motivo: 'Cidade/bairro compatíveis' };
  if (cidadeOk && !bairroOk) return { nota: 50, motivo: 'Cidade compatível, bairro fora da lista desejada' };
  return { nota: 0, motivo: 'Cidade não corresponde à desejada' };
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Critérios "extras": mobiliado, pet, condomínio máximo, palavras-chave,
 * andar/elevador. Cada sub-critério contribui igualmente para a nota do
 * bloco "extras", só é considerado quando o perfil de fato o exige.
 */
function pontuarExtras(listing, perfil) {
  const checks = [];

  if (perfil.mobiliado !== 'indiferente') {
    const quer = perfil.mobiliado === 'sim';
    const ok = listing.mobiliado === quer;
    checks.push({ ok, motivo: ok ? 'Mobília compatível' : `Esperado mobiliado=${quer}, anúncio diz ${listing.mobiliado}` });
  }

  if (perfil.aceitaPets !== 'indiferente') {
    const quer = perfil.aceitaPets === 'sim';
    const ok = listing.aceitaPets === quer;
    checks.push({ ok, motivo: ok ? 'Aceita pets conforme desejado' : 'Não aceita pets (requisito não atendido)' });
  }

  if (perfil.condominioMax !== null && listing.condominio !== null && listing.condominio !== undefined) {
    const ok = listing.condominio <= perfil.condominioMax;
    checks.push({
      ok,
      motivo: ok
        ? 'Condomínio dentro do teto definido'
        : `Condomínio (R$${listing.condominio}) acima do teto (R$${perfil.condominioMax})`,
    });
  }

  if (perfil.palavrasIncluir?.length) {
    const desc = (listing.descricao || '').toLowerCase();
    const encontrou = perfil.palavrasIncluir.some((p) => desc.includes(p.toLowerCase()));
    checks.push({
      ok: encontrou,
      motivo: encontrou ? 'Contém palavra-chave desejada' : 'Nenhuma palavra-chave desejada encontrada na descrição',
    });
  }

  if (perfil.palavrasExcluir?.length) {
    const desc = (listing.descricao || '').toLowerCase();
    const encontrouExcluida = perfil.palavrasExcluir.some((p) => desc.includes(p.toLowerCase()));
    checks.push({
      ok: !encontrouExcluida,
      motivo: encontrouExcluida ? 'Contém palavra-chave indesejada na descrição' : 'Sem palavras-chave indesejadas',
    });
  }

  if (perfil.andarMax !== null && listing.andar !== null && listing.andar !== undefined) {
    const ok = listing.andar <= perfil.andarMax;
    checks.push({ ok, motivo: ok ? 'Andar dentro do limite' : `Andar (${listing.andar}) acima do limite (${perfil.andarMax})` });
  }

  if (perfil.exigeElevador) {
    const ok = !!listing.temElevador;
    checks.push({ ok, motivo: ok ? 'Possui elevador' : 'Não possui elevador (requisito não atendido)' });
  }

  if (checks.length === 0) {
    return { nota: 100, motivo: 'Sem critérios extras configurados' };
  }

  const positivos = checks.filter((c) => c.ok).length;
  const nota = (positivos / checks.length) * 100;
  const motivo = checks.map((c) => c.motivo).join(' | ');
  return { nota, motivo };
}

/**
 * Calcula a nota final (0-100) e o breakdown por critério para um listing.
 * @param {object} listing imóvel coletado (ver shape em listingModel.js)
 * @param {object} perfil perfil de busca (ver shape em profileModel.js)
 * @returns {{ score: number, resumo: string, detalhes: object }}
 */
function avaliarImovel(listing, perfil) {
  const pesos = perfil.pesos;

  const criterios = {
    preco: pontuarPreco(listing, perfil),
    localizacao: pontuarLocalizacao(listing, perfil),
    quartos: pontuarQuartos(listing, perfil),
    area: pontuarArea(listing, perfil),
    extras: pontuarExtras(listing, perfil),
  };

  let score = 0;
  for (const [criterio, peso] of Object.entries(pesos)) {
    score += (criterios[criterio]?.nota ?? 0) * peso;
  }
  score = Math.round(score * 10) / 10;

  // Resumo textual: destaca o melhor e o pior critério (pontos fortes/fracos)
  const ordenados = Object.entries(criterios).sort((a, b) => b[1].nota - a[1].nota);
  const [melhorNome, melhor] = ordenados[0];
  const [piorNome, pior] = ordenados[ordenados.length - 1];

  const nomesCriterio = { preco: 'Preço', localizacao: 'Localização', quartos: 'Quartos/vagas', area: 'Metragem', extras: 'Extras' };

  let resumo = `Nota geral: ${score}/100. `;
  resumo += `Ponto forte — ${nomesCriterio[melhorNome]}: ${melhor.motivo}. `;
  if (pior.nota < 80) {
    resumo += `Ponto de atenção — ${nomesCriterio[piorNome]}: ${pior.motivo}.`;
  }

  return { score, resumo, detalhes: criterios };
}

module.exports = { avaliarImovel, pontuarFaixa, haversineKm };
