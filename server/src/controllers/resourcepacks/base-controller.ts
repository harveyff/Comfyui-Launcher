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

    // 在返回前尽可能为资源补充 size：先本地文件大小，其次尝试远程HEAD
    try {
      const withLocal = this.augmentPackWithLocalSizes(pack);
      const augmented = await this.augmentPackWithRemoteSizes(withLocal);
      ctx.body = augmented;
    } catch (e) {
      ctx.body = pack;
    }
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

          // 读取重试配置
          // comment: keep config import lazy to avoid circular deps at top level
          const { config } = require('../../config');
          const maxAttempts: number = Number(config?.retry?.maxAttempts ?? 2);
          const baseDelayMs: number = Number(config?.retry?.baseDelayMs ?? 1000);
          const backoffFactor: number = Number(config?.retry?.backoffFactor ?? 2);
          const maxDelayMs: number = Number(config?.retry?.maxDelayMs ?? 15000);

          let attempt = 0;
          // 首次尝试 + 重试次数
          const totalAttempts = Math.max(1, 1 + (Number.isFinite(maxAttempts) ? maxAttempts : 0));
          let lastError: any = undefined;

          while (attempt < totalAttempts) {
            // 取消检查
            if (abortController.signal.aborted || this.progressManager.isTaskCanceled(taskId)) {
              logger.info(`资源 ${resource.name} 安装已取消`);
              this.progressManager.updateResourceStatus(taskId, resource.id, InstallStatus.CANCELED, 0);
              return;
            }

            try {
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
              // 成功则跳出重试循环
              lastError = undefined;
              break;
            } catch (err) {
              // 若为取消错误，直接退出
              if (abortController.signal.aborted || this.progressManager.isTaskCanceled(taskId)) {
                logger.info(`资源 ${resource.name} 安装已取消`);
                this.progressManager.updateResourceStatus(taskId, resource.id, InstallStatus.CANCELED, 0);
                return;
              }

              lastError = err;
              attempt++;

              // 若还有机会，退避等待后重试
              if (attempt < totalAttempts) {
                const delay = Math.min(
                  Math.floor(baseDelayMs * Math.pow(backoffFactor, attempt - 0)),
                  maxDelayMs
                );
                logger.warn(`安装资源失败，准备重试(${attempt}/${totalAttempts - 1}): ${resource.name}, wait ${delay}ms`);
                await new Promise(res => setTimeout(res, delay));
                continue;
              }

              // 无更多重试机会，抛出以进入外层catch
              throw err;
            }
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

  /**
   * 尝试为资源包的资源补充本地文件大小（仅当文件已存在时）
   */
  protected augmentPackWithLocalSizes(pack: ResourcePack): ResourcePack {
    try {
      const { config } = require('../../config');
      const modelsRootPath = config.modelsDir || path.join(this.comfyuiPath, 'models');

      const resourcesWithSize = pack.resources.map((r: any) => {
        // 仅对模型资源尝试补充文件大小
        if (r.type === ResourceType.MODEL && r.dir && r.out) {
          try {
            const absPath = path.join(modelsRootPath, r.dir, r.out);
            if (fs.existsSync(absPath)) {
              const stats = fs.statSync(absPath);
              if (typeof stats.size === 'number' && stats.size >= 0) {
                return { ...r, size: stats.size };
              }
            }
          } catch (_) {
            // ignore
          }
        }
        return r;
      });

      return { ...pack, resources: resourcesWithSize } as ResourcePack;
    } catch (_) {
      return pack;
    }
  }

  /**
   * 通过远程HEAD请求尝试为缺失size的模型资源补充文件大小
   */
  protected async augmentPackWithRemoteSizes(pack: ResourcePack): Promise<ResourcePack> {
    const resources = await Promise.all(pack.resources.map(async (r: any) => {
      if (r && r.type === ResourceType.MODEL && (r.size == null || Number.isNaN(r.size))) {
        const url = this.getResourcePrimaryUrl(r);
        if (url) {
          try {
            const contentLength = await this.fetchRemoteContentLength(url);
            if (typeof contentLength === 'number' && contentLength > 0) {
              return { ...r, size: contentLength };
            }
          } catch (_) {
            // 忽略失败
          }
        }
      }
      return r;
    }));

    return { ...pack, resources } as ResourcePack;
  }

  /**
   * 选择模型资源的主要下载URL
   */
  private getResourcePrimaryUrl(resource: any): string | undefined {
    if (!resource) return undefined;
    if (typeof resource.url === 'string') return resource.url;
    if (resource.url && typeof resource.url === 'object') {
      // 默认优先使用 hf
      return resource.url.hf || resource.url.mirror;
    }
    return undefined;
  }

  /**
   * 发送HEAD请求获取远程Content-Length
   */
  private fetchRemoteContentLength(url: string, redirectLimit: number = 3, timeoutMs: number = 5000): Promise<number | undefined> {
    return new Promise((resolve) => {
      try {
        const httpModule = url.startsWith('https:') ? require('https') : require('http');
        const controller: AbortController | undefined = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
        const timer = setTimeout(() => {
          try { controller?.abort(); } catch (_) {}
          resolve(undefined);
        }, timeoutMs);

        // 尝试应用HF_ENDPOINT与下载时一致的端点替换
        let requestUrl = url;
        try {
          const { config } = require('../../config');
          const hfEndpoint = process.env.HF_ENDPOINT || (config?.HF_ENDPOINT);
          if (hfEndpoint && requestUrl.includes('huggingface.co')) {
            requestUrl = requestUrl.replace('huggingface.co/', String(hfEndpoint).replace(/^https?:\/\//, ''));
          }
        } catch (_) {}

        const req = httpModule.request(requestUrl, { method: 'HEAD', signal: controller?.signal }, (res: any) => {
          const status = res.statusCode || 0;
          // 处理重定向
          if ([301, 302, 303, 307, 308].includes(status) && redirectLimit > 0 && res.headers && res.headers.location) {
            const location = res.headers.location as string;
            res.resume();
            clearTimeout(timer);
            this.fetchRemoteContentLength(location, redirectLimit - 1, timeoutMs).then(resolve);
            return;
          }
          const lenHeader = res.headers ? (res.headers['content-length'] as string | undefined) : undefined;
          res.resume();
          clearTimeout(timer);
          if (lenHeader) {
            const n = parseInt(lenHeader, 10);
            resolve(Number.isFinite(n) && n > 0 ? n : undefined);
          } else {
            resolve(undefined);
          }
        });

        req.on('error', () => {
          clearTimeout(timer);
          resolve(undefined);
        });
        req.end();
      } catch (_) {
        resolve(undefined);
      }
    });
  }
}
