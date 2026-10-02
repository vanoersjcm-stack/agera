import { constants, createReadStream } from 'node:fs';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import type { OnModuleInit } from '@nestjs/common';
import { StorageService } from './storage.service.js';

/** Stores objects as files below a root directory (local disk or a mounted Docker volume). */
export class LocalStorageProvider extends StorageService implements OnModuleInit {
  private readonly root: string;

  constructor(rootDir: string) {
    super();
    this.root = path.resolve(rootDir);
  }

  async onModuleInit(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await access(this.root, constants.W_OK);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const absolute = this.resolve(key);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, data, { flag: 'wx' });
  }

  async get(key: string): Promise<Readable | null> {
    const absolute = this.resolve(key);
    try {
      await access(absolute, constants.R_OK);
    } catch {
      return null;
    }
    return createReadStream(absolute);
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  private resolve(key: string): string {
    const absolute = path.resolve(this.root, key);
    if (!absolute.startsWith(this.root + path.sep)) {
      throw new Error('Storage key escapes the storage root');
    }
    return absolute;
  }
}
