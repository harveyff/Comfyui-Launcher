/**
 * 资源包基础控制器
 * 包含资源包管理的核心逻辑和公共方法
 */
import * as Koa from 'koa';
import * as path from 'path';
import * as fs from 'fs';
import { DownloadController } from '../download/download.controller';
import { 
  ResourcePack, 
  ResourceType, 
  InstallStatus, 
  ModelResource, 
  PluginResource, 
  WorkflowResource, 
  CustomResource 
} from '../../types/resource-packs.types';
import { logger } from '../../utils/logger';
import { ProgressManager } from './progress-manager';
import { ModelInstaller } from './model-installer';
import { PluginInstaller } from './plugin-installer';
import { WorkflowInstaller } from './workflow-installer';
import { CustomInstaller } from './custom-installer';

export class BaseResourcePacksController extends DownloadController {
  protected resourcePacks: ResourcePack[] = [];
  protected progressManager: ProgressManager;
  protected modelInstaller: ModelInstaller;
  protected pluginInstaller: PluginInstaller;
  protected workflowInstaller: WorkflowInstaller;
  protected customInstaller: CustomInstaller;
  protected comfyuiPath: string;
  
  // 存储每个任务的 AbortController，用于取消下载
  protected taskAbortControllers = new Map<string, AbortController>();

  constructor() {
    super();
    
    // 获取ComfyUI路径
    const { config } = require('../../config');
    this.comfyuiPath = config.comfyui.path || process.env.COMFYUI_PATH || path.join(process.cwd(), 'comfyui');
    
    // 初始化各个安装器和进度管理器
    this.progressManager = new ProgressManager();
    this.modelInstaller = new ModelInstaller(this.comfyuiPath);
    this.pluginInstaller = new PluginInstaller(this.comfyuiPath);
    this.workflowInstaller = new WorkflowInstaller(this.comfyuiPath);
    this.customInstaller = new CustomInstaller(this.comfyuiPath);
    
    // 加载资源包
    this.loadResourcePacks();
  }

  /**
   * 加载资源包列表
   */
  protected loadResourcePacks(): void {
    try {
      // 从标准路径加载资源包定义
      const packDefinitionsPath = path.join(__dirname, '../../../resource-packs');
      
      // 确保目录存在
      if (!fs.existsSync(packDefinitionsPath)) {
        fs.mkdirSync(packDefinitionsPath, { recursive: true });
        logger.info(`创建资源包目录: ${packDefinitionsPath}`);
      }
      
      // 读取目录下所有JSON文件
      const files = fs.readdirSync(packDefinitionsPath).filter(file => file.endsWith('.json'));
      
      for (const file of files) {
        try {
          const filePath = path.join(packDefinitionsPath, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          const pack = JSON.parse(content) as ResourcePack;
          
          // 验证资源包格式
          if (this.validateResourcePack(pack)) {
            this.resourcePacks.push(pack);
            logger.info(`已加载资源包: ${pack.name}`);
          } else {
            logger.warn(`资源包格式无效: ${filePath}`);
          }
        } catch (error) {
          logger.error(`解析资源包文件失败 ${file}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      logger.info(`共加载 ${this.resourcePacks.length} 个资源包`);
    } catch (error) {
      logger.error(`加载资源包失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 验证资源包格式
   */
  protected validateResourcePack(pack: any): boolean {
    // 基本属性验证
    if (!pack.id || !pack.name || !Array.isArray(pack.resources)) {
      return false;
    }
    
    // 资源验证
    for (const resource of pack.resources) {
      if (!resource.id || !resource.name || !resource.type) {
        return false;
      }
      
      // 根据类型验证特定属性
      switch (resource.type) {
        case ResourceType.MODEL:
          if ((!resource.url || !resource.dir || !resource.out)) {
            return false;
          }
          break;
        case ResourceType.PLUGIN:
          if (!resource.github) {
            return false;
          }
          break;
        case ResourceType.WORKFLOW:
          if (!resource.url || !resource.filename) {
            return false;
          }
          break;
        case ResourceType.CUSTOM:
          if (!resource.url || !resource.destination) {
            return false;
          }
          break;
        default:
          return false;
      }
    }
    
    return true;
  }

  /**
   * 获取资源包列表
   */
  public async getResourcePacks(ctx: Koa.Context): Promise<void> {
    ctx.body = this.resourcePacks;
  }

  /**
   * 获取资源包详情
   */
  public async getResourcePackDetail(ctx: Koa.Context): Promise<void> {
    const { id } = ctx.params;
    
    const pack = this.resourcePacks.find(p => p.id === id);
    if (!pack) {
      ctx.status = 404;
      ctx.body = { error: `资源包 ${id} 不存在` };
      return;
    }
    
    ctx.body = pack;
  }

  /**
   * 开始资源包安装
   */
  protected async startResourcePackInstallation(
    pack: ResourcePack, 
    taskId: string, 
    source: string = 'hf',
    selectedResources?: string[]
  ): Promise<void> {
    logger.info(`开始安装资源包: ${pack.name}, 任务ID: ${taskId}`);
    
    // 获取进度对象
    const progress = this.progressManager.getProgress(taskId);
    if (!progress) {
      throw new Error(`未找到任务 ${taskId} 的进度信息`);
    }
    
    // 为任务创建 AbortController
    const abortController = new AbortController();
    this.taskAbortControllers.set(taskId, abortController);
    
    // 更新状态为下载中
    this.progressManager.updateTaskStatus(taskId, InstallStatus.DOWNLOADING);
    
    // 过滤要安装的资源
    const resourcesToInstall = selectedResources 
      ? pack.resources.filter(r => selectedResources.includes(r.id))
      : pack.resources;
    
    try {
      // 依次安装每个资源
      for (let i = 0; i < resourcesToInstall.length; i++) {
        // 检查是否已取消
        if (this.progressManager.isTaskCanceled(taskId) || abortController.signal.aborted) {
          logger.info(`安装已取消: ${pack.name}`);
          this.progressManager.updateTaskStatus(taskId, InstallStatus.CANCELED);
          return;
        }
        
        const resource = resourcesToInstall[i];
        
        // 更新当前资源状态
        this.progressManager.updateResourceStatus(
          taskId, 
          resource.id, 
          InstallStatus.DOWNLOADING, 
          0
        );
        
        try {
          logger.info(`开始安装资源: ${resource.name} (${i + 1}/${resourcesToInstall.length})`);
          
          // 创建进度回调函数
          const onProgress = (status: InstallStatus, progress: number, error?: string) => {
            this.progressManager.updateResourceStatus(taskId, resource.id, status, progress, error);
          };
          
          // 根据资源类型执行不同的安装逻辑，传递 AbortController
          switch (resource.type) {
            case ResourceType.MODEL:
              await this.modelInstaller.installModelResource(
                resource as ModelResource, 
                taskId, 
                source,
                onProgress,
                abortController
              );
              break;
              
            case ResourceType.PLUGIN:
              await this.pluginInstaller.installPluginResource(
                resource as PluginResource, 
                taskId,
                onProgress,
                abortController
              );
              break;
              
            case ResourceType.WORKFLOW:
              await this.workflowInstaller.installWorkflowResource(
                resource as WorkflowResource, 
                taskId,
                onProgress,
                abortController
              );
              break;
              
            case ResourceType.CUSTOM:
              await this.customInstaller.installCustomResource(
                resource as CustomResource, 
                taskId,
                onProgress,
                abortController
              );
              break;
          }
          
        } catch (error) {
          // 检查是否是取消导致的错误
          if (abortController.signal.aborted || this.progressManager.isTaskCanceled(taskId)) {
            logger.info(`资源 ${resource.name} 安装已取消`);
            this.progressManager.updateResourceStatus(taskId, resource.id, InstallStatus.CANCELED, 0);
            return;
          }
          
          // 记录错误并继续安装其他资源
          const errorMsg = error instanceof Error ? error.message : String(error);
          logger.error(`安装资源 ${resource.name} 失败: ${errorMsg}`);
          
          this.progressManager.updateResourceStatus(
            taskId, 
            resource.id, 
            InstallStatus.ERROR, 
            0, 
            errorMsg
          );
        }
        
        // 更新总体进度
        this.progressManager.updateOverallProgress(taskId, i, resourcesToInstall.length);
      }
      
      // 完成安装
      this.progressManager.updateTaskStatus(taskId, InstallStatus.COMPLETED);
      
      logger.info(`资源包 ${pack.name} 安装完成`);
      
    } finally {
      // 清理 AbortController
      this.taskAbortControllers.delete(taskId);
    }
  }

  /**
   * 获取资源包安装进度
   */
  public async getInstallProgress(ctx: Koa.Context): Promise<void> {
    const { taskId } = ctx.params;
    
    const progress = this.progressManager.getProgress(taskId);
    if (!progress) {
      ctx.status = 404;
      ctx.body = { error: `未找到任务 ${taskId} 的进度信息` };
      return;
    }
    
    ctx.body = progress;
  }

  /**
   * 取消资源包安装
   */
  public async cancelInstallation(ctx: Koa.Context): Promise<void> {
    const { taskId } = ctx.params;
    
    const progress = this.progressManager.getProgress(taskId);
    if (!progress) {
      ctx.status = 404;
      ctx.body = { error: `未找到任务 ${taskId} 的进度信息` };
      return;
    }
    
    // 取消任务
    this.progressManager.cancelTask(taskId);
    
    // 使用基类的取消方法
    await this.cancelDownloadTask(taskId);
    
    ctx.body = { success: true, message: '已取消安装任务' };
  }

  /**
   * 实现取消下载任务方法
   */
  async cancelDownloadTask(taskId: string): Promise<boolean> {
    // 取消任务
    const success = this.progressManager.cancelTask(taskId);
    
    if (success) {
      // 获取并取消对应的 AbortController
      const abortController = this.taskAbortControllers.get(taskId);
      if (abortController) {
        abortController.abort();
        logger.info(`已中断任务 ${taskId} 的 AbortController`);
      }
      
      // 调用父类的取消下载方法
      await super.cancelDownload({ request: { body: { taskId } } } as Koa.Context);
      logger.info(`成功取消下载任务: ${taskId}`);
    }
    
    return success;
  }
}
