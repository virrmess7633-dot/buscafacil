const createApp = require('./app');
const { PORT } = require('./config/env');

const app = createApp();

app.listen(PORT, () => {
  console.log(`[server] API + frontend rodando em http://localhost:${PORT}`);
});
