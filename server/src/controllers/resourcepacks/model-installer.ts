/**
 * 模型资源安装器
 * 负责处理模型资源的下载和安装
 */
import * as path from 'path';
import * as fs from 'fs';
import { ModelResource, InstallStatus, CustomDownloadOptions } from '../../types/resource-packs.types';
import { EssentialModel } from '../../types/models.types';
import { logger } from '../../utils/logger';
import { downloadFile } from '../../utils/download.utils';
import { SystemController } from '../system/system.controller';

export class ModelInstaller {
  private comfyuiPath: string;
  private systemController: SystemController;

  constructor(comfyuiPath: string) {
    this.comfyuiPath = comfyuiPath;
    this.systemController = new SystemController();
  }

  /**
   * 安装模型资源
   */
  public async installModelResource(
    resource: ModelResource, 
    taskId: string, 
    source: string,
    onProgress: (status: InstallStatus, progress: number, error?: string) => void
  ): Promise<void> {
    try {
      onProgress(InstallStatus.DOWNLOADING, 0);

      // 获取模型目录
      const { config } = require('../../config');
      const modelsRootPath = config.modelsDir || path.join(this.comfyuiPath, 'models');

      // 确保模型目录存在
      const modelDirPath = path.join(modelsRootPath, resource.dir);
      if (!fs.existsSync(modelDirPath)) {
        logger.info(`创建模型目录: ${modelDirPath}`);
        fs.mkdirSync(modelDirPath, { recursive: true });
      }

      // 目标文件路径
      const outputPath = path.join(modelDirPath, resource.out);

      // 检查文件是否已存在
      if (fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath);
        if (stats.size > 0) {
          logger.info(`模型文件已存在，跳过下载: ${outputPath}`);
          onProgress(InstallStatus.SKIPPED, 100);
          return;
        } else {
          // 如果文件存在但大小为0，删除它
          logger.info(`发现空文件，将重新下载: ${outputPath}`);
          fs.unlinkSync(outputPath);
        }
      }

      // 获取下载URL
      const downloadUrl = this.getDownloadUrl(resource, source);
      logger.info(`开始下载模型 ${resource.name} 从 ${downloadUrl} 到 ${outputPath}`);

      // 创建下载进度处理函数
      const onDownloadProgress = (downloadedBytes: number, totalBytes: number) => {
        const percent = totalBytes > 0 ? Math.floor((downloadedBytes / totalBytes) * 100) : 0;
        onProgress(InstallStatus.DOWNLOADING, percent);

        // 记录进度
        if (percent % 10 === 0) {
          const downloadedMB = (downloadedBytes / (1024 * 1024)).toFixed(2);
          const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
          logger.info(`模型 ${resource.name} 下载进度: ${percent}% (${downloadedMB}MB/${totalMB}MB)`);
        }

        return true;
      };

      // 配置下载选项
      const abortController = new AbortController();
      const progressAdapter = this.createProgressAdapter(onDownloadProgress);

      const downloadOptions: CustomDownloadOptions = {
        abortController,
        onProgress: progressAdapter
      };

      // 使用 downloadFile 工具进行下载
      const result = await downloadFile(
        downloadUrl,
        outputPath,
        progressAdapter,
        downloadOptions as any
      );

      // 检查下载结果
      if (!result) {
        logger.info(`下载已被用户取消: ${taskId}`);
        onProgress(InstallStatus.CANCELED, 0);
        return;
      }

      // 处理可能存在的.download后缀
      const finalPath = this.handleDownloadExtension(outputPath);

      // 下载完成后检查文件
      if (fs.existsSync(finalPath)) {
        const stats = fs.statSync(finalPath);
        if (stats.size > 0) {
          logger.info(`模型 ${resource.name} 下载完成，文件大小: ${(stats.size / (1024 * 1024)).toFixed(2)}MB`);
          onProgress(InstallStatus.COMPLETED, 100);
        } else {
          // 文件大小为0，可能下载失败
          fs.unlinkSync(finalPath);
          throw new Error(`下载的文件大小为0，可能下载失败: ${finalPath}`);
        }
      } else {
        throw new Error(`下载后未找到文件: ${finalPath}`);
      }

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      // 如果是用户取消，设置状态为已取消
      if (errorMsg.includes('下载已取消') || errorMsg.includes('aborted')) {
        onProgress(InstallStatus.CANCELED, 0);
        logger.info(`模型 ${resource.name} 下载已取消`);
      } else {
        // 其他错误
        onProgress(InstallStatus.ERROR, 0, errorMsg);
        logger.error(`模型 ${resource.name} 下载失败: ${errorMsg}`);
      }

      // 删除不完整的文件
      const { config } = require('../../config');
      const modelsRootPath = config.modelsDir || path.join(this.comfyuiPath, 'models');
      const outputPath = path.join(modelsRootPath, resource.dir, resource.out);
      
      if (fs.existsSync(outputPath)) {
        try {
          fs.unlinkSync(outputPath);
          logger.info(`已删除不完整的下载文件: ${outputPath}`);
        } catch (unlinkError) {
          logger.error(`无法删除不完整的下载文件: ${outputPath}, 错误: ${unlinkError instanceof Error ? unlinkError.message : String(unlinkError)}`);
        }
      }

      throw error;
    }
  }

  /**
   * 获取下载URL
   */
  private getDownloadUrl(resource: ModelResource, source: string): string {
    let downloadUrl: string;
    
    if (typeof resource.url === 'string') {
      downloadUrl = resource.url;
    } else {
      // 根据source参数选择下载源
      downloadUrl = source === 'mirror' ? resource.url.mirror : resource.url.hf;
    }

    // 从系统控制器获取HF端点配置
    const hfEndpoint = this.getHuggingFaceEndpoint();
    
    if (hfEndpoint && downloadUrl.includes('huggingface.co')) {
      logger.info(`使用配置的HF端点 ${hfEndpoint} 替换 huggingface.co`);
      downloadUrl = downloadUrl.replace('huggingface.co/', hfEndpoint.replace(/^https?:\/\//, ''));
    }

    return downloadUrl;
  }

  /**
   * 获取Hugging Face端点配置
   */
  private getHuggingFaceEndpoint(): string | undefined {
    // 优先使用环境变量
    if (process.env.HF_ENDPOINT) {
      return process.env.HF_ENDPOINT;
    }
    
    // 尝试从系统控制器的配置中获取
    if (this.systemController) {
      const envConfig = this.systemController.getEnvironmentConfig();
      if (envConfig && envConfig.HF_ENDPOINT) {
        return envConfig.HF_ENDPOINT;
      }
    }
    
    return undefined;
  }

  /**
   * 修复 downloadFile 函数中类型错误的适配器
   */
  private createProgressAdapter(callback: (downloaded: number, total: number) => void): (progress: number, downloadedBytes: number, totalBytes: number) => void {
    return (progress: number, downloadedBytes: number, totalBytes: number) => {
      callback(downloadedBytes, totalBytes);
    };
  }

  /**
   * 检查并处理下载文件的后缀
   */
  private handleDownloadExtension(filePath: string): string {
    const downloadExt = '.download';
    
    // 检查是否存在带.download后缀的文件
    if (!fs.existsSync(filePath) && fs.existsSync(`${filePath}${downloadExt}`)) {
      try {
        // 重命名文件，移除.download后缀
        fs.renameSync(`${filePath}${downloadExt}`, filePath);
        logger.info(`已将文件 ${filePath}${downloadExt} 重命名为 ${filePath}`);
      } catch (error) {
        logger.error(`重命名文件失败: ${error instanceof Error ? error.message : String(error)}`);
        // 如果重命名失败，返回带后缀的文件路径
        return `${filePath}${downloadExt}`;
      }
    }
    
    return filePath;
  }
}
