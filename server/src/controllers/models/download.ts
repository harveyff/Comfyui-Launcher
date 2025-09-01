import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger';
import { ModelInfo } from './info';

export class ModelDownloadManager {
  private readonly comfyuiPath: string;

  constructor(comfyuiPath: string) {
    this.comfyuiPath = comfyuiPath;
  }

  // 根据模型名称推断模型类型
  inferModelType(modelName: string): string {
    const lowerName = modelName.toLowerCase();
    
    if (lowerName.endsWith('.safetensors') || lowerName.endsWith('.ckpt')) {
      if (lowerName.includes('lora')) return 'lora';
      if (lowerName.includes('inpaint')) return 'inpaint';
      if (lowerName.includes('controlnet')) return 'controlnet';
      return 'checkpoint';
    } else if (lowerName.endsWith('.pth')) {
      if (lowerName.includes('upscale')) return 'upscaler';
      return 'vae';
    } else if (lowerName.endsWith('.pt')) {
      return 'embedding';
    }
    
    return 'checkpoint'; // 默认类型
  }
  
  // 根据模型类型获取保存目录
  getModelSaveDir(modelType: string): string {
    switch (modelType) {
      case 'checkpoint': return 'models/checkpoints';
      case 'lora': return 'models/loras';
      case 'vae': return 'models/vae';
      case 'controlnet': return 'models/controlnet';
      case 'upscaler': return 'models/upscale_models';
      case 'embedding': return 'models/embeddings';
      case 'inpaint': return 'models/inpaint';
      default: return 'models/checkpoints';
    }
  }

  // 构建下载URL - 兼容不同的模型信息结构
  buildDownloadUrl(modelInfo: any, source: string = 'hf'): string {
    let downloadUrl;
    
    if (modelInfo.url) {
      if (typeof modelInfo.url === 'string') {
        // 如果URL是字符串，也需要根据source参数决定使用哪个镜像站
        downloadUrl = modelInfo.url;
        // 如果用户选择使用镜像站而不是HuggingFace
        if (source !== 'hf' && downloadUrl.includes('huggingface.co')) {
          // 将huggingface.co替换为hf-mirror.com
          downloadUrl = downloadUrl.replace('huggingface.co', 'hf-mirror.com');
        }
      } else if (modelInfo.url.hf && modelInfo.url.mirror) {
        // 如果URL是包含hf和mirror的对象，则根据source选择
        downloadUrl = source === 'hf' ? modelInfo.url.hf : modelInfo.url.mirror;
      } else {
        // 其他情况
        downloadUrl = Object.values(modelInfo.url)[0];
      }
    } else if (modelInfo.download_url) {
      // 某些API可能使用download_url字段
      downloadUrl = modelInfo.download_url;
    } else {
      // 如果没有URL信息，使用默认的HuggingFace或镜像站构建URL
      const baseUrl = source === 'hf' ? 'https://huggingface.co/' : 'https://hf-mirror.com/';
      const repo = modelInfo.repo || `models/${modelInfo.name}`;
      const filename = modelInfo.filename || modelInfo.name;
      downloadUrl = `${baseUrl}${repo}/resolve/main/${filename}`;
    }
    
    return downloadUrl;
  }

  // 处理HF_ENDPOINT配置
  processHfEndpoint(downloadUrl: string, hfEndpoint?: string): string {
    if (hfEndpoint && downloadUrl.includes('huggingface.co')) {
      logger.info(`使用配置的HF端点 ${hfEndpoint} 替换 huggingface.co`);
      return downloadUrl.replace('huggingface.co/', hfEndpoint.replace(/^https?:\/\//, ''));
    }
    return downloadUrl;
  }

  // 验证Hugging Face URL
  validateHfUrl(hfUrl: string): { isValid: boolean; fileName: string; error?: string } {
    try {
      const url = new URL(hfUrl);
      
      // 确保是huggingface.co的URL
      if (!url.hostname.includes('huggingface.co') && !url.hostname.includes('hf-mirror.com')) {
        return { 
          isValid: false, 
          fileName: '', 
          error: '只支持Hugging Face网站的模型URL' 
        };
      }
      
      // 从URL中提取路径部分
      const pathParts = url.pathname.split('/');
      
      // 验证URL格式，确保有足够的组成部分
      if (pathParts.length < 5) {
        return { 
          isValid: false, 
          fileName: '', 
          error: '无效的Hugging Face模型URL格式' 
        };
      }
      
      // 获取模型名称（文件名）
      const fileName = pathParts[pathParts.length - 1];
      
      return { isValid: true, fileName };
    } catch (error) {
      return { 
        isValid: false, 
        fileName: '', 
        error: '无效的URL格式' 
      };
    }
  }

  // 构建下载URL（从blob格式转换为resolve格式）
  buildResolveUrl(hfUrl: string): string {
    // 替换/blob/为/resolve/获取实际下载链接
    let downloadUrl = hfUrl.replace('/blob/', '/resolve/');
    
    // 检查是否已经是resolve格式
    if (downloadUrl === hfUrl) {
      logger.info('URL已经是/resolve/格式或不包含/blob/，保持原样');
    }
    
    return downloadUrl;
  }

  // 确保保存目录存在
  async ensureSaveDirectory(saveDir: string): Promise<void> {
    const fullPath = path.join(this.comfyuiPath, saveDir);
    await fs.ensureDir(fullPath);
  }

  // 创建下载历史记录
  createDownloadHistory(fileName: string, savePath: string, downloadUrl: string, taskId: string) {
    const historyId = uuidv4();
    
    return {
      id: historyId,
      modelName: fileName,
      status: 'downloading' as 'downloading',
      startTime: Date.now(),
      source: 'custom',
      savePath: savePath,
      downloadUrl: downloadUrl,
      taskId: taskId
    };
  }

  // 异步下载处理方法
  async downloadModelAsync(
    url: string, 
    outputPath: string, 
    taskId: string, 
    modelName: string,
    progress: any,
    updateTaskProgress: (taskId: string, progress: any) => void,
    updateDownloadHistory?: (id: string, updates: any) => void,
    downloadHistory?: any[]
  ): Promise<void> {
    try {
      // 设置初始状态
      progress.status = 'downloading';
      progress.currentModel = { name: modelName } as any;
      
      // 导入下载工具函数
      const { downloadFile } = require('../../utils/download.utils');
      
      // 使用工具函数执行下载
      await downloadFile(
        url,
        outputPath,
        (percent: number, downloaded: number, total: number) => {
          // 更新进度信息
          progress.currentModelProgress = percent / 100;
          progress.overallProgress = percent / 100;
          progress.downloadedBytes = downloaded;
          progress.totalBytes = total;
          
          // 更新任务进度
          updateTaskProgress(taskId, progress);
          
          // 允许继续下载
          return true;
        },
        { 
          abortController: progress.abortController || new AbortController(),
          onProgress: () => {} // 必需属性
        },
        progress
      );
      
      // 下载完成后更新状态
      progress.completed = true;
      progress.status = 'completed';
      progress.overallProgress = 1;
      progress.currentModelProgress = 1;
      updateTaskProgress(taskId, progress);
      
      logger.info(`自定义模型下载完成: ${outputPath}`);
      
      // 更新历史记录(如果存在方法)
      if (updateDownloadHistory && downloadHistory) {
        // 查找相关的历史记录
        const historyItem = downloadHistory.find((item: any) => item.taskId === taskId);
        if (historyItem) {
          updateDownloadHistory(historyItem.id, {
            status: 'success',
            endTime: Date.now(),
            fileSize: progress.totalBytes,
            downloadedSize: progress.downloadedBytes,
            speed: progress.speed
          });
        }
      }
    } catch (error) {
      // 获取进度对象
      if (progress) {
        // 如果是取消导致的错误
        if (progress.canceled || (error instanceof Error && error.message.includes('取消'))) {
          progress.status = 'error';
          progress.error = '下载已取消';
          logger.info(`自定义模型 ${modelName} 下载已取消`);
        } else {
          // 其他错误
          progress.status = 'error';
          progress.error = error instanceof Error ? error.message : String(error);
          logger.error(`自定义模型 ${modelName} 下载失败: ${progress.error}`);
        }
        
        updateTaskProgress(taskId, progress);
        
        // 更新历史记录(如果存在方法)
        if (updateDownloadHistory && downloadHistory) {
          // 查找相关的历史记录
          const historyItem = downloadHistory.find((item: any) => item.taskId === taskId);
          if (historyItem) {
            updateDownloadHistory(historyItem.id, {
              status: progress.canceled ? 'canceled' : 'failed',
              endTime: Date.now(),
              error: progress.error,
              downloadedSize: progress.downloadedBytes,
              fileSize: progress.totalBytes,
              speed: progress.speed
            });
          }
        }
      }
      
      throw error;
    }
  }
} 