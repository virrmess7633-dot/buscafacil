const express = require('express');
const profileModel = require('../models/profileModel');

const router = express.Router();

// GET /api/profiles - listar todos os perfis
router.get('/', (req, res) => {
  res.json(profileModel.listar());
});

// GET /api/profiles/:id
router.get('/:id', (req, res) => {
  const perfil = profileModel.buscarPorId(req.params.id);
  if (!perfil) return res.status(404).json({ erro: 'Perfil não encontrado' });
  res.json(perfil);
});

// POST /api/profiles - criar novo perfil
router.post('/', async (req, res) => {
  try {
    const perfil = await profileModel.criar(req.body);
    res.status(201).json(perfil);
  } catch (err) {
    res.status(400).json({ erro: err.message });
  }
});

// PUT /api/profiles/:id - atualizar perfil (edição completa)
router.put('/:id', async (req, res) => {
  try {
    const perfil = await profileModel.atualizar(req.params.id, req.body);
    res.json(perfil);
  } catch (err) {
    res.status(400).json({ erro: err.message });
  }
});

// PATCH /api/profiles/:id/ativo - ativar/desativar perfil
router.patch('/:id/ativo', async (req, res) => {
  try {
    const perfil = await profileModel.definirAtivo(req.params.id, !!req.body.ativo);
    res.json(perfil);
  } catch (err) {
    res.status(400).json({ erro: err.message });
  }
});

// DELETE /api/profiles/:id
router.delete('/:id', async (req, res) => {
  try {
    await profileModel.remover(req.params.id);
    res.status(204).end();
  } catch (err) {
    res.status(404).json({ erro: err.message });
  }
});

module.exports = router;
