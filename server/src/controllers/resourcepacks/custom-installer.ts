/**
 * 自定义资源安装器
 * 负责处理自定义资源的下载和安装
 */
import * as path from 'path';
import * as fs from 'fs';
import { CustomResource, InstallStatus, CustomDownloadOptions } from '../../types/resource-packs.types';
import { logger } from '../../utils/logger';
import { downloadFile } from '../../utils/download.utils';

export class CustomInstaller {
  private comfyuiPath: string;

  constructor(comfyuiPath: string) {
    this.comfyuiPath = comfyuiPath;
  }

  /**
   * 安装自定义资源
   */
  public async installCustomResource(
    resource: CustomResource,
    taskId: string,
    onProgress: (status: InstallStatus, progress: number, error?: string) => void
  ): Promise<void> {
    try {
      onProgress(InstallStatus.DOWNLOADING, 0);

      // 处理目标路径
      const destinationPath = resource.destination;

      // 确定输出目录和文件名
      let outputDir: string;
      let outputFilename: string;

      if (path.isAbsolute(destinationPath)) {
        // 如果是绝对路径，直接使用
        outputDir = path.dirname(destinationPath);
        outputFilename = path.basename(destinationPath);
      } else {
        // 如果是相对路径，相对于ComfyUI目录
        outputDir = path.dirname(path.join(this.comfyuiPath, destinationPath));
        outputFilename = path.basename(destinationPath);
      }

      // 确保输出目录存在
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
        logger.info(`创建自定义资源目录: ${outputDir}`);
      }

      // 完整的输出路径
      const outputPath = path.join(outputDir, outputFilename);

      // 检查文件是否已存在
      if (fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath);
        if (stats.size > 0) {
          logger.info(`自定义资源文件已存在，跳过下载: ${outputPath}`);
          onProgress(InstallStatus.SKIPPED, 100);
          return;
        } else {
          // 如果文件存在但大小为0，删除它
          logger.info(`发现空文件，将重新下载: ${outputPath}`);
          fs.unlinkSync(outputPath);
        }
      }

      logger.info(`开始下载自定义资源 ${resource.name} 从 ${resource.url} 到 ${outputPath}`);

      // 创建下载进度处理函数
      const onDownloadProgress = (downloadedBytes: number, totalBytes: number) => {
        const percent = totalBytes > 0 ? Math.floor((downloadedBytes / totalBytes) * 100) : 0;
        onProgress(InstallStatus.DOWNLOADING, percent);

        // 记录进度
        if (percent % 20 === 0) { // 每20%记录一次
          const downloadedMB = (downloadedBytes / (1024 * 1024)).toFixed(2);
          const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
          logger.info(`自定义资源 ${resource.name} 下载进度: ${percent}% (${downloadedMB}MB/${totalMB}MB)`);
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

      // 使用适配后的进度回调
      const result = await downloadFile(
        resource.url,
        outputPath,
        progressAdapter,
        downloadOptions as any
      );

      // 检查下载结果
      if (!result) {
        // 下载被取消，处理这种情况但不抛出错误
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
          logger.info(`自定义资源 ${resource.name} 下载完成，文件大小: ${(stats.size / (1024 * 1024)).toFixed(2)}MB`);
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
        logger.info(`自定义资源 ${resource.name} 下载已取消`);
      } else {
        // 其他错误
        onProgress(InstallStatus.ERROR, 0, errorMsg);
        logger.error(`自定义资源 ${resource.name} 下载失败: ${errorMsg}`);
      }

      // 删除不完整的文件
      const destinationPath = resource.destination;
      let outputPath: string;

      if (path.isAbsolute(destinationPath)) {
        outputPath = destinationPath;
      } else {
        outputPath = path.join(this.comfyuiPath, destinationPath);
      }

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
