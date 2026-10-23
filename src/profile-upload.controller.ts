import { spawn } from 'node:child_process';
import { createReadStream, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join as pathJoin } from 'node:path';
import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';

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

  /**
   * List debug screenshots (newest first). Protected by the same admin
   * token so you can see what Zoom actually showed when a join failed.
   *
   *   curl -H "X-Admin-Token: $TOKEN" https://.../admin/screenshots
   */
  @Get('screenshots')
  async list(
    @Headers('x-admin-token') token: string,
  ): Promise<{ files: Array<{ name: string; size: number; mtime: string }> }> {
    this.checkToken(token);
    const dir = pathJoin(process.cwd(), 'debug-screenshots');
    try {
      const names = await fs.readdir(dir);
      const files = await Promise.all(
        names
          .filter((n) => n.endsWith('.png'))
          .map(async (name) => {
            const s = await fs.stat(pathJoin(dir, name));
            return { name, size: s.size, mtime: s.mtime.toISOString() };
          }),
      );
      files.sort((a, b) => b.mtime.localeCompare(a.mtime));
      return { files };
    } catch {
      return { files: [] };
    }
  }

  /**
   * Download a single screenshot by name.
   *
   *   curl -H "X-Admin-Token: $TOKEN" https://.../admin/screenshots/NAME.png -o shot.png
   */
  @Get('screenshots/:name')
  async get(
    @Headers('x-admin-token') token: string,
    @Param('name') name: string,
    @Res() res: Response,
  ): Promise<void> {
    this.checkToken(token);
    // Prevent path traversal: strip to basename and allow only .png.
    const safeName = basename(name);
    if (!safeName.endsWith('.png')) {
      throw new NotFoundException('Only .png screenshots are served.');
    }
    const filePath = pathJoin(process.cwd(), 'debug-screenshots', safeName);
    try {
      await fs.access(filePath);
    } catch {
      throw new NotFoundException(`No such screenshot: ${safeName}`);
    }
    res.setHeader('Content-Type', 'image/png');
    createReadStream(filePath).pipe(res);
  }

  private checkToken(token: string): void {
    const expected = this.config.get<string>('ADMIN_UPLOAD_TOKEN', '').trim();
    if (!expected) {
      throw new ForbiddenException(
        'Admin endpoints are disabled: ADMIN_UPLOAD_TOKEN is not set.',
      );
    }
    if (!token || token !== expected) {
      throw new ForbiddenException('Invalid or missing X-Admin-Token header.');
    }
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
