/**
 * 资源包安装进度管理器
 * 负责跟踪和管理资源包安装的进度状态
 */
import { ResourcePackInstallProgress, ResourceInstallStatus, InstallStatus, ResourcePack } from '../../types/resource-packs.types';
import { logger } from '../../utils/logger';

export class ProgressManager {
  private packInstallProgress = new Map<string, ResourcePackInstallProgress>();

  /**
   * 创建新的安装进度记录
   */
  public createProgress(pack: ResourcePack, taskId: string): ResourcePackInstallProgress {
    const progress: ResourcePackInstallProgress = {
      packId: pack.id,
      packName: pack.name,
      taskId,
      status: InstallStatus.PENDING,
      currentResourceIndex: 0,
      totalResources: pack.resources.length,
      progress: 0,
      startTime: Date.now(),
      resourceStatuses: pack.resources.map(resource => ({
        resourceId: resource.id,
        resourceName: resource.name,
        resourceType: resource.type,
        status: InstallStatus.PENDING,
        progress: 0
      }))
    };

    this.packInstallProgress.set(taskId, progress);
    logger.info(`创建安装进度记录: ${pack.name}, 任务ID: ${taskId}`);
    return progress;
  }

  /**
   * 获取安装进度
   */
  public getProgress(taskId: string): ResourcePackInstallProgress | undefined {
    return this.packInstallProgress.get(taskId);
  }

  /**
   * 更新总体进度
   */
  public updateOverallProgress(taskId: string, currentIndex: number, totalResources: number): void {
    const progress = this.packInstallProgress.get(taskId);
    if (progress) {
      progress.currentResourceIndex = currentIndex;
      progress.totalResources = totalResources;
      progress.progress = Math.floor(((currentIndex + 1) / totalResources) * 100);
    }
  }

  /**
   * 更新资源状态
   */
  public updateResourceStatus(
    taskId: string, 
    resourceId: string, 
    status: InstallStatus, 
    progress: number = 0,
    error?: string
  ): void {
    const packProgress = this.packInstallProgress.get(taskId);
    if (packProgress) {
      const resourceStatus = packProgress.resourceStatuses.find(rs => rs.resourceId === resourceId);
      if (resourceStatus) {
        resourceStatus.status = status;
        resourceStatus.progress = progress;
        if (error) {
          resourceStatus.error = error;
        }
        if (status === InstallStatus.DOWNLOADING || status === InstallStatus.INSTALLING) {
          resourceStatus.startTime = resourceStatus.startTime || Date.now();
        }
        if (status === InstallStatus.COMPLETED || status === InstallStatus.ERROR || status === InstallStatus.CANCELED) {
          resourceStatus.endTime = Date.now();
        }
      }
    }
  }

  /**
   * 更新任务状态
   */
  public updateTaskStatus(taskId: string, status: InstallStatus, error?: string): void {
    const progress = this.packInstallProgress.get(taskId);
    if (progress) {
      progress.status = status;
      if (error) {
        progress.error = error;
      }
      if (status === InstallStatus.COMPLETED || status === InstallStatus.ERROR || status === InstallStatus.CANCELED) {
        progress.endTime = Date.now();
      }
    }
  }

  /**
   * 取消任务
   */
  public cancelTask(taskId: string): boolean {
    const progress = this.packInstallProgress.get(taskId);
    if (!progress) {
      return false;
    }

    progress.canceled = true;
    progress.status = InstallStatus.CANCELED;
    progress.endTime = Date.now();

    // 更新所有未完成资源的状态
    for (const resourceStatus of progress.resourceStatuses) {
      if (resourceStatus.status !== InstallStatus.COMPLETED && 
          resourceStatus.status !== InstallStatus.ERROR &&
          resourceStatus.status !== InstallStatus.SKIPPED) {
        resourceStatus.status = InstallStatus.CANCELED;
        resourceStatus.endTime = Date.now();
      }
    }

    logger.info(`任务已取消: ${taskId}`);
    return true;
  }

  /**
   * 检查任务是否已取消
   */
  public isTaskCanceled(taskId: string): boolean {
    const progress = this.packInstallProgress.get(taskId);
    return Boolean(progress?.canceled);
  }

  /**
   * 检查是否已有相同的安装任务在进行中
   */
  public hasActiveTask(taskId: string): boolean {
    const progress = this.packInstallProgress.get(taskId);
    return Boolean(progress && (
      progress.status === InstallStatus.PENDING || 
      progress.status === InstallStatus.DOWNLOADING || 
      progress.status === InstallStatus.INSTALLING
    ));
  }

  /**
   * 清理完成的进度记录（可选，用于内存管理）
   */
  public cleanupCompletedTasks(): void {
    const completedTasks: string[] = [];
    
    for (const [taskId, progress] of this.packInstallProgress.entries()) {
      if (progress.status === InstallStatus.COMPLETED || 
          progress.status === InstallStatus.ERROR || 
          progress.status === InstallStatus.CANCELED) {
        // 只保留最近1小时的记录
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        if (progress.endTime && progress.endTime < oneHourAgo) {
          completedTasks.push(taskId);
        }
      }
    }

    for (const taskId of completedTasks) {
      this.packInstallProgress.delete(taskId);
      logger.info(`清理完成的进度记录: ${taskId}`);
    }
  }

  /**
   * 获取所有活跃的任务ID
   */
  public getActiveTaskIds(): string[] {
    const activeTasks: string[] = [];
    
    for (const [taskId, progress] of this.packInstallProgress.entries()) {
      if (progress.status === InstallStatus.PENDING || 
          progress.status === InstallStatus.DOWNLOADING || 
          progress.status === InstallStatus.INSTALLING) {
        activeTasks.push(taskId);
      }
    }
    
    return activeTasks;
  }
}
