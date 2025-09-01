import { Context } from 'koa';
import { v4 as uuidv4 } from 'uuid';
import logger from '../../utils/logger';
import { PluginHistoryManager } from './history';
import { PluginInstallManager } from './install';
import { PluginUninstallManager } from './uninstall';
import { PluginCacheManager } from './cache';
import { TaskProgressManager } from './progress';
import { PluginInfoManager } from './info';

export class PluginsController {
  private historyManager: PluginHistoryManager;
  private installManager: PluginInstallManager;
  private uninstallManager: PluginUninstallManager;
  private cacheManager: PluginCacheManager;
  private progressManager: TaskProgressManager;
  private infoManager: PluginInfoManager;

  constructor() {
    // 初始化各个管理器
    this.historyManager = new PluginHistoryManager();
    this.cacheManager = new PluginCacheManager();
    this.progressManager = new TaskProgressManager();
    this.infoManager = new PluginInfoManager();
    this.installManager = new PluginInstallManager(this.historyManager);
    this.uninstallManager = new PluginUninstallManager(this.historyManager);
  }

  // 获取所有插件
  async getAllPlugins(ctx: Context): Promise<void> {
    try {
      console.log('[API] 获取所有插件');
      
      const forceRefresh = ctx.query.force === 'true';
      const pluginsData = await this.cacheManager.getAllPlugins(forceRefresh);
      
      ctx.body = pluginsData;
    } catch (error) {
      console.error('[API] 获取插件列表失败:', error);
      ctx.status = 500;
      ctx.body = { error: '获取插件列表失败' };
    }
  }

  // 安装插件
  async installPlugin(ctx: Context): Promise<void> {
    const { pluginId } = ctx.request.body as { pluginId: string };
    const { githubProxy: clientProvidedProxy } = ctx.request.body as { githubProxy: string };
    
    try {
      const taskId = await this.installManager.installPlugin(ctx, pluginId, clientProvidedProxy);
      
      // 创建进度任务
      this.progressManager.createTask(taskId, pluginId, 'install', clientProvidedProxy);
      
      ctx.body = {
        success: true,
        message: '开始安装插件',
        taskId
      };
    } catch (error) {
      console.error(`[API] 安装插件失败: ${error}`);
      ctx.status = 500;
      ctx.body = {
        success: false,
        message: `安装失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  // 卸载插件
  async uninstallPlugin(ctx: Context): Promise<void> {
    const { pluginId } = ctx.request.body as { pluginId: string };
    
    try {
      const taskId = await this.uninstallManager.uninstallPlugin(ctx, pluginId);
      
      // 创建进度任务
      this.progressManager.createTask(taskId, pluginId, 'uninstall');
      
      ctx.body = {
        success: true,
        message: '开始卸载插件',
        taskId
      };
    } catch (error) {
      console.error(`[API] 卸载插件失败: ${error}`);
      ctx.status = 500;
      ctx.body = {
        success: false,
        message: `卸载失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  // 禁用插件
  async disablePlugin(ctx: Context): Promise<void> {
    const { pluginId } = ctx.request.body as { pluginId: string };
    
    try {
      const taskId = await this.uninstallManager.disablePlugin(ctx, pluginId);
      
      // 创建进度任务
      this.progressManager.createTask(taskId, pluginId, 'disable');
      
      ctx.body = {
        success: true,
        message: '开始禁用插件',
        taskId
      };
    } catch (error) {
      console.error(`[API] 禁用插件失败: ${error}`);
      ctx.status = 500;
      ctx.body = {
        success: false,
        message: `禁用失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  // 启用插件
  async enablePlugin(ctx: Context): Promise<void> {
    const { pluginId } = ctx.request.body as { pluginId: string };
    
    try {
      const taskId = await this.uninstallManager.enablePlugin(ctx, pluginId);
      
      // 创建进度任务
      this.progressManager.createTask(taskId, pluginId, 'enable');
      
      ctx.body = {
        success: true,
        message: '开始启用插件',
        taskId
      };
    } catch (error) {
      console.error(`[API] 启用插件失败: ${error}`);
      ctx.status = 500;
      ctx.body = {
        success: false,
        message: `启用失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  // 获取插件操作进度
  async getPluginProgress(ctx: Context): Promise<void> {
    const { taskId } = ctx.params;
    
    const progress = this.progressManager.getTaskProgress(taskId);
    if (!progress) {
      ctx.status = 404;
      ctx.body = {
        success: false,
        message: '找不到该任务'
      };
      return;
    }
    
    ctx.body = {
      ...progress
    };
  }

  // 获取操作历史记录
  async getOperationHistory(ctx: Context): Promise<void> {
    await this.historyManager.getOperationHistory(ctx);
  }

  // 获取特定操作的详细日志
  async getOperationLogs(ctx: Context): Promise<void> {
    await this.historyManager.getOperationLogs(ctx);
  }

  // 清除历史记录
  async clearOperationHistory(ctx: Context): Promise<void> {
    await this.historyManager.clearOperationHistory(ctx);
  }

  // 刷新已安装插件列表
  async refreshInstalledPlugins(ctx: Context): Promise<void> {
    try {
      console.log('[API] 刷新本地插件列表');
      
      const installedPlugins = await this.cacheManager.refreshInstalledPlugins();
      
      ctx.body = {
        success: true,
        message: '已刷新插件列表',
        plugins: installedPlugins
      };
    } catch (error) {
      console.error(`[API] 刷新本地插件列表失败: ${error}`);
      ctx.status = 500;
      ctx.body = {
        success: false,
        message: `刷新失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  // 如果其他控制器需要访问这些方法，确保它们是公共的
  public getPluginPath(pluginId: string): string {
    return this.uninstallManager.getPluginPath(pluginId);
  }

  public async getInstalledPluginsForPython(): Promise<any[]> {
    return this.infoManager.getAllInstalledPluginsInfo();
  }

  // 获取插件历史记录 - 添加本地化支持
  public async getPluginHistory(ctx: Context): Promise<void> {
    await this.historyManager.getPluginHistory(ctx);
  }
  
  // 清除插件历史记录
  public async clearPluginHistory(ctx: Context): Promise<void> {
    await this.historyManager.clearPluginHistory(ctx);
  }
  
  // 删除特定的插件历史记录
  public async deletePluginHistoryItem(ctx: Context): Promise<void> {
    await this.historyManager.deletePluginHistoryItem(ctx);
  }

  // 添加一个新的公共方法，用于从其他控制器直接调用安装插件
  public async installPluginFromGitHub(
    githubUrl: string, 
    branch: string = 'main',
    progressCallback: (progress: any) => boolean,
    operationId: string
  ): Promise<void> {
    await this.installManager.installPluginFromGitHub(githubUrl, branch, progressCallback, operationId);
  }

  // 添加一个新的API端点，用于自定义插件安装
  async installCustomPlugin(ctx: Context): Promise<void> {
    // 从请求体中获取参数
    const { githubUrl, branch = 'main' } = ctx.request.body as { 
      githubUrl: string, 
      branch?: string 
    };
    
    // 验证参数
    if (!githubUrl) {
      ctx.status = 400;
      ctx.body = {
        success: false,
        message: 'GitHub URL 是必需的'
      };
      return;
    }
    
    try {
      const taskId = await this.installManager.installCustomPlugin(ctx, githubUrl, branch);
      
      // 创建进度任务
      this.progressManager.createTask(taskId, taskId, 'install');
      
      ctx.body = {
        success: true,
        message: '开始安装自定义插件',
        taskId
      };
    } catch (error) {
      console.error(`[API] 自定义插件安装失败: ${error}`);
      ctx.status = 500;
      ctx.body = {
        success: false,
        message: `安装失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  // 获取任务统计信息
  async getTaskStats(ctx: Context): Promise<void> {
    try {
      const stats = this.progressManager.getTaskStats();
      ctx.body = {
        success: true,
        stats
      };
    } catch (error) {
      console.error(`[API] 获取任务统计失败: ${error}`);
      ctx.status = 500;
      ctx.body = {
        success: false,
        message: `获取统计失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  // 清理已完成的任务
  async cleanupCompletedTasks(ctx: Context): Promise<void> {
    try {
      this.progressManager.cleanupCompletedTasks();
      ctx.body = {
        success: true,
        message: '已清理已完成的任务'
      };
    } catch (error) {
      console.error(`[API] 清理任务失败: ${error}`);
      ctx.status = 500;
      ctx.body = {
        success: false,
        message: `清理失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  // 获取缓存状态
  async getCacheStatus(ctx: Context): Promise<void> {
    try {
      const status = this.cacheManager.getCacheStatus();
      ctx.body = {
        success: true,
        status
      };
    } catch (error) {
      console.error(`[API] 获取缓存状态失败: ${error}`);
      ctx.status = 500;
      ctx.body = {
        success: false,
        message: `获取状态失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  // 清空缓存
  async clearCache(ctx: Context): Promise<void> {
    try {
      this.cacheManager.clearCache();
      ctx.body = {
        success: true,
        message: '缓存已清空'
      };
    } catch (error) {
      console.error(`[API] 清空缓存失败: ${error}`);
      ctx.status = 500;
      ctx.body = {
        success: false,
        message: `清空失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  // 验证插件
  async validatePlugin(ctx: Context): Promise<void> {
    const { pluginId } = ctx.params;
    
    try {
      const pluginPath = this.getPluginPath(pluginId);
      const validation = this.infoManager.validatePlugin(pluginPath);
      
      ctx.body = {
        success: true,
        pluginId,
        validation
      };
    } catch (error) {
      console.error(`[API] 验证插件失败: ${error}`);
      ctx.status = 500;
      ctx.body = {
        success: false,
        message: `验证失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  // 获取插件依赖关系
  async getPluginDependencies(ctx: Context): Promise<void> {
    const { pluginId } = ctx.params;
    
    try {
      const pluginPath = this.getPluginPath(pluginId);
      const dependencies = this.infoManager.getPluginDependencies(pluginPath);
      
      ctx.body = {
        success: true,
        pluginId,
        dependencies
      };
    } catch (error) {
      console.error(`[API] 获取插件依赖失败: ${error}`);
      ctx.status = 500;
      ctx.body = {
        success: false,
        message: `获取依赖失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }
} 