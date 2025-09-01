import { v4 as uuidv4 } from 'uuid';
import superagent from 'superagent';
import * as fs from 'fs';
import * as path from 'path';
import { exec, execSync } from 'child_process';
import * as util from 'util';
import * as os from 'os';
import logger from '../../utils/logger';
import { SystemController } from '../system/system.controller';
import { PluginHistoryManager, PluginOperationHistory } from './history';

// 将exec转换为Promise
const execPromise = util.promisify(exec);

// 确定环境和路径
const isDev = process.env.NODE_ENV !== 'production';

// 在开发环境中使用当前目录，生产环境使用配置路径
const COMFYUI_PATH = process.env.COMFYUI_PATH || 
  (isDev ? path.join(process.cwd(), 'comfyui') : '/root/ComfyUI');

const CUSTOM_NODES_PATH = path.join(COMFYUI_PATH, 'custom_nodes');

// 添加代理URL作为备用方案
async function fetchWithFallback(url: string) {
  try {
    // 首先尝试直接获取
    const response = await superagent.get(url).timeout({ response: 5000, deadline: 15000 });
    return response;  // 返回完整的 response 对象，而不仅仅是 body
  } catch (error) {
    console.log(`[插件API] 直接获取 ${url} 失败，尝试使用代理...`);
    
    // 如果直接获取失败，尝试使用gh-proxy代理
    const proxyUrl = `https://gh-proxy.com/${url}`;
    const proxyResponse = await superagent.get(proxyUrl);
    return proxyResponse;  // 返回完整的 response 对象
  }
}

// 获取系统控制器单例
const systemController = new SystemController();

export class PluginInstallManager {
  private historyManager: PluginHistoryManager;

  constructor(historyManager: PluginHistoryManager) {
    this.historyManager = historyManager;
  }

  // 安装插件
  async installPlugin(ctx: any, pluginId: string, githubProxy?: string): Promise<string> {
    console.log(`[API] 请求安装插件: ${pluginId}`);
    
    const taskId = uuidv4();
    
    // 从系统控制器获取 GitHub 代理配置
    const systemEnvConfig = systemController['environmentConfigurator']?.envConfig || {};
    const systemGithubProxy = systemEnvConfig.GITHUB_PROXY || process.env.GITHUB_PROXY || '';
    
    // 确定实际使用的代理:
    // 1. 如果系统配置的代理是 github.com，不使用代理
    // 2. 否则优先使用系统配置的代理，如果没有则使用客户端提供的代理
    let actualGithubProxy = '';
    if (systemGithubProxy && systemGithubProxy !== 'https://github.com') {
      actualGithubProxy = systemGithubProxy;
      console.log(`[API] 使用系统配置的GitHub代理: ${actualGithubProxy}`);
    } else if (githubProxy) {
      actualGithubProxy = githubProxy;
      console.log(`[API] 使用客户端提供的GitHub代理: ${actualGithubProxy}`);
    } else {
      console.log(`[API] 不使用GitHub代理`);
    }
    
    // 添加到历史记录
    this.historyManager.addHistoryItem(taskId, pluginId, 'install', actualGithubProxy);
    
    // 实际安装插件任务
    this.installPluginTask(taskId, pluginId, actualGithubProxy);
    
    return taskId;
  }

  // 实际安装插件任务
  private async installPluginTask(taskId: string, pluginId: string, githubProxy: string): Promise<void> {
    try {
      // 更新进度
      this.logOperation(taskId, '正在查找插件信息...');
      
      // 从缓存中查找插件信息
      let pluginInfo: any = null;
      
      // 检查缓存是否为空或过期，这里需要从外部传入
      // 暂时使用模拟数据
      pluginInfo = {
        id: pluginId,
        name: pluginId,
        install_type: 'git-clone',
        github: `https://github.com/example/${pluginId}`,
        files: []
      };
      
      if (!pluginInfo) {
        this.logOperation(taskId, `未找到插件: ${pluginId}`);
        throw new Error(`未找到插件: ${pluginId}`);
      }

      this.logOperation(taskId, `找到插件: ${JSON.stringify(pluginInfo)}`);
      console.log(`[API] 找到插件: ${JSON.stringify(pluginInfo)}`);

      this.logOperation(taskId, '准备安装...');
      
      // 确定安装方法
      const installType = pluginInfo.install_type || 'git-clone';
      
      // 确定安装路径
      const targetDir = path.join(CUSTOM_NODES_PATH, pluginId);
      
      // 检查目录是否已存在
      if (fs.existsSync(targetDir)) {
        // 如果存在，备份并删除
        this.logOperation(taskId, '检测到已有安装，正在备份...');
        const backupDir = `${targetDir}_backup_${Date.now()}`;
        fs.renameSync(targetDir, backupDir);
        this.logOperation(taskId, `已将现有目录备份到: ${backupDir}`);
      }
      
      this.logOperation(taskId, '正在下载插件...');
      
      // 根据安装类型执行安装
      if (installType === 'git-clone' && pluginInfo.github) {
        // 使用git clone安装
        try {
          const proxyUrl = this.applyGitHubProxy(pluginInfo.github, githubProxy);
          this.logOperation(taskId, `执行: git clone "${proxyUrl}" "${targetDir}"`);
          const { stdout, stderr } = await execPromise(`git clone "${proxyUrl}" "${targetDir}"`);
          if (stdout) this.logOperation(taskId, `Git输出: ${stdout}`);
          if (stderr) this.logOperation(taskId, `Git错误: ${stderr}`);
        } catch (cloneError) {
          this.logOperation(taskId, `Git克隆失败: ${cloneError}`);
          console.error(`[API] Git克隆失败: ${cloneError}`);
          
          // 尝试使用HTTPS替代可能的SSH或HTTP2
          const convertedUrl = pluginInfo.github
            .replace('git@github.com:', 'https://github.com/')
            .replace(/\.git$/, '');
          
          const proxyConvertedUrl = this.applyGitHubProxy(convertedUrl, githubProxy);
          this.logOperation(taskId, `尝试备用方式: git clone "${proxyConvertedUrl}" "${targetDir}"`);
          
          try {
            const { stdout, stderr } = await execPromise(`git clone "${proxyConvertedUrl}" "${targetDir}"`);
            if (stdout) this.logOperation(taskId, `Git输出: ${stdout}`);
            if (stderr) this.logOperation(taskId, `Git错误: ${stderr}`);
          } catch (retryError) {
            this.logOperation(taskId, `备用方式也失败: ${retryError}`);
            throw new Error(`git克隆失败: ${cloneError instanceof Error ? cloneError.message : String(cloneError)}. 备用方式也失败: ${retryError instanceof Error ? retryError.message : String(retryError)}`);
          }
        }
      } else if (installType === 'copy' && Array.isArray(pluginInfo.files)) {
        // 创建目标目录
        fs.mkdirSync(targetDir, { recursive: true });
        this.logOperation(taskId, `创建目录: ${targetDir}`);
        
        // 依次下载文件
        for (const file of pluginInfo.files) {
          const fileName = path.basename(file);
          this.logOperation(taskId, `下载文件: ${file}`);
          const response = await superagent.get(file);
          const targetPath = path.join(targetDir, fileName);
          fs.writeFileSync(targetPath, response.text);
          this.logOperation(taskId, `文件已保存到: ${targetPath}`);
        }
      } else {
        this.logOperation(taskId, `不支持的安装类型: ${installType}`);
        throw new Error(`不支持的安装类型: ${installType}`);
      }
      
      // 安装依赖
      // 在开发环境下跳过依赖安装
      if (isDev) {
        this.logOperation(taskId, '开发环境：跳过依赖安装');
        console.log('[API] 开发环境：跳过依赖安装');
      } else {
        this.logOperation(taskId, '检查依赖文件...');
        
        const requirementsPath = path.join(targetDir, 'requirements.txt');
        if (fs.existsSync(requirementsPath)) {
          this.logOperation(taskId, `发现requirements.txt，执行: pip install --user -r "${requirementsPath}"`);
          try {
            const { stdout, stderr } = await execPromise(`pip install --user -r "${requirementsPath}"`);
            if (stdout) this.logOperation(taskId, `依赖安装输出: ${stdout}`);
            if (stderr) this.logOperation(taskId, `依赖安装警告: ${stderr}`);
          } catch (pipError) {
            this.logOperation(taskId, `依赖安装失败，但继续安装流程: ${pipError}`);
          }
        } else {
          this.logOperation(taskId, '未找到requirements.txt文件');
        }
        
        // 执行安装脚本
        const installScriptPath = path.join(targetDir, 'install.py');
        if (fs.existsSync(installScriptPath)) {
          this.logOperation(taskId, `发现install.py，执行: cd "${targetDir}" && python3 "${installScriptPath}"`);
          try {
            const { stdout, stderr } = await execPromise(`cd "${targetDir}" && python3 "${installScriptPath}"`);
            if (stdout) this.logOperation(taskId, `安装脚本输出: ${stdout}`);
            if (stderr) this.logOperation(taskId, `安装脚本警告: ${stderr}`);
          } catch (scriptError) {
            this.logOperation(taskId, `安装脚本执行失败，但继续安装流程: ${scriptError}`);
          }
        } else {
          this.logOperation(taskId, '未找到install.py脚本');
        }
      }
      
      // 完成安装
      const now = new Date();
      const successMessage = `安装完成于 ${now.toLocaleString()}`;
      this.logOperation(taskId, successMessage);
      
      // 更新历史记录
      this.historyManager.updateHistoryItem(taskId, {
        endTime: Date.now(),
        status: 'success',
        result: successMessage
      });
      
    } catch (error) {
      console.error(`[API] 安装插件失败: ${error}`);
      const errorMessage = `安装失败: ${error instanceof Error ? error.message : '未知错误'}`;
      this.logOperation(taskId, errorMessage);
      
      // 更新历史记录
      this.historyManager.updateHistoryItem(taskId, {
        endTime: Date.now(),
        status: 'failed',
        result: errorMessage
      });
      
      // 清理可能部分创建的目录
      const targetDir = path.join(CUSTOM_NODES_PATH, pluginId);
      if (fs.existsSync(targetDir)) {
        try {
          // 直接删除失败的安装目录
          await fs.promises.rm(targetDir, { recursive: true, force: true });
          this.logOperation(taskId, `已删除失败的安装目录: ${targetDir}`);
          console.log(`[API] 已删除失败的安装目录: ${targetDir}`);
        } catch (cleanupError) {
          this.logOperation(taskId, `清理失败的安装目录失败: ${cleanupError}`);
          console.error(`[API] 清理失败的安装目录失败: ${cleanupError}`);
        }
      }
    }
  }

  // 记录操作日志
  private logOperation(taskId: string, message: string): void {
    // 获取当前时间
    const timestamp = new Date().toLocaleString();
    const logMessage = `[${timestamp}] ${message}`;
    
    // 添加到历史记录
    const historyItem = this.historyManager.getHistory().find(item => item.id === taskId);
    if (historyItem) {
      historyItem.logs.push(logMessage);
      // 更新历史记录
      this.historyManager.setHistory([...this.historyManager.getHistory()]);
    }
    
    // 同时也打印到控制台
    console.log(`[操作日志] ${logMessage}`);
  }

  // 修改 GitHub URL 使用代理的辅助方法
  private applyGitHubProxy(githubUrl: string, githubProxy: string): string {
    if (!githubProxy || !githubUrl) {
      return githubUrl;
    }

    // 如果代理本身就是 github.com，则不做任何处理
    if (githubProxy === 'https://github.com/' || githubProxy === 'http://github.com/') {
      return githubUrl;
    }

    // 处理第二种格式：https://hub.fastgit.xyz/
    // 这是域名替换模式
    return githubUrl.replace('https://github.com/', githubProxy);
  }

  // 添加一个新的公共方法，用于从其他控制器直接调用安装插件
  public async installPluginFromGitHub(
    githubUrl: string, 
    branch: string = 'main',
    progressCallback: (progress: any) => boolean,
    operationId: string
  ): Promise<void> {
    try {
      // 从GitHub URL解析插件ID
      const githubUrlParts = githubUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
      if (!githubUrlParts) {
        throw new Error(`无效的GitHub URL: ${githubUrl}`);
      }
      
      const repo = githubUrlParts[2].replace('.git', '');
      const pluginId = repo;
      
      // 从系统控制器获取 GitHub 代理配置
      const systemEnvConfig = systemController['environmentConfigurator']?.envConfig || {};
      const systemGithubProxy = systemEnvConfig.GITHUB_PROXY || process.env.GITHUB_PROXY || '';
      
      // 确定实际使用的代理
      let actualGithubProxy = '';
      if (systemGithubProxy && systemGithubProxy !== 'https://github.com') {
        actualGithubProxy = systemGithubProxy;
        console.log(`[API] 使用系统配置的GitHub代理: ${actualGithubProxy}`);
      } else {
        console.log(`[API] 不使用GitHub代理`);
      }
      
      // 记录操作开始
      this.logOperation(operationId, `开始从资源包安装插件: ${githubUrl} (分支: ${branch})`);
      
      // 确定安装路径
      const targetDir = path.join(CUSTOM_NODES_PATH, pluginId);
      
      // 检查目录是否已存在
      if (fs.existsSync(targetDir)) {
        // 如果存在，备份并删除
        this.logOperation(operationId, '检测到已有安装，正在备份...');
        const backupDir = `${targetDir}_backup_${Date.now()}`;
        fs.renameSync(targetDir, backupDir);
        this.logOperation(operationId, `已将现有目录备份到: ${backupDir}`);
      }
      
      this.logOperation(operationId, '正在下载插件...');
      
      // 使用git clone安装
      try {
        const proxyUrl = this.applyGitHubProxy(githubUrl, actualGithubProxy);
        this.logOperation(operationId, `执行: git clone --branch ${branch} "${proxyUrl}" "${targetDir}"`);
        const { stdout, stderr } = await execPromise(`git clone --branch ${branch} "${proxyUrl}" "${targetDir}"`);
        if (stdout) this.logOperation(operationId, `Git输出: ${stdout}`);
        if (stderr) this.logOperation(operationId, `Git错误: ${stderr}`);
      } catch (cloneError) {
        this.logOperation(operationId, `Git克隆失败: ${cloneError}`);
        console.error(`[API] Git克隆失败: ${cloneError}`);
        
        // 尝试使用HTTPS替代可能的SSH或HTTP2
        const convertedUrl = githubUrl
          .replace('git@github.com:', 'https://github.com/')
          .replace(/\.git$/, '');
        
        const proxyConvertedUrl = this.applyGitHubProxy(convertedUrl, actualGithubProxy);
        this.logOperation(operationId, `尝试备用方式: git clone --branch ${branch} "${proxyConvertedUrl}" "${targetDir}"`);
        
        try {
          const { stdout, stderr } = await execPromise(`git clone --branch ${branch} "${proxyConvertedUrl}" "${targetDir}"`);
          if (stdout) this.logOperation(operationId, `Git输出: ${stdout}`);
          if (stderr) this.logOperation(operationId, `Git错误: ${stderr}`);
        } catch (retryError) {
          this.logOperation(operationId, `备用方式也失败: ${retryError}`);
          throw new Error(`git克隆失败: ${cloneError instanceof Error ? cloneError.message : String(cloneError)}. 备用方式也失败: ${retryError instanceof Error ? retryError.message : String(retryError)}`);
        }
      }
      
      // 安装依赖
      // 在开发环境下跳过依赖安装
      if (isDev) {
        this.logOperation(operationId, '开发环境：跳过依赖安装');
        console.log('[API] 开发环境：跳过依赖安装');
      } else {
        this.logOperation(operationId, '检查依赖文件...');
        
        const requirementsPath = path.join(targetDir, 'requirements.txt');
        if (fs.existsSync(requirementsPath)) {
          this.logOperation(operationId, `发现requirements.txt，执行: pip install --user -r "${requirementsPath}"`);
          try {
            const { stdout, stderr } = await execPromise(`pip install --user -r "${requirementsPath}"`);
            if (stdout) this.logOperation(operationId, `依赖安装输出: ${stdout}`);
            if (stderr) this.logOperation(operationId, `依赖安装警告: ${stderr}`);
          } catch (pipError) {
            this.logOperation(operationId, `依赖安装失败，但继续安装流程: ${pipError}`);
          }
        } else {
          this.logOperation(operationId, '未找到requirements.txt文件');
        }
        
        // 执行安装脚本
        const installScriptPath = path.join(targetDir, 'install.py');
        if (fs.existsSync(installScriptPath)) {
          this.logOperation(operationId, `发现install.py，执行: cd "${targetDir}" && python3 "${installScriptPath}"`);
          try {
            const { stdout, stderr } = await execPromise(`cd "${targetDir}" && python3 "${installScriptPath}"`);
            if (stdout) this.logOperation(operationId, `安装脚本输出: ${stdout}`);
            if (stderr) this.logOperation(operationId, `安装脚本警告: ${stderr}`);
          } catch (scriptError) {
            this.logOperation(operationId, `安装脚本执行失败，但继续安装流程: ${scriptError}`);
          }
        } else {
          this.logOperation(operationId, '未找到install.py脚本');
        }
      }
      
      // 完成安装
      const now = new Date();
      const successMessage = `插件安装完成于 ${now.toLocaleString()}`;
      this.logOperation(operationId, successMessage);
      
      // 调用进度回调
      if (progressCallback) {
        progressCallback({
          progress: 100,
          status: 'completed'
        });
      }
      
    } catch (error) {
      console.error(`[API] 安装插件失败: ${error}`);
      const errorMessage = `安装失败: ${error instanceof Error ? error.message : '未知错误'}`;
      
      this.logOperation(operationId, errorMessage);
      
      // 调用进度回调报告错误
      if (progressCallback) {
        progressCallback({
          progress: 0,
          status: 'error',
          error: errorMessage
        });
      }
      
      // 重新抛出错误
      throw error;
    }
  }

  // 添加一个新的API端点，用于自定义插件安装
  async installCustomPlugin(ctx: any, githubUrl: string, branch: string = 'main'): Promise<string> {
    console.log(`[API] 请求从自定义URL安装插件: ${githubUrl}, 分支: ${branch}`);
    
    // 验证GitHub URL格式
    const githubRegex = /^(https?:\/\/)?(www\.)?github\.com\/([^\/]+)\/([^\/\.]+)(\.git)?$/;
    if (!githubRegex.test(githubUrl)) {
      throw new Error('无效的GitHub URL格式');
    }
    
    // 规范化URL (确保使用https://，移除可能的.git后缀)
    let normalizedUrl = githubUrl
      .replace(/^(http:\/\/)?(www\.)?github\.com/, 'https://github.com')
      .replace(/\.git$/, '');
    
    // 生成任务ID
    const taskId = uuidv4();
    
    // 从GitHub URL解析插件ID
    const githubUrlParts = normalizedUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!githubUrlParts) {
      throw new Error(`无法从URL解析仓库信息: ${normalizedUrl}`);
    }
    
    const repoName = githubUrlParts[2];
    const pluginId = repoName;

    // 添加到历史记录
    this.historyManager.addHistoryItem(taskId, pluginId, 'install');
    
    // 异步执行安装
    (async () => {
      try {
        // 创建一个进度回调函数
        const progressCallback = (progress: any): boolean => {
          // 这里可以添加进度更新逻辑
          return true;
        };
        
        // 调用现有方法执行安装
        await this.installPluginFromGitHub(
          normalizedUrl,
          branch,
          progressCallback,
          taskId
        );
        
        // 安装完成后，更新历史记录
        this.historyManager.updateHistoryItem(taskId, {
          endTime: Date.now(),
          status: 'success',
          result: `从GitHub安装完成: ${normalizedUrl}`
        });
        
      } catch (error) {
        console.error(`[API] 自定义插件安装失败: ${error}`);
        
        // 更新历史记录
        this.historyManager.updateHistoryItem(taskId, {
          endTime: Date.now(),
          status: 'failed',
          result: `安装失败: ${error instanceof Error ? error.message : '未知错误'}`
        });
      }
    })();
    
    return taskId;
  }
}
