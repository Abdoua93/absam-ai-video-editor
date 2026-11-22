import express from 'express';
import cors from 'cors';
import os from 'node:os';
import path from 'node:path';
import { config } from './config.js';
import routes from './routes.js';
import videoRoutes from './video/routes.js';
import { registerHandler } from './jobs.js';
import { analyzeProjectJob } from './analyze.js';
import { renderProjectJob } from './render.js';

registerHandler('analyze', analyzeProjectJob);
registerHandler('render', renderProjectJob);

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Optional shared password for public/cloud deployments. Leave APP_PASSWORD
// unset for local Termux use; the frontend shows a small gate when it is set.
app.use('/api', (req, res, next) => {
  if (!config.appPassword) return next();
  if (req.path === '/health') return next();
  if (req.get('x-app-password') === config.appPassword) return next();
  return res.status(401).json({ error: 'Incorrect app password.' });
});

app.use('/api', routes);

// Independent AI generation subsystem: /api/video/* (provider-swappable).
app.use('/api/video', videoRoutes);

const publicDir = path.join(config.projectRoot, 'public');
app.use(express.static(publicDir, { maxAge: '1h', extensions: ['html'] }));
app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

app.use((error, req, res, _next) => {
  if (error?.code === 'LIMIT_FILE_SIZE') {
    const limit = req.originalUrl.startsWith('/api/video/')
      ? config.video.maxImageMb
      : config.maxUploadMb;
    return res.status(413).json({ error: `Files must be smaller than ${limit} MB.` });
  }
  if (error?.code === 'LIMIT_FILE_COUNT') {
    return res.status(400).json({ error: 'Too many files selected.' });
  }
  console.error('[absam]', error);
  res.status(500).json({ error: error?.message || 'Unexpected server error.' });
});

app.listen(config.port, config.host, () => {
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((item) => item && item.family === 'IPv4' && !item.internal)
    .map((item) => item.address);
  console.log(`ABSAM AI VIDEO EDITOR ready on http://localhost:${config.port}`);
  for (const address of addresses) {
    console.log(`   phone / LAN: http://${address}:${config.port}`);
  }
  console.log(`   data: ${config.dataDir}`);
  console.log(`   generation provider: ${config.video.provider}`);
  // Never print the token itself; only its presence and shape status.
  const ltx = config.video.ltx || {};
  const ltxTokenConfigured = Boolean(ltx.token || config.video.huggingface?.token);
  const ltxTokenBadFormat = Boolean(ltx.token) && ltx.tokenFormatValid === false;
  if (ltxTokenBadFormat) {
    console.log('   Hugging Face token: invalid format (re-enter with npm run token:hf; value hidden)');
  } else if (ltxTokenConfigured) {
    console.log('   Hugging Face token: loaded from backend config (value hidden)');
  } else {
    console.log('   Hugging Face token: not configured (anonymous quota)');
  }
});
