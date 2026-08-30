/**
 * jsonStore.js
 * Persistência simples baseada em arquivos JSON.
 *
 * Por que JSON e não um banco "de verdade"?
 * - Zero dependências nativas para compilar (funciona em qualquer host Node).
 * - Fácil de inspecionar/backupar manualmente.
 * - Volume de dados esperado (imóveis de alguns perfis de busca) é pequeno.
 *
 * Se o volume crescer muito, trocar por SQLite (better-sqlite3) ou Postgres
 * é direto: basta reimplementar os métodos abaixo mantendo a mesma interface
 * pública usada pelos models (list/find/insert/update/remove).
 */

const fs = require('fs');
const path = require('path');

class JsonStore {
  /**
   * @param {string} filePath caminho absoluto do arquivo .json
   * @param {any} defaultValue valor inicial caso o arquivo não exista
   */
  constructor(filePath, defaultValue = []) {
    this.filePath = filePath;
    this.defaultValue = defaultValue;
    this._writeQueue = Promise.resolve(); // serializa escritas concorrentes
    this._ensureFile();
  }

  _ensureFile() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(
        this.filePath,
        JSON.stringify(this.defaultValue, null, 2),
        'utf-8'
      );
    }
  }

  read() {
    const raw = fs.readFileSync(this.filePath, 'utf-8');
    try {
      return JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `Falha ao ler ${this.filePath}: JSON inválido (${err.message})`
      );
    }
  }

  /**
   * Escreve de forma atômica (grava em arquivo temporário e faz rename)
   * e serializa chamadas concorrentes para evitar corrupção do arquivo.
   */
  write(data) {
    this._writeQueue = this._writeQueue.then(
      () =>
        new Promise((resolve, reject) => {
          const tmpPath = `${this.filePath}.tmp`;
          fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8', (err) => {
            if (err) return reject(err);
            fs.rename(tmpPath, this.filePath, (err2) => {
              if (err2) return reject(err2);
              resolve();
            });
          });
        })
    );
    return this._writeQueue;
  }
}

module.exports = JsonStore;
