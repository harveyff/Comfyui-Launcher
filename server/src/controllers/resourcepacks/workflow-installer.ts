/**
 * 工作流资源安装器
 * 负责处理工作流资源的下载和安装
 */
import * as path from 'path';
import * as fs from 'fs';
import { WorkflowResource, InstallStatus, CustomDownloadOptions } from '../../types/resource-packs.types';
import { logger } from '../../utils/logger';
import { downloadFile } from '../../utils/download.utils';

export class WorkflowInstaller {
  private comfyuiPath: string;

  constructor(comfyuiPath: string) {
    this.comfyuiPath = comfyuiPath;
  }

  /**
   * 安装工作流资源
   */
  public async installWorkflowResource(
    resource: WorkflowResource,
    taskId: string,
    onProgress: (status: InstallStatus, progress: number, error?: string) => void
  ): Promise<void> {
    try {
      onProgress(InstallStatus.DOWNLOADING, 0);

      // 确保工作流目录存在
      const workflowsDir = path.join(this.comfyuiPath, 'user', 'default', 'workflows');
      if (!fs.existsSync(workflowsDir)) {
        fs.mkdirSync(workflowsDir, { recursive: true });
        logger.info(`创建工作流目录: ${workflowsDir}`);
      }

      // 目标文件路径
      const outputPath = path.join(workflowsDir, resource.filename);

      // 检查文件是否已存在
      if (fs.existsSync(outputPath)) {
        // 工作流文件已存在，根据需要可以选择覆盖或跳过
        // 这里选择覆盖，因为工作流可能有更新
        logger.info(`工作流文件已存在，将覆盖: ${outputPath}`);
      }

      logger.info(`开始下载工作流 ${resource.name} 从 ${resource.url} 到 ${outputPath}`);

      // 创建下载进度处理函数
      const onDownloadProgress = (downloadedBytes: number, totalBytes: number) => {
        const percent = totalBytes > 0 ? Math.floor((downloadedBytes / totalBytes) * 100) : 0;
        onProgress(InstallStatus.DOWNLOADING, percent);

        // 记录进度
        if (percent % 20 === 0) { // 每20%记录一次
          logger.info(`工作流 ${resource.name} 下载进度: ${percent}%`);
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
        logger.info(`工作流 ${resource.name} 下载完成`);
        onProgress(InstallStatus.COMPLETED, 100);
      } else {
        throw new Error(`下载后未找到文件: ${finalPath}`);
      }

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      // 如果是用户取消，设置状态为已取消
      if (errorMsg.includes('下载已取消') || errorMsg.includes('aborted')) {
        onProgress(InstallStatus.CANCELED, 0);
        logger.info(`工作流 ${resource.name} 下载已取消`);
      } else {
        // 其他错误
        onProgress(InstallStatus.ERROR, 0, errorMsg);
        logger.error(`工作流 ${resource.name} 下载失败: ${errorMsg}`);
      }

      // 删除不完整的文件
      const workflowsDir = path.join(this.comfyuiPath, 'user', 'default', 'workflows');
      const outputPath = path.join(workflowsDir, resource.filename);
      
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
