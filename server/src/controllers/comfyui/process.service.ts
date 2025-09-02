import { spawn, ChildProcess, exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { config, cachePath, paths } from '../../config';
import { logger } from '../../utils/logger';
import { i18nLogger } from '../../utils/logger';
import { isComfyUIRunning } from './utils';
import { LogService } from './log.service';

const execPromise = promisify(exec);

export class ProcessService {
  private comfyProcess: ChildProcess | null = null;
  private startTime: Date | null = null;
  private comfyPid: number | null = null;
  private logService: LogService;
  
  constructor(logService: LogService) {
    this.logService = logService;
  }
  
  // Check if ComfyUI is running and capture PID if it is
  async checkIfComfyUIRunning(): Promise<void> {
    try {
      const running = await isComfyUIRunning();
      if (running) {
        // If ComfyUI is already running, find its process ID
        exec("ps aux | grep '[p]ython.*comfyui' | awk '{print $2}'", (error, stdout) => {
          if (!error && stdout.trim()) {
            const pid = parseInt(stdout.trim(), 10);
            if (!isNaN(pid)) {
              this.comfyPid = pid;
              this.startTime = new Date(); // Assume just started
              logger.info(`[API] 检测到ComfyUI已在运行，PID: ${pid}`);
            }
          }
        });
      }
    } catch (error) {
      logger.error(`[API] 检查ComfyUI状态时出错: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  // Start ComfyUI
  async startComfyUI(): Promise<{ success: boolean; message: string; pid?: number | null; logs?: string[] }> {
    logger.info('[API] 收到启动ComfyUI请求');
    this.logService.clearLogs(); // Clear previous logs
    this.logService.addLog('收到启动ComfyUI请求', false, 'comfyui.logs.request_start');
    
    // First check if already running
    const running = await isComfyUIRunning();
    if (running) {
      this.logService.addLog('ComfyUI已经在运行中', false, 'comfyui.logs.already_running');
      return {
        success: false,
        message: 'ComfyUI已经在运行中',
        pid: this.comfyPid
      };
    }
    
    try {
      // Start ComfyUI process
      this.logService.addLog('尝试启动ComfyUI进程...', false, 'comfyui.logs.attempting_start');
      this.logService.addLog(`执行命令: bash ${path.resolve('/runner-scripts/entrypoint.sh')}`, false, 'comfyui.logs.executing_command');
      
      this.comfyProcess = spawn('bash', ['/runner-scripts/entrypoint.sh'], {
        detached: false, // Process not detached, exits with main process
        stdio: ['ignore', 'pipe', 'pipe'] // Ignore stdin, capture stdout and stderr
      });
      
      this.startTime = new Date();
      
      // Capture output
      if (this.comfyProcess.stdout) {
        this.comfyProcess.stdout.on('data', (data) => {
          const output = data.toString().trim();
          this.logService.addLog(`[ComfyUI] ${output}`);
          
          // Try to capture actual ComfyUI process ID from output
          const match = output.match(/ComfyUI.*启动.*pid[:\s]+(\d+)/i);
          if (match && match[1]) {
            this.comfyPid = parseInt(match[1], 10);
            this.logService.addLog(`捕获到ComfyUI真实PID: ${this.comfyPid}`, false, 'comfyui.logs.captured_pid', { 
              pid: this.comfyPid 
            });
          }
        });
      }
      
      if (this.comfyProcess.stderr) {
        this.comfyProcess.stderr.on('data', (data) => {
          const errorMsg = data.toString().trim();
          this.logService.addLog(`[ComfyUI-Error] ${errorMsg}`, true);
        });
      }
      
      // Listen for process exit
      this.comfyProcess.on('exit', (code, signal) => {
        this.logService.addLog(`启动脚本进程已退出，退出码: ${code}, 信号: ${signal}`, false, 'comfyui.logs.process_exited', {
          code: code,
          signal: signal
        });
        this.comfyProcess = null;
        
        // Check if ComfyUI is still running
        this.checkIfComfyUIRunning().then(async () => {
          const stillRunning = await isComfyUIRunning();
          if (!stillRunning) {
            this.comfyPid = null;
            this.startTime = null;
          }
        });
      });
      
      // Listen for errors
      this.comfyProcess.on('error', (err) => {
        this.logService.addLog(`启动脚本进程错误: ${err.message}`, true, 'comfyui.logs.process_error', {
          message: err.message
        });
        this.comfyProcess = null;
      });
      
      // Wait for a while to ensure process starts successfully
      let retries = 0;
      const maxRetries = 120;
      let comfyStarted = false;
      
      while (retries < maxRetries && !comfyStarted) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        comfyStarted = await isComfyUIRunning();
        
        if (comfyStarted) {
          // Get real ComfyUI process ID
          if (!this.comfyPid) {
            exec("ps aux | grep '[p]ython.*comfyui' | awk '{print $2}'", (error, stdout) => {
              if (!error && stdout.trim()) {
                this.comfyPid = parseInt(stdout.trim(), 10);
                this.logService.addLog(`找到ComfyUI PID: ${this.comfyPid}`);
              }
            });
          }
          break;
        }
        
        retries++;
        this.logService.addLog(`等待ComfyUI启动，尝试 ${retries}/${maxRetries}`, false, 'comfyui.logs.waiting_startup', { 
          retry: retries, 
          maxRetries: maxRetries 
        });
      }
      
      if (comfyStarted) {
        this.logService.addLog('ComfyUI启动成功');
        return {
          success: true,
          message: 'ComfyUI已启动',
          pid: this.comfyPid
        };
      } else {
        this.logService.addLog('ComfyUI启动失败或超时', true);
        
        // Try to clean up startup script process
        if (this.comfyProcess && this.comfyProcess.kill) {
          this.comfyProcess.kill();
          this.comfyProcess = null;
        }
        this.startTime = null;
        
        return {
          success: false,
          message: 'ComfyUI启动失败或超时',
          logs: this.logService.getRecentLogs()
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logService.addLog(`ComfyUI启动失败: ${errorMessage}`, true);
      return {
        success: false,
        message: `启动失败: ${errorMessage}`,
        logs: this.logService.getRecentLogs()
      };
    }
  }
  
  // Stop ComfyUI
  async stopComfyUI(): Promise<{ success: boolean; message: string; error?: string }> {
    logger.info('[API] 收到停止ComfyUI请求');
    
    try {
      // First check if really running
      const running = await isComfyUIRunning();
      if (!running) {
        logger.info('[API] ComfyUI已经停止，无需操作');
        this.comfyPid = null;
        this.startTime = null;
        return { success: true, message: 'ComfyUI已经停止' };
      }
      
      logger.info('[API] 尝试停止ComfyUI进程...');
      
      // Prefer using generic method to terminate
      await this.killComfyUIGeneric();
      
      // Wait enough time for process to fully terminate
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Final check
      const finalCheck = await isComfyUIRunning();
      if (!finalCheck) {
        logger.info('[API] ComfyUI已成功停止');
        this.comfyPid = null;
        this.startTime = null;
        return { success: true, message: 'ComfyUI停止成功' };
      } else {
        // If first attempt didn't succeed, try again with stronger method
        logger.warn('[API] 首次尝试未能完全停止ComfyUI，使用强制终止');
        await execPromise('pkill -9 -f python').catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const lastCheck = await isComfyUIRunning();
        if (!lastCheck) {
          logger.info('[API] ComfyUI在强制终止后已停止');
          this.comfyPid = null;
          this.startTime = null;
          return { success: true, message: 'ComfyUI停止成功（强制）' };
        } else {
          logger.error('[API] 无法停止ComfyUI，即使在强制终止后');
          return { success: false, message: '无法停止ComfyUI', error: '无法停止ComfyUI' };
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[API] 停止ComfyUI时发生错误: ${errorMessage}`);
      return { success: false, message: '停止ComfyUI时发生错误', error: '停止ComfyUI时发生错误' };
    }
  }
  
  // Use generic method to terminate ComfyUI
  private async killComfyUIGeneric(): Promise<void> {
    try {
      // First find large Python processes (might be ComfyUI)
      const { stdout } = await execPromise("ps aux | grep python | grep -v grep | awk '{if($6>100000) print $2}'");
      const pids = stdout.trim().split('\n').filter((pid: string) => pid);
      
      if (pids.length > 0) {
        logger.info(`[API] 找到可能的ComfyUI进程: ${pids.join(', ')}`);
        
        // Terminate found processes one by one
        for (const pid of pids) {
          try {
            await execPromise(`kill -9 ${pid}`);
            logger.info(`[API] 已终止进程 ${pid}`);
          } catch (e: unknown) {
            logger.warn(`[API] 终止进程 ${pid} 失败: ${e}`);
          }
        }
        return;
      }
    } catch (e: unknown) {
      logger.error(`[API] 查找ComfyUI进程失败: ${e}`);
    }
    
    // Fallback: use generic command
    const cmd = 'pkill -9 -f "python"';
    logger.info(`[API] 使用后备终止命令: ${cmd}`);
    await execPromise(cmd).catch((e: unknown) => logger.warn(`[API] 后备终止失败: ${e}`));
  }
  
  // Reset ComfyUI to initial state
  async resetComfyUI(lang: string, mode: 'normal' | 'hard' = 'normal'): Promise<{ success: boolean; message: string; logs?: string[] }> {
    logger.info(`[API] Received reset ComfyUI request (language: ${lang}, mode: ${mode})`);
    
    // Clear reset logs
    this.logService.clearResetLogs();
    
    // Also clear log file
    try {
      const logFilePath = path.join(process.cwd(), 'logs', 'comfyui-reset.log');
      if (!fs.existsSync(path.dirname(logFilePath))) {
        fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
      }
      fs.writeFileSync(logFilePath, ''); // Clear file content
    } catch (error) {
      logger.error(`Failed to clear reset log file: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    // Use i18n to add logs
    const startMessage = i18nLogger.translate('comfyui.reset.started', { lng: lang });
    this.logService.addResetLog('comfyui.reset.started', false, lang);
    this.logService.addLog(startMessage);
    
    // Record reset mode
    const modeMessage = mode === 'hard' 
      ? i18nLogger.translate('comfyui.reset.mode_hard', { lng: lang }) || '使用强力重置模式'
      : i18nLogger.translate('comfyui.reset.mode_normal', { lng: lang }) || '使用普通重置模式';
    this.logService.addResetLog(modeMessage);
    
    try {
      // First check if ComfyUI is running, if so stop it
      const running = await isComfyUIRunning();
      if (running) {
        const stoppingMessage = i18nLogger.translate('comfyui.reset.stopping', { lng: lang });
        this.logService.addResetLog(stoppingMessage);
        this.logService.addLog(stoppingMessage);
        await this.killComfyUIGeneric();
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const stillRunning = await isComfyUIRunning();
        if (stillRunning) {
          const stopFailedMessage = i18nLogger.translate('comfyui.reset.stop_failed', { lng: lang });
          this.logService.addResetLog(stopFailedMessage, true);
          return { success: false, message: stopFailedMessage };
        }
        
        this.comfyPid = null;
        this.startTime = null;
      }
      
      // Start reset operation
      this.logService.addResetLog(i18nLogger.translate('comfyui.reset.started', { lng: lang }));
      
      // 1. Clear cache path
      if (cachePath && fs.existsSync(cachePath)) {
        const cleaningCacheMessage = i18nLogger.translate('comfyui.reset.cleaning_cache', { path: cachePath, lng: lang });
        this.logService.addResetLog(cleaningCacheMessage);
        await this.clearDirectory(cachePath);
      } else {
        const cacheNotExistMessage = i18nLogger.translate('comfyui.reset.cache_not_exist', { path: cachePath, lng: lang });
        this.logService.addResetLog(cacheNotExistMessage, true);
      }
      
      // 2. Clear content under COMFYUI_PATH, preserve different directories based on reset mode
      const comfyuiPath = paths.comfyui;
      if (comfyuiPath && fs.existsSync(comfyuiPath)) {
        const cleaningPathMessage = i18nLogger.translate('comfyui.reset.cleaning_path', { path: comfyuiPath, lng: lang });
        this.logService.addResetLog(cleaningPathMessage);
        
        // Determine list of directories to preserve
        const preservedDirs = ['models', 'output', 'input']; // Default preserved directories
        
        // Add additional preserved directories based on reset mode
        if (mode === 'normal') {
          preservedDirs.push('user', 'custom_nodes');
          this.logService.addResetLog(i18nLogger.translate('comfyui.reset.preserving_normal_dirs', { lng: lang }) || '普通模式：保留 user、models、custom_nodes 目录');
        } else {
          this.logService.addResetLog(i18nLogger.translate('comfyui.reset.preserving_hard_dirs', { lng: lang }) || '强力模式：仅保留 models 目录');
        }
        
        // Check if data directory is within comfyuiPath
        const dataDir = config.dataDir;
        const dataDirRelative = dataDir && path.relative(comfyuiPath, dataDir);
        const isDataDirInComfyUI = dataDirRelative && !dataDirRelative.startsWith('..') && !path.isAbsolute(dataDirRelative);
        
        if (isDataDirInComfyUI) {
          this.logService.addResetLog(`数据目录(${dataDir})位于ComfyUI目录内，将保留此目录`);
          preservedDirs.push(path.basename(dataDir));
        }
        
        const entries = fs.readdirSync(comfyuiPath, { withFileTypes: true });
        
        for (const entry of entries) {
          // Check if it's a directory that needs to be preserved
          if (preservedDirs.includes(entry.name)) {
            const keepingDirMessage = i18nLogger.translate('comfyui.reset.keeping_dir', { name: entry.name, lng: lang });
            this.logService.addResetLog(keepingDirMessage);
            continue;
          }
          
          const fullPath = path.join(comfyuiPath, entry.name);
          if (entry.isDirectory()) {
            const deletingDirMessage = i18nLogger.translate('comfyui.reset.deleting_dir', { name: entry.name, lng: lang });
            this.logService.addResetLog(deletingDirMessage);
            await this.clearDirectory(fullPath, true); // Delete entire directory
          } else {
            const deletingFileMessage = i18nLogger.translate('comfyui.reset.deleting_file', { name: entry.name, lng: lang });
            this.logService.addResetLog(deletingFileMessage);
            fs.unlinkSync(fullPath);
          }
        }
      } else {
        const pathNotExistMessage = i18nLogger.translate('comfyui.reset.path_not_exist', { path: comfyuiPath, lng: lang });
        this.logService.addResetLog(pathNotExistMessage, true);
      }
      
      // 3. Try to execute recovery script, only restart Pod if failed
      try {
        const recoveryStartedMessage = i18nLogger.translate('comfyui.reset.recovery_started', { lng: lang });
        this.logService.addResetLog(recoveryStartedMessage);
        
        // First try to execute recovery script
        try {
          await execPromise('chmod +x /runner-scripts/up-version-cp.sh');
          this.logService.addResetLog('已赋予脚本执行权限');
          
          const { stdout: upVersionOutput } = await execPromise('sh /runner-scripts/up-version-cp.sh');
          this.logService.addResetLog(`执行up-version-cp.sh脚本结果: ${upVersionOutput.trim() || '完成'}`);
          
          const { stdout: rsyncOutput } = await execPromise('rsync -av --update /runner-scripts/ /root/runner-scripts/');
          this.logService.addResetLog(`同步runner-scripts目录结果: ${rsyncOutput.trim().split('\n')[0]}...`);
          
          const recoveryCompletedMessage = i18nLogger.translate('comfyui.reset.recovery_completed', { lng: lang });
          this.logService.addResetLog(recoveryCompletedMessage);
          
        } catch (scriptError) {
          // Recovery script execution failed, try to restart Pod
          const errorMsg = scriptError instanceof Error ? scriptError.message : String(scriptError);
          const recoveryFailedMessage = i18nLogger.translate('comfyui.reset.recovery_failed', { message: errorMsg, lng: lang });
          this.logService.addResetLog(recoveryFailedMessage, true);
        }
      } catch (cmdError) {
        const errorMsg = cmdError instanceof Error ? cmdError.message : String(cmdError);
        this.logService.addResetLog(`执行恢复/重启操作时出错: ${errorMsg}`, true);
        // Continue execution, don't interrupt entire reset process
      }
      
      const resetCompletedMessage = i18nLogger.translate('comfyui.reset.reset_completed', { lng: lang });
      this.logService.addResetLog(resetCompletedMessage);
      
      // Return success response
      const successMessage = i18nLogger.translate('comfyui.reset.completed', { lng: lang });
      return {
        success: true,
        message: successMessage
      };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const failedMessage = i18nLogger.translate('comfyui.reset.failed', { message: errorMessage, lng: lang });
      this.logService.addResetLog(`重置ComfyUI时发生错误: ${errorMessage}`, true);
      logger.error(`[API] 重置ComfyUI时发生错误: ${errorMessage}`);
      
      return {
        success: false,
        message: failedMessage,
        logs: this.logService.getResetLogs()
      };
    }
  }
  
  // Helper method: clear directory
  private async clearDirectory(dirPath: string, removeDir: boolean = false): Promise<void> {
    if (!fs.existsSync(dirPath)) {
      return;
    }
    
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        await this.clearDirectory(fullPath, true);
      } else {
        // Safely delete file
        try {
          fs.unlinkSync(fullPath);
        } catch (error) {
          this.logService.addResetLog(`无法删除文件 ${fullPath}: ${error instanceof Error ? error.message : String(error)}`, true);
        }
      }
    }
    
    // If needed, delete directory itself
    if (removeDir) {
      try {
        fs.rmdirSync(dirPath);
      } catch (error) {
        this.logService.addResetLog(`无法删除目录 ${dirPath}: ${error instanceof Error ? error.message : String(error)}`, true);
      }
    }
  }
  
  // Clean up disabled plugins that still exist in plugin directory
  async cleanupDisabledPlugins(): Promise<void> {
    try {
      const comfyuiPath = paths.comfyui;
      if (!comfyuiPath || !fs.existsSync(comfyuiPath)) {
        logger.warn('[Plugin Cleanup] ComfyUI路径不存在，跳过插件清理');
        return;
      }

      // Define plugin directory and disabled directory paths
      const pluginsDir = path.join(comfyuiPath, 'custom_nodes');
      const disabledDir = path.join(pluginsDir, '.disabled');

      // Check if directories exist
      if (!fs.existsSync(pluginsDir)) {
        logger.warn('[Plugin Cleanup] 插件目录不存在，跳过插件清理');
        return;
      }

      if (!fs.existsSync(disabledDir)) {
        logger.info('[Plugin Cleanup] 禁用插件目录不存在，无需清理');
        return;
      }

      logger.info('[Plugin Cleanup] 开始检查插件目录状态...');

      // Get all plugins in disabled directory
      const disabledPlugins = fs.readdirSync(disabledDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

      if (disabledPlugins.length === 0) {
        logger.info('[Plugin Cleanup] 未发现被禁用的插件，无需清理');
        return;
      }

      logger.info(`[Plugin Cleanup] 发现 ${disabledPlugins.length} 个被禁用的插件`);

      // Check if plugin directory contains any disabled plugins
      let cleanupCount = 0;
      for (const plugin of disabledPlugins) {
        const pluginPath = path.join(pluginsDir, plugin);
        
        if (fs.existsSync(pluginPath)) {
          logger.warn(`[Plugin Cleanup] 发现被禁用的插件 "${plugin}" 存在于插件目录中，正在删除...`);
          
          try {
            // Recursively delete plugin directory
            await this.clearDirectory(pluginPath, true);
            cleanupCount++;
            logger.info(`[Plugin Cleanup] 成功删除被禁用的插件: ${plugin}`);
          } catch (error) {
            logger.error(`[Plugin Cleanup] 删除插件 "${plugin}" 失败: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }

      if (cleanupCount > 0) {
        logger.info(`[Plugin Cleanup] 清理完成，共删除 ${cleanupCount} 个重复的被禁用插件`);
      } else {
        logger.info('[Plugin Cleanup] 未发现需要清理的插件，插件目录状态良好');
      }
    } catch (error) {
      logger.error(`[Plugin Cleanup] 清理插件时发生错误: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  // Getters
  getComfyPid(): number | null {
    return this.comfyPid;
  }
  
  getStartTime(): Date | null {
    return this.startTime;
  }
  
  getComfyProcess(): ChildProcess | null {
    return this.comfyProcess;
  }
}
