// Storage abstraction. Callers use put()/get()/url() only — never talk to
// Vercel Blob or R2 SDKs directly, so switching providers is a config
// change (config.storage.provider), not a code change across the app.

import { config } from "../config";

export interface StoredFile {
  key: string;
  url: string;
}

export interface StorageAdapter {
  put(key: string, data: Buffer, contentType: string): Promise<StoredFile>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  url(key: string): string;
}

class VercelBlobAdapter implements StorageAdapter {
  async put(key: string, data: Buffer, contentType: string): Promise<StoredFile> {
    const { put } = await import("@vercel/blob");
    const blob = await put(key, data, { access: "public", contentType });
    // Vercel Blob URLs are per-blob random subdomains — there is no fixed
    // prefix to reconstruct one from a key later. So the REAL url is what
    // gets persisted (in Template.pdfStorageKey etc.) — url() below just
    // returns it back. Don't try to derive a Blob URL from a bare key.
    return { key: blob.url, url: blob.url };
  }
  async get(key: string): Promise<Buffer> {
    // `key` here is actually the full URL persisted by put() above.
    const res = await fetch(key);
    if (!res.ok) throw new Error(`Blob fetch failed for ${key}: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  url(key: string): string {
    return key; // already a full URL — see note in put()
  }
  async delete(key: string): Promise<void> {
    const { del } = await import("@vercel/blob");
    await del(key); // key IS the blob URL for this adapter — see put()/url() above
  }
}

class R2Adapter implements StorageAdapter {
  async put(key: string, data: Buffer, contentType: string): Promise<StoredFile> {
    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = new S3Client({
      region: "auto",
      endpoint: `https://${requireEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
        secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
      },
    });
    await client.send(
      new PutObjectCommand({
        Bucket: requireEnv("R2_BUCKET"),
        Key: key,
        Body: data,
        ContentType: contentType,
      })
    );
    return { key, url: this.url(key) };
  }
  async get(key: string): Promise<Buffer> {
    const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
    const client = new S3Client({
      region: "auto",
      endpoint: `https://${requireEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
        secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
      },
    });
    const res = await client.send(
      new GetObjectCommand({ Bucket: requireEnv("R2_BUCKET"), Key: key })
    );
    const bytes = await res.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }
  url(key: string): string {
    return `https://${requireEnv("R2_PUBLIC_DOMAIN")}/${key}`;
  }
  async delete(key: string): Promise<void> {
    const { S3Client, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const client = new S3Client({
      region: "auto",
      endpoint: `https://${requireEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
        secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
      },
    });
    await client.send(new DeleteObjectCommand({ Bucket: requireEnv("R2_BUCKET"), Key: key }));
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const adapters: Record<string, StorageAdapter> = {
  "vercel-blob": new VercelBlobAdapter(),
  r2: new R2Adapter(),
};

export const storage: StorageAdapter = adapters[config.storage.provider];
