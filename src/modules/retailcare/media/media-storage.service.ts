import { constants, createReadStream, type ReadStream } from 'node:fs';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Stores media on the local filesystem (or a mounted Docker volume) below UPLOAD_DIR. */
@Injectable()
export class MediaStorage implements OnModuleInit {
  private readonly root: string;

  constructor(config: ConfigService) {
    this.root = path.resolve(config.getOrThrow<string>('uploadDir'));
  }

  async onModuleInit(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await access(this.root, constants.W_OK);
  }

  async write(relativePath: string, data: Buffer): Promise<void> {
    const absolute = this.resolve(relativePath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, data, { flag: 'wx' });
  }

  async remove(relativePath: string): Promise<void> {
    await rm(this.resolve(relativePath), { force: true });
  }

  /** Returns null when the file does not exist. */
  async open(relativePath: string): Promise<ReadStream | null> {
    const absolute = this.resolve(relativePath);
    try {
      await access(absolute, constants.R_OK);
    } catch {
      return null;
    }
    return createReadStream(absolute);
  }

  private resolve(relativePath: string): string {
    const absolute = path.resolve(this.root, relativePath);
    if (!absolute.startsWith(this.root + path.sep)) {
      throw new Error('Media path escapes the upload directory');
    }
    return absolute;
  }
}
