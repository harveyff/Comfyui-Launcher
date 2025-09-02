import { Context } from 'koa';
import { logger } from '../../utils/logger';
import { i18nLogger } from '../../utils/logger';
import { 
  ComfyUIStatus, 
  ComfyUIStartResponse, 
  ComfyUIStopResponse, 
  ComfyUIResetResponse, 
  ComfyUILogsResponse, 
  ComfyUIResetLogsResponse,
  ResetRequest
} from './types';
import { getClientLocale, getUptime, getGPUMode } from './utils';
import { VersionService } from './version.service';
import { LogService } from './log.service';
import { ProcessService } from './process.service';
import { createComfyUIProxy } from './proxy.service';

export class ComfyUIController {
  private versionService: VersionService;
  private logService: LogService;
  private processService: ProcessService;
  
  constructor() {
    // Initialize services
    this.versionService = new VersionService();
    this.logService = new LogService();
    this.processService = new ProcessService(this.logService);
    
    // Bind methods to instance
    this.getStatus = this.getStatus.bind(this);
    this.startComfyUI = this.startComfyUI.bind(this);
    this.stopComfyUI = this.stopComfyUI.bind(this);
    this.getLogs = this.getLogs.bind(this);
    this.resetComfyUI = this.resetComfyUI.bind(this);
    this.getResetLogs = this.getResetLogs.bind(this);
    
    // Check if ComfyUI is already running on initialization
    this.processService.checkIfComfyUIRunning();
    
    // Clean up duplicate disabled plugins on initialization
    this.processService.cleanupDisabledPlugins();
  }



  // Get ComfyUI status
  async getStatus(ctx: Context): Promise<void> {
    logger.info('[API] 接收到状态请求，时间:' + new Date().toISOString());
    
    logger.info('[API] 获取ComfyUI状态请求');
    
    // Check if running via network port
    const { isComfyUIRunning } = await import('./utils');
    const running = await isComfyUIRunning();
    const uptime = this.processService.getStartTime() ? getUptime(this.processService.getStartTime()) : null;
    
    logger.info(`[API] ComfyUI当前状态: ${running ? '运行中' : '已停止'}`);
    if (running) {
      logger.info(`[API] 已运行时间: ${uptime}`);
    }
    
    // Get version information
    const versions = await this.versionService.getVersionInfo();
    
    // Get GPU mode
    const gpuMode = getGPUMode();
    
    const status: ComfyUIStatus = {
      running,
      pid: this.processService.getComfyPid(),
      uptime,
      versions: {
        comfyui: versions.comfyui || 'unknown',
        frontend: versions.frontend || 'unknown',
        app: this.versionService.getAppVersion()
      },
      gpuMode
    };
    
    ctx.body = status;
  }



  // Get ComfyUI logs
  async getLogs(ctx: Context): Promise<void> {
    const lang = (ctx.query.lang as string) || getClientLocale(ctx) || 'zh';
    
    logger.info(`[API] Received get ComfyUI logs request (language: ${lang})`);
    
    // Get localized logs from service
    const localizedLogs = this.logService.getLocalizedLogs(lang);
    
    const response: ComfyUILogsResponse = {
      logs: localizedLogs
    };
    
    ctx.body = response;
  }



  // Start ComfyUI
  async startComfyUI(ctx: Context): Promise<void> {
    logger.info('[API] 收到启动ComfyUI请求');
    
    const result = await this.processService.startComfyUI();
    
    if (result.success) {
      ctx.body = result;
    } else {
      ctx.status = 500;
      ctx.body = result;
    }
  }

  // Stop ComfyUI
  async stopComfyUI(ctx: Context): Promise<void> {
    logger.info('[API] 收到停止ComfyUI请求');
    
    const result = await this.processService.stopComfyUI();
    
    if (result.success) {
      ctx.body = result;
    } else {
      ctx.status = 500;
      ctx.body = result;
    }
  }
  


  // Reset ComfyUI to initial state
  async resetComfyUI(ctx: Context): Promise<void> {
    // Get language parameters from request body
    const requestBody = ctx.request.body as ResetRequest;
    const lang = requestBody?.lang || getClientLocale(ctx) || i18nLogger.getLocale();
    // Get reset mode: normal or hard
    const resetMode = requestBody?.mode === 'hard' ? 'hard' : 'normal';
    
    logger.info(`[API] Received reset ComfyUI request (language: ${lang}, mode: ${resetMode})`);
    
    const result = await this.processService.resetComfyUI(lang, resetMode);
    
    if (result.success) {
      ctx.body = result;
    } else {
      ctx.status = 500;
      ctx.body = result;
    }
  }
  


  // Get reset logs with i18n support
  async getResetLogs(ctx: Context): Promise<void> {
    // Get language from query parameters
    const lang = ctx.query.lang as string || getClientLocale(ctx) || i18nLogger.getLocale();
    logger.info(`[API] Received get ComfyUI reset logs request (language: ${lang})`);
    
    // Get localized reset logs from service
    const translatedLogs = this.logService.getLocalizedResetLogs(lang);
    
    // Return localized message
    let message = '';
    if (translatedLogs.length === 0) {
      message = i18nLogger.translate('comfyui.reset.no_logs', { lng: lang });
      // If still a translation key, use hardcoded message
      if (message === 'comfyui.reset.no_logs') {
        message = lang === 'zh' ? '未找到重置日志' : 'No reset logs found';
      }
    } else {
      message = i18nLogger.translate('comfyui.reset.logs_retrieved', { count: translatedLogs.length, lng: lang });
      // If still a translation key, use hardcoded message
      if (message === 'comfyui.reset.logs_retrieved') {
        message = lang === 'zh' ? `已检索到 ${translatedLogs.length} 条重置日志` : `Retrieved ${translatedLogs.length} reset log entries`;
      }
    }
    
    const response: ComfyUIResetLogsResponse = {
      logs: translatedLogs,
      success: true,
      message: message
    };
    
    ctx.body = response;
  }

}

// Export proxy server creation function
export { createComfyUIProxy }; 