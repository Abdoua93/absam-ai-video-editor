import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { readJson, writeJson, uid } from './utils.js';

const projectFile = (id) => path.join(config.projectsDir, id, 'project.json');

export function defaultSettings() {
  return {
    autoTrim: true,
    targetSeconds: 60,
    maxClipSeconds: 15,
    minClipSeconds: 1.2,
    silenceThresholdDb: -35,
    sceneThreshold: 0.32,
    subtitleMode: 'none', // none | provided | whisper
    subtitleFont: config.defaultFont,
    subtitleFontSize: 52,
    subtitleRtl: true,
    musicMode: 'upload', // upload | ambient | none
    musicVolume: 0.16,
    musicFadeSeconds: 1.2,
    quality: 'balanced' // fast | balanced | high
  };
}

export function createProject(title = 'My video') {
  const id = uid('prj_');
  const project = {
    id,
    title: String(title).slice(0, 120),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    clips: [],
    settings: defaultSettings(),
    subtitles: [],
    assets: {},
    latestJobId: null
  };
  saveProject(project);
  return project;
}

export function getProject(id) {
  if (!/^[\w-]+$/.test(String(id || ''))) return null;
  return readJson(projectFile(id), null);
}

export function saveProject(project) {
  project.updatedAt = new Date().toISOString();
  writeJson(projectFile(project.id), project);
  return project;
}

export function listProjects() {
  let dirs = [];
  try {
    dirs = fs.readdirSync(config.projectsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return dirs
    .filter((entry) => entry.isDirectory())
    .map((entry) => getProject(entry.name))
    .filter(Boolean)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
