import fs from 'fs-extra';
import path from 'path';
import https from 'https';
import { logger } from '../../utils/logger';
import { config } from '../../config';
import { EssentialModel } from '../../types/models.types';

// 模型信息接口
export interface ModelInfo {
  name: string;
  type: string;
  base_url: string;
  save_path: string;
  description?: string;
  reference?: string;
  filename?: string;
  sha256?: string;
  installed?: boolean;
  url?: string;
  fileStatus?: 'complete' | 'incomplete' | 'corrupted' | 'unknown';
  fileSize?: number;
  size?: string;
}

// 定义接口来匹配远程API的响应结构
interface ModelListResponse {
  models: ModelInfo[];
}

export class ModelInfoManager {
  private modelCache: ModelInfo[] = [];
  private cacheTimestamp: number = 0;
  private readonly CACHE_DURATION = 24 * 60 * 60 * 1000; // 1天的缓存时间
  private readonly MODEL_LIST_URL = 'https://raw.githubusercontent.com/ltdrdata/ComfyUI-Manager/main/model-list.json';
  private readonly LOCAL_CACHE_PATH = path.join(config.dataDir, 'model-cache.json');
  private readonly LOCAL_DEFAULT_LIST_PATH = path.join(__dirname, '../model-list.json');
  private readonly comfyuiPath: string;

  constructor(comfyuiPath: string) {
    this.comfyuiPath = comfyuiPath;
  }

  // 获取模型列表
  async getModelList(mode: 'cache' | 'local' | 'remote' = 'cache'): Promise<ModelInfo[]> {
    try {
      // 合并常规模型和基础模型列表
      const regularModels = await this.getRegularModelList(mode);
      return regularModels;
    } catch (error) {
      logger.error(`获取模型列表出错: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  // 获取常规模型列表
  private async getRegularModelList(mode: 'cache' | 'local' | 'remote' = 'cache'): Promise<ModelInfo[]> {
    try {
      // 优先使用内存缓存(当mode为cache时)
      if (mode === 'cache' && this.modelCache && this.cacheTimestamp && 
          Date.now() - this.cacheTimestamp < this.CACHE_DURATION) {
        logger.info('使用缓存的模型列表');
        return this.modelCache;
      }

      // 如果请求远程数据，直接获取
      if (mode === 'remote') {
        return await this.getRemoteModels();
      }

      // 如果请求本地数据，尝试读取本地缓存
      if (mode === 'local') {
        return await this.getLocalModels();
      }

      // 默认情况下按顺序尝试：缓存文件 -> 远程API -> 本地默认列表
      // 尝试读取本地缓存文件
      try {
        if (await fs.pathExists(this.LOCAL_CACHE_PATH)) {
          const cacheData = await fs.readFile(this.LOCAL_CACHE_PATH, 'utf8');
          const cacheJson = JSON.parse(cacheData);
          
          if (cacheJson.models && Array.isArray(cacheJson.models) && 
              cacheJson.timestamp && 
              Date.now() - cacheJson.timestamp < this.CACHE_DURATION) {
            logger.info('使用本地缓存文件的模型列表');
            this.modelCache = cacheJson.models;
            this.cacheTimestamp = cacheJson.timestamp;
            return this.modelCache;
          }
        }
      } catch (cacheError) {
        logger.warn(`读取本地缓存文件失败: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`);
      }
      
      // 尝试从远程API获取
      try {
        logger.info('从远程API获取模型列表...');
        const models = await this.getRemoteModels();
        
        // 更新缓存
        this.modelCache = models;
        this.cacheTimestamp = Date.now();
        
        // 保存到本地缓存
        this.ensureCacheDirectory();
        await fs.writeFile(this.LOCAL_CACHE_PATH, JSON.stringify({
          models,
          timestamp: this.cacheTimestamp
        }));
        
        logger.info(`成功从API获取到 ${models.length} 个模型`);
        return models;
      } catch (apiError) {
        logger.error(`从API获取模型列表失败: ${apiError instanceof Error ? apiError.message : String(apiError)}`);
        
        // 使用本地默认模型列表
        try {
          logger.info('使用本地默认模型列表...');
          if (await fs.pathExists(this.LOCAL_DEFAULT_LIST_PATH)) {
            const defaultData = await fs.readFile(this.LOCAL_DEFAULT_LIST_PATH, 'utf8');
            const defaultJson = JSON.parse(defaultData);
            
            if (defaultJson.models && Array.isArray(defaultJson.models)) {
              logger.info(`从本地默认列表加载了 ${defaultJson.models.length} 个模型`);
              return defaultJson.models;
            }
          }
        } catch (defaultError) {
          logger.error(`读取本地默认模型列表失败: ${defaultError instanceof Error ? defaultError.message : String(defaultError)}`);
        }
      }
      
      // 所有方法都失败，返回空列表
      logger.warn('无法获取模型列表，返回空列表');
      return [];
    } catch (error) {
      logger.error(`获取常规模型列表出错: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  // 获取本地模型列表（不依赖网络）
  private getLocalModels(): ModelInfo[] {
    try {
      // 这里可以添加一个预先打包的模型列表作为备用
      const localModelListPath = path.join(__dirname, '../../data/default-model-list.json');
      if (fs.existsSync(localModelListPath)) {
        const models = JSON.parse(fs.readFileSync(localModelListPath, 'utf-8'));
        return models;
      }
    } catch (error) {
      console.error('Error loading local model list:', error);
    }
    return [];
  }

  // 从远程获取最新模型列表
  private async getRemoteModels(): Promise<ModelInfo[]> {
    try {
      return new Promise((resolve, reject) => {
        https.get(this.MODEL_LIST_URL, (res) => {
          let data = '';
          
          res.on('data', (chunk) => {
            data += chunk;
          });
          
          res.on('end', () => {
            try {
              // 解析响应数据并获取models数组
              const parsedData = JSON.parse(data) as ModelListResponse;
              const models = parsedData.models || [];
              
              // 更新缓存
              this.modelCache = models;
              this.cacheTimestamp = Date.now();
              
              // 保存到本地缓存
              fs.writeFileSync(this.LOCAL_CACHE_PATH, JSON.stringify({
                models,
                timestamp: this.cacheTimestamp
              }));
              
              resolve(models);
            } catch (error) {
              console.error('解析模型数据失败:', error);
              resolve([]); 
            }
          });
        }).on('error', (error) => {
          console.error('获取远程模型列表失败:', error);
          resolve([]);
        });
      });
    } catch (error) {
      console.error('获取远程模型列表发生错误:', error);
      return [];
    }
  }

  // 将基础模型转换为ModelInfo格式
  convertEssentialModelsToModelInfo(essentialModels: EssentialModel[]): ModelInfo[] {
    try {
      return essentialModels.map(model => {
        // 创建路径字符串
        const savePath = `models/${model.dir}/${model.out}`;
        
        // 检查模型是否已安装
        const fullPath = path.join(this.comfyuiPath, savePath);
        const isInstalled = fs.existsSync(fullPath);
        let fileSize = 0;
        let fileStatus: 'complete' | 'incomplete' | 'corrupted' | 'unknown' = 'unknown';
        
        if (isInstalled) {
          try {
            const stat = fs.statSync(fullPath);
            fileSize = stat.size;
            fileStatus = fileSize > 0 ? 'complete' : 'incomplete';
          } catch (error) {
            logger.error(`检查基础模型文件 ${fullPath} 时出错: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        
        // 创建与ModelInfo接口兼容的对象
        return {
          name: model.name,
          type: model.type,
          base_url: '',
          save_path: savePath,
          description: model.description,
          filename: model.out,
          installed: isInstalled && fileSize > 0,
          essential: true,
          fileStatus: fileStatus,
          fileSize: fileSize,
          url: model.url.mirror || model.url.hf
        } as unknown as ModelInfo;
      });
    } catch (error) {
      logger.error(`转换基础模型列表出错: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  // 确保缓存目录存在
  private ensureCacheDirectory() {
    const dir = path.dirname(this.LOCAL_CACHE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // 获取模型信息
  async getModelInfo(modelName: string): Promise<ModelInfo | undefined> {
    const models = await this.getModelList();
    return models.find(model => model.name === modelName);
  }

  // 更新模型缓存
  updateModelCache(models: ModelInfo[]) {
    this.modelCache = models;
    this.cacheTimestamp = Date.now();
  }

  // 获取缓存时间戳
  getCacheTimestamp(): number {
    return this.cacheTimestamp;
  }
}
