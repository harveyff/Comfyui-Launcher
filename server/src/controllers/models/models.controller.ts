import { Context } from 'koa';
import fs from 'fs-extra';
import path from 'path';
import { logger } from '../../utils/logger';
import { DownloadController } from '../download.controller';
import { EssentialModel } from '../../types/models.types';
import { essentialModels } from '../essential-models.controller';
import { SystemController } from '../system/system.controller';
import { ModelInfoManager } from './info';
import { ModelInstallManager } from './install';
import { ModelDownloadManager } from './download';

// 下载任务接口
interface DownloadTask {
  overallProgress: number;
  currentModelIndex: number;
  currentModelProgress: number;
  currentModel: EssentialModel | null;
  completed: boolean;
  error: string | null;
  canceled: boolean;
  temporaryCanceled?: boolean;
  totalBytes: number;
  downloadedBytes: number;
  speed: number;
  startTime?: number;
  lastUpdateTime?: number;
  lastBytes?: number;
  lastLogTime?: number;
  status: 'downloading' | 'completed' | 'error';
  startBytes?: number;
}

export const isDev = process.env.NODE_ENV !== 'production';

// 记录下载任务状态
const downloadTasks = new Map<string, DownloadTask>();

// 添加响应类型接口
interface ProgressResponse {
  overallProgress: number;
  currentModelIndex: number;
  currentModelProgress: number;
  currentModel: EssentialModel | null;
  completed: boolean;
  error: string | null;
  totalBytes: number;
  downloadedBytes: number;
  speed: number;
  status: string;
}

export class ModelsController extends DownloadController {
  private modelInfoManager: ModelInfoManager;
  private modelInstallManager: ModelInstallManager;
  private modelDownloadManager: ModelDownloadManager;
  private comfyuiPath: string;
  private modelsDir: string;
  private systemController: SystemController;
  
  // 增加全局计数器跟踪进度事件
  private progressEventCounter = 0;
  
  constructor() {
    super(); // 调用父类构造函数
    
    // 初始化系统控制器
    this.systemController = new SystemController();
    
    // 初始化路径
    this.comfyuiPath = process.env.COMFYUI_PATH || 
      (isDev ? path.join(process.cwd(), 'comfyui') : '/root/ComfyUI');
    this.modelsDir = path.join(this.comfyuiPath, 'models');
    
    // 初始化各个管理器
    this.modelInfoManager = new ModelInfoManager(this.comfyuiPath);
    this.modelInstallManager = new ModelInstallManager(this.comfyuiPath);
    this.modelDownloadManager = new ModelDownloadManager(this.comfyuiPath);
    
    // 确保模型目录存在
    fs.ensureDirSync(this.modelsDir);

    // 启动时自动进行一次模型扫描
    this.initScan();
  }

  /**
   * 获取Hugging Face端点配置
   * 从系统控制器获取
   */
  private getHuggingFaceEndpoint(): string | undefined {
    // 优先使用环境变量
    if (process.env.HF_ENDPOINT) {
      return process.env.HF_ENDPOINT;
    }
    
    // 尝试从系统控制器的配置中获取
    if (this.systemController) {
      const envConfig = this.systemController.getEnvironmentConfig();
      return envConfig.HF_ENDPOINT;
    }
    
    return undefined;
  }

  // 初始化扫描方法
  private async initScan() {
    try {
      logger.info('应用启动，开始初始扫描已安装模型...');
      
      // 延迟几秒后执行，以免影响应用启动速度
      setTimeout(async () => {
        // 刷新模型安装状态
        const updatedModels = await this.refreshInstalledStatus();
        
        // 更新本地缓存
        this.modelInfoManager.updateModelCache(updatedModels);
        
        logger.info(`初始扫描完成，找到 ${updatedModels.filter(m => m.installed).length} 个已安装模型`);
      }, 5000); // 延迟5秒执行，以免影响应用启动
    } catch (error) {
      logger.error(`初始模型扫描失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 获取模型列表
  async getModelList(mode: 'cache' | 'local' | 'remote' = 'cache') {
    try {
      // 合并常规模型和基础模型列表
      const regularModels = await this.modelInfoManager.getModelList(mode);
      const essentialModelsList = this.modelInfoManager.convertEssentialModelsToModelInfo(essentialModels);
      
      // 使用Map进行去重，基础模型优先
      const modelMap = new Map<string, any>();
      
      // 先添加常规模型
      regularModels.forEach(model => {
        const key = model.filename || model.name || model.save_path;
        if (key) {
          modelMap.set(key, model);
        }
      });
      
      // 再添加基础模型（会覆盖同名的常规模型）
      essentialModelsList.forEach(model => {
        const key = model.filename || model.name || model.save_path;
        if (key) {
          modelMap.set(key, model);
        }
      });
      
      // 返回去重后的列表
      return Array.from(modelMap.values());
    } catch (error) {
      logger.error(`获取模型列表出错: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  // 添加一个新的API端点来处理模型名称下载请求
  async installModel(ctx: Context): Promise<void> {
    const { modelName } = ctx.params;
    const { source = 'hf' } = ctx.request.body as { source?: string };
    
    logger.info(`请求安装模型(通过API): ${modelName}`);
    
    if (!modelName) {
      ctx.status = 400;
      ctx.body = { 
        success: false,
        message: '模型名称不能为空' 
      };
      return;
    }
    
    try {
      // 1. 获取模型信息
      const modelInfo = await this.modelInfoManager.getModelInfo(modelName);
      if (!modelInfo) {
        throw new Error(`未找到模型 ${modelName} 的信息`);
      }
      
      // 2. 创建任务ID
      const taskId = this.createDownloadTask();
      
      // 3. 保存模型名称到任务ID的映射
      this.modelDownloads.set(modelName, taskId);
      
      // 4. 确定模型类型和保存路径
      const modelType = this.modelInstallManager.inferModelType(modelName);
      const modelDir = this.modelInstallManager.getModelSaveDir(modelType);
      const outputPath = path.join(this.comfyuiPath, modelDir, modelName);
      
      // 5. 构建下载URL
      let downloadUrl = this.modelDownloadManager.buildDownloadUrl(modelInfo, source);
      
      // 6. 检查HF_ENDPOINT配置，如果有则替换huggingface.co
      const hfEndpoint = this.getHuggingFaceEndpoint();
      downloadUrl = this.modelDownloadManager.processHfEndpoint(downloadUrl, hfEndpoint);
      
      logger.info(`即将从 ${downloadUrl} 下载模型到 ${outputPath}`);
      
      // 7. 异步启动下载过程
      this.downloadModelByName(modelName, downloadUrl, outputPath, taskId, source).catch(err => {
        logger.error(`下载模型 ${modelName} 失败: ${err instanceof Error ? err.message : String(err)}`);
      });
      
      // 8. 立即返回成功响应，让前端开始轮询
      ctx.body = {
        success: true,
        taskId: taskId,
        message: `开始下载模型 ${modelName}`
      };
    } catch (error) {
      ctx.status = 500;
      ctx.body = {
        success: false,
        message: `启动下载失败: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  // 获取下载进度
  getDownloadProgress(modelName: string): any {
    return this.modelDownloads.get(modelName) ? null : null;
  }

  // 重命名方法以避免与基类冲突
  async cancelModelDownload(modelName: string): Promise<void> {
    const taskId = this.modelDownloads.get(modelName);
    if (!taskId) {
      return;
    }
    
    // 调用基类的取消方法
    await this.cancelDownloadById(taskId);
    
    logger.info(`模型 ${modelName} 下载已取消，保留部分下载文件以支持断点续传`);
  }
  
  // 为路由处理添加符合基类签名的方法
  async cancelDownload(ctx: Context): Promise<void> {
    const { modelName } = ctx.request.body as { modelName?: string };
    
    if (!modelName) {
      ctx.status = 400;
      ctx.body = { error: '缺少模型名称' };
      return;
    }
    
    await this.cancelModelDownload(modelName);
    ctx.body = { success: true };
  }
  
  // 修改访问修饰符，与基类保持一致
  protected async cancelDownloadById(taskId: string): Promise<void> {
    if (!this.taskProgress.has(taskId)) {
      return;
    }
    
    const progress = this.taskProgress.get(taskId)!;
    progress.status = 'error';
    progress.error = '下载已取消';
    progress.canceled = true;
    
    if (progress.abortController) {
      progress.abortController.abort();
    }
    
    this.updateTaskProgress(taskId, progress);
  }

  // 在路由处理中添加获取下载进度的端点
  async getModelProgress(ctx: Context): Promise<void> {
    // 从查询参数获取语言设置
    const locale = ctx.query.lang as string || this.getClientLocale(ctx) || 'zh';
    
    // 注入语言参数到ctx中
    ctx.state.locale = locale;
    
    // 调用父类的 getProgress 方法
    await this.getProgress(ctx);
  }

  // 获取所有模型
  async getAllModels(ctx: Context): Promise<void> {
    // 实现获取所有模型的逻辑
    // 如果 getModels 方法有额外逻辑，应合并到这里
    ctx.body = {
      available: [
        { id: 'sd_1.5', name: 'SD 1.5 基础模型', size: '4.2 GB', downloaded: false },
        { id: 'sd_2.1', name: 'SD 2.1 基础模型', size: '5.3 GB', downloaded: false },
        { id: 'sdxl', name: 'SDXL 基础模型', size: '6.8 GB', downloaded: false },
        { id: 'controlnet', name: 'ControlNet', size: '3.5 GB', downloaded: true },
        { id: 'lora', name: 'LoRA 模型集合', size: '2.1 GB', downloaded: false }
      ],
      downloaded: [
        { id: 'controlnet', name: 'ControlNet', size: '3.5 GB', path: '/models/controlnet' }
      ]
    };
  }

  // 删除模型
  public async deleteModel(ctx: Context) {
    const { modelName } = ctx.request.body as { modelName?: string };
    
    if (!modelName) {
      ctx.status = 400;
      ctx.body = { error: '缺少模型名称' };
      return;
    }
    
    try {
      // 获取模型列表
      const models = await this.getModelList();
      
      // 使用安装管理器删除模型
      const result = await this.modelInstallManager.deleteModel(modelName, models);
      
      if (result.success) {
        // 更新模型缓存状态
        const updatedModels = await this.refreshInstalledStatus();
        this.modelInfoManager.updateModelCache(updatedModels);
        
        ctx.body = { 
          success: true,
          message: result.message
        };
      } else {
        ctx.status = 400;
        ctx.body = { 
          success: false,
          error: result.message
        };
      }
    } catch (error) {
      logger.error(`Delete model error: ${error instanceof Error ? error.message : String(error)}`);
      ctx.status = 500;
      ctx.body = { 
        error: `删除模型时出错: ${error instanceof Error ? error.message : String(error)}` 
      };
    }
  }

  // 添加此方法作为 getModelList 的别名
  public async getModels(ctx: Context): Promise<void> {
    const models = await this.getModelList();
    ctx.body = models;
  }

  // 刷新模型列表的安装状态并检查完整性
  public async refreshInstalledStatus() {
    try {
      // 先获取模型列表
      const models = await this.getModelList();
      
      // 使用安装管理器刷新状态
      const updatedModels = await this.modelInstallManager.refreshInstalledStatus(models);
      
      return updatedModels;
    } catch (error) {
      logger.error(`刷新模型安装状态时出错: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  // API路由处理程序：扫描并更新模型安装状态
  public async scanModels(ctx: Context): Promise<void> {
    try {
      logger.info('开始扫描已安装模型...');
      
      // 刷新模型安装状态
      const updatedModels = await this.refreshInstalledStatus();
      
      // 更新本地缓存
      this.modelInfoManager.updateModelCache(updatedModels);
      
      ctx.body = {
        success: true,
        count: updatedModels.filter(m => m.installed).length,
        models: updatedModels
      };
    } catch (error) {
      logger.error(`扫描模型失败: ${error instanceof Error ? error.message : String(error)}`);
      ctx.status = 500;
      ctx.body = {
        success: false,
        message: `扫描模型失败: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  // 添加自定义模型下载方法
  async downloadCustomModel(ctx: Context): Promise<void> {
    const { hfUrl, modelDir } = ctx.request.body as { hfUrl?: string; modelDir?: string };
    
    logger.info(`请求下载自定义模型: ${hfUrl} 到目录: ${modelDir}`);
    
    if (!hfUrl) {
      ctx.status = 400;
      ctx.body = { 
        success: false,
        message: 'Hugging Face URL不能为空' 
      };
      return;
    }
    
    if (!modelDir) {
      ctx.status = 400;
      ctx.body = { 
        success: false,
        message: '模型存放目录不能为空' 
      };
      return;
    }
    
    try {
      // 验证URL
      const validation = this.modelDownloadManager.validateHfUrl(hfUrl);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }
      
      const fileName = validation.fileName;
      
      // 构建下载URL
      let downloadUrl = this.modelDownloadManager.buildResolveUrl(hfUrl);
      
      // 检查HF_ENDPOINT配置
      const hfEndpoint = this.getHuggingFaceEndpoint();
      downloadUrl = this.modelDownloadManager.processHfEndpoint(downloadUrl, hfEndpoint);
      
      // 创建任务ID
      const taskId = this.createDownloadTask();
      
      // 确定保存路径
      const saveDir = `models/${modelDir}`;
      const outputPath = path.join(this.comfyuiPath, saveDir, fileName);
      
      // 确保目录存在
      await this.modelDownloadManager.ensureSaveDirectory(saveDir);
      
      logger.info(`即将从 ${downloadUrl} 下载模型到 ${outputPath}`);
      
      // 创建历史记录
      const historyItem = this.modelDownloadManager.createDownloadHistory(
        fileName, outputPath, downloadUrl, taskId
      );
      
      // 如果父类有添加历史记录的方法，使用它
      if (typeof this.addDownloadHistory === 'function') {
        this.addDownloadHistory(historyItem);
      }
      
      // 获取进度对象
      const progress = this.taskProgress.get(taskId);
      if (progress) {
        progress.abortController = new AbortController();
      }
      
      // 启动异步下载过程
      this.modelDownloadManager.downloadModelAsync(
        downloadUrl, 
        outputPath, 
        taskId, 
        fileName,
        progress,
        this.updateTaskProgress.bind(this),
        typeof this.updateDownloadHistory === 'function' ? this.updateDownloadHistory.bind(this) : undefined,
        this.downloadHistory
      ).catch(err => {
        logger.error(`下载自定义模型失败: ${err instanceof Error ? err.message : String(err)}`);
      });
      
      // 返回成功响应和任务ID
      ctx.body = {
        success: true,
        taskId: taskId,
        message: `开始下载模型 ${fileName} 到 ${saveDir}`
      };
    } catch (error) {
      ctx.status = 500;
      ctx.body = {
        success: false,
        message: `启动下载失败: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
} 