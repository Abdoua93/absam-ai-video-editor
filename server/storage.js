import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { config } from './config.js';
import { safeName, uid } from './utils.js';

let s3 = null;

async function client() {
  if (!config.s3.endpoint) return null;
  if (s3) return s3;
  // Loaded lazily so local/Termux installs never pay for the SDK at startup.
  const { S3Client } = await import('@aws-sdk/client-s3');
  s3 = new S3Client({
    endpoint: config.s3.endpoint,
    region: config.s3.region,
    forcePathStyle: config.s3.forcePathStyle,
    credentials: config.s3.accessKey
      ? { accessKeyId: config.s3.accessKey, secretAccessKey: config.s3.secretKey }
      : undefined
  });
  return s3;
}

export const isRemote = () => Boolean(config.s3.endpoint);

export function keyFor(projectId, kind, filename) {
  return path.posix.join('projects', projectId, kind, `${uid()}_${safeName(filename)}`);
}

function localPath(key) {
  const root = path.resolve(config.dataDir);
  const resolved = path.resolve(root, key);
  if (!resolved.startsWith(root + path.sep)) throw new Error('Invalid storage key.');
  return resolved;
}

function cachePath(key) {
  const hash = crypto.createHash('sha256').update(key).digest('hex').slice(0, 20);
  return path.join(config.cacheDir, `${hash}${path.extname(key) || ''}`);
}

export async function put(key, source) {
  const s3Client = await client();
  if (!s3Client) {
    const target = localPath(key);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (Buffer.isBuffer(source)) fs.writeFileSync(target, source);
    else fs.copyFileSync(source, target);
    return key;
  }
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const body = Buffer.isBuffer(source) ? source : fs.createReadStream(source);
  await s3Client.send(new PutObjectCommand({ Bucket: config.s3.bucket, Key: key, Body: body }));
  return key;
}

/** Return a real filesystem path so FFmpeg can read the asset. */
export async function localFile(key) {
  const s3Client = await client();
  if (!s3Client) return localPath(key);
  const cached = cachePath(key);
  if (fs.existsSync(cached)) return cached;
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const result = await s3Client.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }));
  const chunks = [];
  for await (const chunk of result.Body) chunks.push(chunk);
  fs.mkdirSync(config.cacheDir, { recursive: true });
  fs.writeFileSync(cached, Buffer.concat(chunks));
  return cached;
}

export async function createReadStream(key, options = {}) {
  const s3Client = await client();
  if (!s3Client) return fs.createReadStream(localPath(key), options);
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const result = await s3Client.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }));
  return result.Body instanceof Readable ? result.Body : Readable.fromWeb(result.Body);
}

export async function stat(key) {
  const s3Client = await client();
  if (!s3Client) {
    const file = localPath(key);
    return fs.existsSync(file) ? { size: fs.statSync(file).size } : null;
  }
  const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
  try {
    const result = await s3Client.send(new HeadObjectCommand({ Bucket: config.s3.bucket, Key: key }));
    return { size: result.ContentLength || 0 };
  } catch {
    return null;
  }
}

export async function remove(key) {
  if (!key) return;
  const s3Client = await client();
  if (!s3Client) {
    fs.rmSync(localPath(key), { force: true });
    return;
  }
  const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
  await s3Client.send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: key }));
  fs.rmSync(cachePath(key), { force: true });
}

export async function removePrefix(prefix) {
  const prefixName = String(prefix);
  if (!prefixName.startsWith('projects/') && !prefixName.startsWith('generations/')) {
    throw new Error('Refusing to delete outside projects/generations.');
  }
  const s3Client = await client();
  if (!s3Client) {
    fs.rmSync(path.resolve(config.dataDir, prefix), { recursive: true, force: true });
    return;
  }
  const { ListObjectsV2Command, DeleteObjectsCommand } = await import('@aws-sdk/client-s3');
  let continuation;
  do {
    const list = await s3Client.send(new ListObjectsV2Command({
      Bucket: config.s3.bucket, Prefix: prefix, ContinuationToken: continuation
    }));
    const objects = (list.Contents || []).map((item) => ({ Key: item.Key }));
    if (objects.length) {
      await s3Client.send(new DeleteObjectsCommand({
        Bucket: config.s3.bucket, Delete: { Objects: objects }
      }));
    }
    continuation = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (continuation);
}
