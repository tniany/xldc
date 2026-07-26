import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import './db.js';
import { api } from './routes.js';
import { openAiProxy } from './proxy.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/api', api);
app.use('/v1', openAiProxy);
app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在' }));

const clientDir = resolve('dist');
if (existsSync(clientDir)) {
  app.use(express.static(clientDir, { maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0 }));
  app.use((_req, res) => res.sendFile(resolve(clientDir, 'index.html')));
}

const port = Number(process.env.PORT || 3000);
app.listen(port, '0.0.0.0', () => console.log(`XLDC cheese workshop listening on http://0.0.0.0:${port}`));
