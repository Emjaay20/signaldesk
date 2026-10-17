export type CloudStorageProvider =
  | 'postgres-bytea'
  | 'aws-s3'
  | 'gcp-gcs'
  | 'azure-blob'
  | 'minio-s3';

export interface BlobMetadata {
  workspaceId: string;
  ingestKey: string;
  filename: string;
  byteSize: number;
  provider: CloudStorageProvider;
  objectUri: string;
}

export interface CatalogPutInput {
  workspaceId: string;
  ingestKey: string;
  filename: string;
  byteSize: number;
  bytes: Buffer;
}

/**
 * Hexagonal port for raw catalog object storage.
 * Default adapter keeps bytes in PostgreSQL (`Ingest.csvBytes`).
 * Other providers keep the same put/get contract and emit cloud URIs so the
 * data plane can move without changing ingest/worker call sites.
 */
export interface CatalogBlobStoragePort {
  readonly provider: CloudStorageProvider;
  buildObjectUri(
    workspaceId: string,
    ingestKey: string,
    filename?: string,
  ): string;
  put(input: CatalogPutInput): BlobMetadata;
  load(stored: Uint8Array | Buffer): Buffer;
}

export const CATALOG_BLOB_STORAGE = 'CATALOG_BLOB_STORAGE';

export class MultiCloudBlobStorageAdapter implements CatalogBlobStoragePort {
  readonly provider: CloudStorageProvider;
  private readonly bucket: string;

  constructor(
    providerEnv = process.env.STORAGE_PROVIDER,
    bucketEnv = process.env.STORAGE_BUCKET,
  ) {
    const normalized = (providerEnv ?? 'postgres-bytea').toLowerCase();
    if (
      normalized === 'aws-s3' ||
      normalized === 'gcp-gcs' ||
      normalized === 'azure-blob' ||
      normalized === 'minio-s3'
    ) {
      this.provider = normalized;
    } else {
      this.provider = 'postgres-bytea';
    }
    this.bucket = bucketEnv || 'signaldesk-catalogs';
  }

  buildObjectUri(
    workspaceId: string,
    ingestKey: string,
    filename = 'catalog.csv',
  ): string {
    const safeFile = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    switch (this.provider) {
      case 'aws-s3':
        return `s3://${this.bucket}/${workspaceId}/${ingestKey}/${safeFile}`;
      case 'gcp-gcs':
        return `gs://${this.bucket}/${workspaceId}/${ingestKey}/${safeFile}`;
      case 'azure-blob':
        return `az://${this.bucket}/${workspaceId}/${ingestKey}/${safeFile}`;
      case 'minio-s3':
        return `minio://${this.bucket}/${workspaceId}/${ingestKey}/${safeFile}`;
      default:
        return `pg-bytea://ingests/${workspaceId}/${ingestKey}/${safeFile}`;
    }
  }

  put(input: CatalogPutInput): BlobMetadata {
    if (!input.bytes?.length) {
      throw new Error('Catalog blob is empty');
    }
    return {
      workspaceId: input.workspaceId,
      ingestKey: input.ingestKey,
      filename: input.filename,
      byteSize: input.byteSize,
      provider: this.provider,
      objectUri: this.buildObjectUri(
        input.workspaceId,
        input.ingestKey,
        input.filename,
      ),
    };
  }

  load(stored: Uint8Array | Buffer): Buffer {
    return Buffer.isBuffer(stored) ? stored : Buffer.from(stored);
  }
}
