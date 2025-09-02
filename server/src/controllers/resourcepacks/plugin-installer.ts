/**
 * 插件资源安装器
 * 负责处理插件资源的安装
 */
import * as path from 'path';
import * as fs from 'fs';
import { PluginResource, InstallStatus } from '../../types/resource-packs.types';
import { PluginsController } from '../plugin/plugins.controller';
import { logger } from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export class PluginInstaller {
  private comfyuiPath: string;
  private pluginsController: PluginsController;

  constructor(comfyuiPath: string) {
    this.comfyuiPath = comfyuiPath;
    this.pluginsController = new PluginsController();
  }

  /**
   * 安装插件资源
   */
  public async installPluginResource(
    resource: PluginResource,
    taskId: string,
    onProgress: (status: InstallStatus, progress: number, error?: string) => void,
    abortController?: AbortController
  ): Promise<void> {
    try {
      onProgress(InstallStatus.INSTALLING, 0);

      // 从GitHub URL解析仓库所有者和名称
      const githubUrlParts = resource.github.match(/github\.com\/([^\/]+)\/([^\/]+)/);
      if (!githubUrlParts) {
        throw new Error(`无效的GitHub URL: ${resource.github}`);
      }

      const owner = githubUrlParts[1];
      const repo = githubUrlParts[2].replace('.git', '');

      // 生成一个唯一的操作ID用于跟踪插件安装进度
      const operationId = uuidv4();

      logger.info(`开始安装插件 ${resource.name} 从 ${resource.github}`);

      // 创建进度监听函数
      const progressListener = (installProgress: any) => {
        // 更新安装进度
        if (installProgress && typeof installProgress.progress === 'number') {
          onProgress(InstallStatus.INSTALLING, installProgress.progress);
        }

        // 检查安装状态
        if (installProgress && installProgress.status) {
          if (installProgress.status === 'completed') {
            onProgress(InstallStatus.COMPLETED, 100);
          } else if (installProgress.status === 'error') {
            onProgress(InstallStatus.ERROR, 0, installProgress.error || '安装失败');
          }
        }

        return true;
      };

      // 检查插件是否已安装
      const installedPlugins = await this.getPluginsList();
      
      const alreadyInstalled = installedPlugins.some(plugin => {
        // 检查是否已存在同名的插件目录
        return plugin.id.toLowerCase() === repo.toLowerCase() ||
               plugin.id.toLowerCase() === `comfyui-${repo.toLowerCase()}` ||
               plugin.github === resource.github;
      });

      if (alreadyInstalled) {
        logger.info(`插件 ${resource.name} 已安装，跳过`);
        onProgress(InstallStatus.SKIPPED, 100);
        return;
      }

      // 安装插件
      await this.installPluginSafely(resource, progressListener, operationId);

      // 安装成功
      logger.info(`插件 ${resource.name} 安装成功`);
      onProgress(InstallStatus.COMPLETED, 100);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      // 如果是用户取消，设置状态为已取消
      if (errorMsg.includes('取消')) {
        onProgress(InstallStatus.CANCELED, 0);
        logger.info(`插件 ${resource.name} 安装已取消`);
      } else {
        // 其他错误
        onProgress(InstallStatus.ERROR, 0, errorMsg);
        logger.error(`插件 ${resource.name} 安装失败: ${errorMsg}`);
      }

      throw error;
    }
  }

  /**
   * 安装插件的安全包装方法，处理类型问题
   */
  private async installPluginSafely(
    resource: PluginResource, 
    progressCallback: any, 
    operationId: string
  ): Promise<void> {
    // 使用新的公共方法来安装插件
    await this.pluginsController.installPluginFromGitHub(
      resource.github,
      resource.branch || 'main',
      progressCallback,
      operationId
    );
  }

  /**
   * 获取已安装插件列表的安全方法
   */
  private async getPluginsList(): Promise<any[]> {
    try {
      // 尝试通过公共方法获取
      if (typeof (this.pluginsController as any).listInstalledPlugins === 'function') {
        return await (this.pluginsController as any).listInstalledPlugins();
      }

      // 后备：通过扫描插件目录获取
      const { config } = require('../../config');
      const pluginsDir = path.join(this.comfyuiPath, 'custom_nodes');

      if (!fs.existsSync(pluginsDir)) {
        return [];
      }

      const items = fs.readdirSync(pluginsDir);
      return items
        .filter(item => {
          const itemPath = path.join(pluginsDir, item);
          return fs.statSync(itemPath).isDirectory() && !item.startsWith('.');
        })
        .map(name => ({ id: name }));
    } catch (error) {
      logger.error(`获取插件列表失败: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }
}
