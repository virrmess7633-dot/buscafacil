const express = require('express');
const cors = require('cors');
const path = require('path');

const profileRoutes = require('./routes/profileRoutes');
const listingRoutes = require('./routes/listingRoutes');
const logRoutes = require('./routes/logRoutes');

function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Serve o frontend estático (../../frontend) — simples, sem build step.
  app.use(express.static(path.join(__dirname, '..', '..', 'frontend')));

  app.get('/api/health', (req, res) => res.json({ ok: true, timestamp: new Date().toISOString() }));

  app.use('/api/profiles', profileRoutes);
  app.use('/api/listings', listingRoutes);
  app.use('/api/logs', logRoutes);

  // Handler de erro genérico — evita que uma exceção não tratada derrube o processo
  app.use((err, req, res, next) => {
    console.error('[erro não tratado]', err);
    res.status(500).json({ erro: 'Erro interno no servidor' });
  });

  return app;
}

module.exports = createApp;
