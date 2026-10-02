import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { StorageConfig } from '../../../config/configuration.js';
import { LocalStorageProvider } from './local-storage.provider.js';
import { StorageService } from './storage.service.js';

@Module({
  providers: [
    {
      provide: StorageService,
      inject: [ConfigService],
      useFactory: (config: ConfigService): StorageService => {
        const storage = config.getOrThrow<StorageConfig>('storage');
        switch (storage.driver) {
          case 'local':
            return new LocalStorageProvider(storage.localDir);
        }
      },
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
