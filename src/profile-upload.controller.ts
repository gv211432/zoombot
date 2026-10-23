import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

/**
 * One-time, token-protected endpoint for uploading a `zoom-profile/` tarball
 * into Railway's persistent volume. The data-center IPs Railway runs on are
 * blocked by Zoom for guest joins, so the bots must present an authenticated
 * session cookie — and the only way to get one is to log in from a residential
 * IP (your laptop), tar the resulting profile folder, and POST it here.
 *
 * Usage (from your laptop, after `/zoomlogin` wrote ./zoom-profile):
 *   tar czf zp.tgz zoom-profile
 *   curl -X POST \
 *        -H "X-Admin-Token: $ADMIN_UPLOAD_TOKEN" \
 *        --data-binary @zp.tgz \
 *        https://<your-railway-domain>/admin/upload-profile
 *
 * The endpoint is disabled unless ADMIN_UPLOAD_TOKEN is set, so it's safe to
 * leave in the codebase.
 */
@Controller('admin')
export class ProfileUploadController {
  private readonly logger = new Logger(ProfileUploadController.name);

  constructor(private readonly config: ConfigService) {}

  @Post('upload-profile')
  @HttpCode(200)
  async upload(
    @Req() req: Request,
    @Headers('x-admin-token') token: string,
  ): Promise<{ ok: true; path: string }> {
    const expected = this.config.get<string>('ADMIN_UPLOAD_TOKEN', '').trim();
    if (!expected) {
      throw new ForbiddenException(
        'Upload endpoint is disabled: ADMIN_UPLOAD_TOKEN is not set.',
      );
    }
    if (!token || token !== expected) {
      throw new ForbiddenException('Invalid or missing X-Admin-Token header.');
    }

    const profileDir =
      this.config.get<string>('ZOOM_PROFILE_DIR', '').trim() ||
      pathJoin(process.cwd(), 'zoom-profile');

    const body = req.body as Buffer | undefined;
    if (!body || !Buffer.isBuffer(body) || body.length === 0) {
      throw new BadRequestException(
        'Request body was empty. POST the tarball with --data-binary.',
      );
    }
    const tmpFile = pathJoin(tmpdir(), `zoom-profile-upload-${Date.now()}.tgz`);
    this.logger.log(`Receiving profile tarball (${body.length} bytes) → ${tmpFile}`);
    await fs.writeFile(tmpFile, body);

    // Wipe any existing profile so we don't mix two Chromium users' state.
    // profileDir may be a mount point (Railway volume), which can't itself
    // be rmdir'd — only its contents can be removed.
    await fs.mkdir(profileDir, { recursive: true });
    for (const entry of await fs.readdir(profileDir)) {
      await fs.rm(pathJoin(profileDir, entry), { recursive: true, force: true });
    }

    // The tarball on the laptop was created with `tar czf zp.tgz zoom-profile`,
    // so entries are prefixed with `zoom-profile/`. --strip-components=1 drops
    // that prefix, writing the Default/, Local State, etc. directly into the
    // target directory regardless of what the local folder was called.
    this.logger.log(`Extracting into ${profileDir}`);
    await this.runTar(['-xzf', tmpFile, '-C', profileDir, '--strip-components=1']);
    await fs.rm(tmpFile, { force: true });

    const cookiesPath = pathJoin(profileDir, 'Default', 'Cookies');
    await fs.access(cookiesPath).catch(() => {
      throw new ForbiddenException(
        `Upload extracted, but no ${cookiesPath} found. Did you tar the ` +
          '`zoom-profile` folder itself (not its contents)?',
      );
    });

    this.logger.log(`Zoom profile installed at ${profileDir}.`);
    return { ok: true, path: profileDir };
  }

  private runTar(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn('tar', args, { stdio: 'inherit' });
      proc.on('error', reject);
      proc.on('exit', (code) =>
        code === 0 ? resolve() : reject(new Error(`tar exited with ${code}`)),
      );
    });
  }
}
