import type { Readable } from 'node:stream';

/**
 * Object storage for binary assets, addressed by relative keys such as `<tenantId>/<visitId>/<file>`.
 * Callers never see physical paths, so the backing store (local disk, S3-compatible EU storage) can be swapped.
 */
export abstract class StorageService {
  /** Stores a new object; fails if the key already exists. */
  abstract put(key: string, data: Buffer): Promise<void>;

  /** Returns null when the object does not exist. */
  abstract get(key: string): Promise<Readable | null>;

  /** Removes the object; a missing object is not an error. */
  abstract delete(key: string): Promise<void>;
}
