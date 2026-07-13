import { ObjectStorage, type ObjectStorageOptions } from '@businessos/storage';
import type { ApiConfig } from '../config.js';

export { ObjectStorage };

/** Maps the API config's S3_* fields to the shared storage options. */
export function s3OptionsFromConfig(config: ApiConfig): ObjectStorageOptions {
  return {
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    accessKeyId: config.S3_ACCESS_KEY,
    secretAccessKey: config.S3_SECRET_KEY,
    bucket: config.S3_BUCKET,
  };
}

export function createObjectStorage(config: ApiConfig): ObjectStorage {
  return new ObjectStorage(s3OptionsFromConfig(config));
}
