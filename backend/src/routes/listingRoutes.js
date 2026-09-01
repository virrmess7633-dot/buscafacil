const express = require('express');
const listingModel = require('../models/listingModel');
const profileModel = require('../models/profileModel');
const searchService = require('../services/searchService');

const router = express.Router();

// GET /api/listings?profileId=...&minScore=...
// Lista imóveis avaliados, ordenados por score desc (item 4 do prompt)
router.get('/', (req, res) => {
  const { profileId, minScore } = req.query;
  const min = minScore !== undefined ? parseFloat(minScore) : undefined;
  const listings = profileId
    ? listingModel.listarPorPerfil(profileId, { minScore: min })
    : listingModel.listarTodos({ minScore: min });
  res.json(listings);
});

// PATCH /api/listings/:plataforma/:anuncioId/status  { status: 'favorito' | 'descartado' | 'visto' }
router.patch('/:plataforma/:anuncioId/status', async (req, res) => {
  try {
    const listing = await listingModel.atualizarStatus(req.params.plataforma, req.params.anuncioId, req.body.status);
    res.json(listing);
  } catch (err) {
    res.status(400).json({ erro: err.message });
  }
});

// POST /api/listings/scan  { profileId? }
// Dispara uma varredura manual (útil para testar um perfil sem esperar o worker)
router.post('/scan', async (req, res) => {
  try {
    const { profileId } = req.body;
    if (profileId) {
      const perfil = profileModel.buscarPorId(profileId);
      if (!perfil) return res.status(404).json({ erro: 'Perfil não encontrado' });
      const resultado = await searchService.executarVarreduraPerfil(perfil);
      return res.json(resultado);
    }
    const resultados = await searchService.executarVarreduraTodosPerfis();
    res.json(resultados);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
