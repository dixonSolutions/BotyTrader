/**
 * Hugging Face Storage Bucket helpers (S3-compatible API).
 *
 * Wraps `@aws-sdk/client-s3` with HF-specific defaults so the rest of the
 * memory layer can stay storage-agnostic. Bucket name comes from config.toml;
 * the token comes from .env (HF_TOKEN).
 */

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";

export interface HfBucketOptions {
  bucketName: string;
  endpoint: string;
  region: string;
  token: string;
}

export class HfBucket {
  private readonly client: S3Client;
  private readonly bucketName: string;

  constructor(opts: HfBucketOptions) {
    this.bucketName = opts.bucketName;
    const config: S3ClientConfig = {
      region: opts.region,
      endpoint: opts.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: opts.token,
        secretAccessKey: opts.token,
      },
    };
    this.client = new S3Client(config);
  }

  async getObject(key: string): Promise<Uint8Array | null> {
    try {
      const out = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucketName, Key: key }),
      );
      const body = out.Body;
      if (!body) return null;
      return await body.transformToByteArray();
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async putObject(key: string, data: Uint8Array | string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: data,
      }),
    );
  }
}

function isNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404;
}
