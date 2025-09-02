import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { paths } from '../../config';
import { logger } from '../../utils/logger';
import { VersionInfo, APP_VERSION } from './types';

const execPromise = promisify(exec);

export class VersionService {
  private versionCache: VersionInfo = {};
  
  // Get ComfyUI and frontend version information
  async getVersionInfo(): Promise<{ comfyui?: string; frontend?: string }> {
    // If cache exists and not expired (10 minutes), return cache directly
    const now = Date.now();
    if (this.versionCache.timestamp && (now - this.versionCache.timestamp < 600000)) {
      return {
        comfyui: this.versionCache.comfyui,
        frontend: this.versionCache.frontend
      };
    }
    
    const result: { comfyui?: string; frontend?: string } = {};
    
    try {
      // Get ComfyUI version - first try to get from comfyui_version.py file
      const comfyuiPath = paths.comfyui;
      if (comfyuiPath && fs.existsSync(comfyuiPath)) {
        // Try to get from comfyui_version.py file
        const versionFilePath = path.join(comfyuiPath, 'comfyui_version.py');
        if (fs.existsSync(versionFilePath)) {
          const versionFileContent = fs.readFileSync(versionFilePath, 'utf8');
          // Use regex to extract version number from file content
          const versionMatch = versionFileContent.match(/__version__\s*=\s*["']([^"']+)["']/);
          if (versionMatch && versionMatch[1]) {
            result.comfyui = versionMatch[1];
            logger.info(`[API] 从comfyui_version.py文件获取到ComfyUI版本: ${result.comfyui}`);
          }
        }
        
        // If failed to get from comfyui_version.py, try to get from version file
        if (!result.comfyui) {
          const legacyVersionFilePath = path.join(comfyuiPath, 'version');
          if (fs.existsSync(legacyVersionFilePath)) {
            result.comfyui = fs.readFileSync(legacyVersionFilePath, 'utf8').trim();
            logger.info(`[API] 从version文件获取到ComfyUI版本: ${result.comfyui}`);
          } else {
            // Try to get from git
            try {
              const { stdout } = await execPromise('git describe --tags', { cwd: comfyuiPath });
              if (stdout.trim()) {
                result.comfyui = stdout.trim();
                logger.info(`[API] 从git标签获取到ComfyUI版本: ${result.comfyui}`);
              }
            } catch (gitError) {
              // If git command fails, try to get from package.json
              const packageJsonPath = path.join(comfyuiPath, 'package.json');
              if (fs.existsSync(packageJsonPath)) {
                try {
                  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
                  if (packageJson.version) {
                    result.comfyui = packageJson.version;
                    logger.info(`[API] 从package.json获取到ComfyUI版本: ${result.comfyui}`);
                  }
                } catch (e) {
                  logger.warn(`[API] 无法从package.json解析ComfyUI版本: ${e}`);
                }
              }
            }
          }
        }
      }
      
      // Get frontend version - first try to get from environment variable CLI_ARGS
      const cliArgs = process.env.CLI_ARGS;
      if (cliArgs) {
        // Try to extract frontend version from CLI_ARGS
        // Format example: --normalvram --disable-smart-memory --front-end-version Comfy-Org/ComfyUI_frontend@v1.12.6
        const frontendVersionMatch = cliArgs.match(/--front-end-version\s+[^@]+@(v[\d.]+)/);
        if (frontendVersionMatch && frontendVersionMatch[1]) {
          result.frontend = frontendVersionMatch[1];
          logger.info(`[API] 从环境变量CLI_ARGS获取到前端版本: ${result.frontend}`);
        }
      }
      
      // If failed to get from environment variable, try to find from web/index.html or web/scripts/app.js
      if (!result.frontend && comfyuiPath && fs.existsSync(comfyuiPath)) {
        const indexHtmlPath = path.join(comfyuiPath, 'web', 'index.html');
        if (fs.existsSync(indexHtmlPath)) {
          const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
          // Try to find version information from HTML
          const versionMatch = indexHtml.match(/ComfyUI\s+v([\d.]+)/i) || 
                              indexHtml.match(/version:\s*["']([\d.]+)["']/i);
          if (versionMatch && versionMatch[1]) {
            result.frontend = versionMatch[1];
          } else {
            // Try to find from app.js
            const appJsPath = path.join(comfyuiPath, 'web', 'scripts', 'app.js');
            if (fs.existsSync(appJsPath)) {
              const appJs = fs.readFileSync(appJsPath, 'utf8');
              const jsVersionMatch = appJs.match(/version:\s*["']([\d.]+)["']/i) ||
                                    appJs.match(/APP_VERSION\s*=\s*["']([\d.]+)["']/i);
              if (jsVersionMatch && jsVersionMatch[1]) {
                result.frontend = jsVersionMatch[1];
              }
            }
          }
        }
      }
      
      // Update cache
      this.versionCache = {
        ...result,
        timestamp: now
      };
      
    } catch (error) {
      logger.error(`[API] 获取版本信息时出错: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    return result;
  }
  
  // Get app version
  getAppVersion(): string {
    return APP_VERSION;
  }
}
