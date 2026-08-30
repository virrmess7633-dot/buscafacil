const express = require('express');
const scanLogModel = require('../models/scanLogModel');

const router = express.Router();

// GET /api/logs?limit=50
router.get('/', (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
  res.json(scanLogModel.listar({ limit }));
});

module.exports = router;
