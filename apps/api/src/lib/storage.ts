import { randomUUID } from 'node:crypto';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ApiConfig } from '../config.js';

const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

/**
 * Thin wrapper over an S3-compatible object store (MinIO locally). Clients
 * never talk to storage directly: uploads stream through the API and downloads
 * are short-lived signed URLs. `forcePathStyle` is required for MinIO.
 */
export class ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ApiConfig) {
    this.bucket = config.S3_BUCKET;
    this.client = new S3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY,
        secretAccessKey: config.S3_SECRET_KEY,
      },
    });
  }

  /** Idempotent; call once at startup. */
  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  /** Deterministic, collision-free key namespaced per organization. */
  buildKey(organizationId: string, fileName: string): string {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
    return `org/${organizationId}/${randomUUID()}/${safeName}`;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async getDownloadUrl(
    key: string,
    fileName: string,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      // Force a download with the original filename.
      ResponseContentDisposition: `attachment; filename="${encodeURIComponent(fileName)}"`,
    });
    const url = await getSignedUrl(this.client, command, { expiresIn: DOWNLOAD_URL_TTL_SECONDS });
    return { url, expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
