import { SetMetadata } from '@nestjs/common';

export const ALLOW_EXTERNAL = 'allowExternal';

/** Endpoint that users with the External_Client role may call; all others return 403 for them. */
export const AllowExternal = () => SetMetadata(ALLOW_EXTERNAL, true);
