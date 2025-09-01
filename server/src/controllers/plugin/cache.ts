import superagent from 'superagent';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../../utils/logger';

// 确定环境和路径
const isDev = process.env.NODE_ENV !== 'production';

// 在开发环境中使用当前目录，生产环境使用配置路径
const COMFYUI_PATH = process.env.COMFYUI_PATH || 
  (isDev ? path.join(process.cwd(), 'comfyui') : '/root/ComfyUI');

const CUSTOM_NODES_PATH = path.join(COMFYUI_PATH, 'custom_nodes');

// 确保有一个 .disabled 目录用于存放禁用的插件
const DISABLED_PLUGINS_PATH = path.join(CUSTOM_NODES_PATH, '.disabled');

// 缓存插件列表
let cachedPlugins: any[] = [];
let lastFetchTime = 0;
const CACHE_DURATION = 3600000; // 1小时缓存

// 缓存 GitHub 统计数据
let githubStatsCache: Record<string, { stars: number, updatedAt: number }> = {};
const GITHUB_STATS_CACHE_DURATION = 86400000; // 24小时缓存 GitHub 统计数据

// 模拟的插件列表
const mockPlugins = [
  {
    id: "comfyui-controlnet",
    name: "ComfyUI ControlNet",
    description: "ControlNet节点集合，帮助您通过预设条件精确控制图像生成",
    version: "1.2.3",
    author: "ComfyUI Team",
    github: "https://github.com/comfyanonymous/ComfyUI",
    stars: 1240,
    tags: ["controlnet", "conditioning"],
    install_type: "git_clone",
    files: ["controlnet.py", "node.py"],
    require_restart: true,
    installed: true,
    installedOn: "2023-10-15T10:30:00Z"
  },
  {
    id: "comfyui-impact-pack",
    name: "ComfyUI Impact Pack",
    description: "增强型节点集合，包含高级采样器、细节提升和特效处理",
    version: "2.0.1",
    author: "ltdrdata",
    github: "https://github.com/ltdrdata/ComfyUI-Impact-Pack",
    installed: true,
    installedOn: "2023-11-20T15:45:00Z"
  },
  {
    id: "comfyui-sd-webui-scripts",
    name: "SD WebUI Scripts",
    description: "从Stable Diffusion WebUI移植的常用脚本和工作流",
    version: "0.9.5",
    author: "SDWebUI Contributors",
    github: "https://github.com/AUTOMATIC1111/stable-diffusion-webui",
    installed: false
  },
  {
    id: "comfyui-advanced-nodes",
    name: "Advanced Nodes",
    description: "提供高级图像处理功能的节点集，包括色彩校正、图层混合等",
    version: "1.3.0",
    author: "ComfyUI Community",
    github: "https://github.com/example/advanced-nodes",
    installed: false
  },
  {
    id: "comfyui-animatediff",
    name: "AnimateDiff Integration",
    description: "将AnimateDiff集成到ComfyUI中，轻松创建动画和视频效果",
    version: "0.8.2",
    author: "guoyww",
    github: "https://github.com/guoyww/AnimateDiff",
    installed: true,
    installedOn: "2023-12-05T08:20:00Z"
  },
  {
    id: "comfyui-upscalers",
    name: "Super Upscalers",
    description: "高级超分辨率节点集，整合多种AI放大算法",
    version: "1.5.1",
    author: "AI Upscale Team",
    github: "https://github.com/example/super-upscalers",
    installed: false
  },
  {
    id: "comfyui-workflow-manager",
    name: "Workflow Manager",
    description: "工作流管理工具，保存、加载和共享您的ComfyUI工作流",
    version: "1.1.0",
    author: "Workflow Developers",
    github: "https://github.com/example/workflow-manager",
    installed: true,
    installedOn: "2024-01-10T14:15:00Z"
  },
  {
    id: "comfyui-prompts-library",
    name: "Prompts Library",
    description: "提示词库和模板集合，帮助用户快速创建高质量提示",
    version: "2.2.0",
    author: "Prompt Engineers",
    github: "https://github.com/example/prompts-library",
    installed: false
  }
];

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

export class PluginCacheManager {
  
  constructor() {
    // 初始化 - 启动时预加载插件数据
    this.initPluginsCache();
  }

  // 初始化插件缓存
  private async initPluginsCache() {
    try {
      console.log('[API] 启动时初始化插件缓存');
      setTimeout(async () => {
        try {
          // 初始化时强制从网络获取
          cachedPlugins = await this.fetchComfyUIManagerPlugins(true);
          lastFetchTime = Date.now();
          console.log(`[API] 插件缓存初始化完成，已缓存 ${cachedPlugins.length} 个插件`);
        } catch (error) {
          console.error('[API] 初始化插件缓存失败:', error);
        }
      }, 1000);
    } catch (error) {
      console.error('[API] 初始化插件缓存出错:', error);
    }
  }

  // 获取所有插件
  async getAllPlugins(forceRefresh: boolean = false): Promise<any[]> {
    try {
      console.log('[API] 获取所有插件');
      
      const currentTime = Date.now();
      
      // 如果缓存有效且不强制刷新，直接使用
      if (!forceRefresh && cachedPlugins.length > 0 && (currentTime - lastFetchTime) < CACHE_DURATION) {
        console.log('[API] 使用缓存的插件列表');
        return cachedPlugins;
      }
      
      // 从 ComfyUI-Manager 获取插件列表，传入forceRefresh参数
      const pluginsData = await this.fetchComfyUIManagerPlugins(forceRefresh);
      
      // 更新缓存
      cachedPlugins = pluginsData;
      lastFetchTime = currentTime;
      
      return pluginsData;
    } catch (error) {
      console.error('[API] 获取插件列表失败:', error);
      throw error;
    }
  }

  // 从 ComfyUI-Manager 获取插件列表
  private async fetchComfyUIManagerPlugins(forceNetworkFetch: boolean = false): Promise<any[]> {
    try {
      console.log(`[API] 获取插件列表 (强制网络获取: ${forceNetworkFetch})`);
      
      // 如果不强制网络获取，且缓存中有数据，则仅更新本地状态
      if (!forceNetworkFetch && cachedPlugins.length > 0) {
        console.log('[API] 使用缓存数据并更新本地状态');
        
        // 获取本地安装的插件信息
        const installedPlugins = this.getInstalledPlugins();
        
        // 更新缓存中插件的安装状态
        this.updatePluginsInstallStatus(cachedPlugins, installedPlugins);
        
        return cachedPlugins;
      }
      
      // 强制网络获取或缓存为空时，从网络获取完整列表
      console.log('[API] 从网络获取完整插件列表');
      
      // ComfyUI-Manager 插件列表URL
      const url = 'https://raw.githubusercontent.com/ltdrdata/ComfyUI-Manager/main/custom-node-list.json';
      
      const response = await fetchWithFallback(url);
      const managerData = JSON.parse(response.text);
      
      // 确保custom_nodes目录存在
      if (!fs.existsSync(CUSTOM_NODES_PATH)) {
        fs.mkdirSync(CUSTOM_NODES_PATH, { recursive: true });
      }
      
      // 获取已安装插件
      const installedPlugins = this.getInstalledPlugins();
      
      // 解析插件数据
      let plugins = managerData.custom_nodes.map((info: any) => {
        // 转换为标准格式
        const plugin = {
          id: info.id || info.title.toLowerCase().replace(/\s+/g, '-'),
          name: info.title,
          description: info.description || '',
          version: info.version || 'unknow',
          author: info.author || 'unknow',
          github: info.reference || '',
          install_type: info.install_type || 'git_clone',
          tags: info.tags || [],
          stars: 0,
          installed: false,
          disabled: false
        };
        
        return plugin;
      });
      
      // 更新安装状态
      this.updatePluginsInstallStatus(plugins, installedPlugins);
      
      return plugins;
    } catch (error) {
      console.error('[API] 获取ComfyUI-Manager插件列表失败:', error);
      
      // 如果从网络获取失败，但有缓存数据，则使用缓存
      if (cachedPlugins.length > 0) {
        console.log('[API] 使用缓存数据作为备选');
        return cachedPlugins;
      }
      
      // 缓存也没有，返回模拟数据
      console.log('[API] 无缓存可用，返回模拟数据');
      return [...mockPlugins];
    }
  }

  // 辅助方法：更新插件的安装状态
  private updatePluginsInstallStatus(plugins: any[], installedPlugins: any[]): void {
    // 创建一个快速查找表
    const installedMap = new Map();
    installedPlugins.forEach(plugin => {
      // 统一转为小写键以便忽略大小写比较
      installedMap.set(plugin.id.toLowerCase(), {
        installedOn: plugin.installedOn,
        disabled: plugin.disabled,
        // 保存原始插件信息用于GitHub URL比较
        originalPlugin: plugin
      });
    });
    
    // 更新每个插件的安装状态
    plugins.forEach(plugin => {
      // 忽略大小写比较
      const installedInfo = installedMap.get(plugin.id.toLowerCase());
      if (installedInfo) {
        // 更新为本地数据优先，保留网络数据中本地没有的字段
        const originalPlugin = installedInfo.originalPlugin;
        Object.keys(originalPlugin).forEach(key => {
          plugin[key] = originalPlugin[key];
        });
        // 确保安装状态正确
        plugin.installed = true;
        plugin.installedOn = originalPlugin.installedOn;
        plugin.disabled = originalPlugin.disabled;
      } else {
        // 如果ID没匹配上，尝试匹配GitHub URL
        const matchByGithub = this.findPluginByGithubUrl(plugin, installedPlugins);
        if (matchByGithub) {
          // 用本地插件数据覆盖网络数据
          Object.keys(matchByGithub).forEach(key => {
            plugin[key] = matchByGithub[key];
          });
          // 确保安装状态正确
          plugin.installed = true;
          plugin.installedOn = matchByGithub.installedOn;
          plugin.disabled = matchByGithub.disabled;
        } else {
          plugin.installed = false;
          plugin.disabled = false;
        }
      }
    });
    
    // 添加本地安装但不在列表中的插件
    installedPlugins.forEach(localPlugin => {
      // 忽略大小写比较
      const exists = plugins.some(p => 
        p.id.toLowerCase() === localPlugin.id.toLowerCase() || 
        this.isSameGithubRepo(p.github, localPlugin.github)
      );
      if (!exists) {
        plugins.push(localPlugin);
      }
    });
  }

  // 辅助方法：根据GitHub URL查找插件
  private findPluginByGithubUrl(plugin: any, installedPlugins: any[]): any {
    if (!plugin.github) return null;
    
    return installedPlugins.find(localPlugin => 
      this.isSameGithubRepo(plugin.github, localPlugin.github)
    );
  }
  
  // 辅助方法：判断两个GitHub URL是否指向同一仓库
  private isSameGithubRepo(url1: string, url2: string): boolean {
    if (!url1 || !url2) return false;
    
    // 标准化GitHub URL以进行比较
    const normalizeGithubUrl = (url: string): string => {
      return url.toLowerCase()
        .replace(/^git@github\.com:/, 'https://github.com/')
        .replace(/\.git$/, '')
        .replace(/\/$/, '');
    };
    
    const normalized1 = normalizeGithubUrl(url1);
    const normalized2 = normalizeGithubUrl(url2);
    
    // 直接比较标准化后的URL
    if (normalized1 === normalized2) return true;
    
    // 提取用户名和仓库名进行比较
    try {
      const match1 = normalized1.match(/github\.com\/([^\/]+)\/([^\/]+)/i);
      const match2 = normalized2.match(/github\.com\/([^\/]+)\/([^\/]+)/i);
      
      if (match1 && match2) {
        const [, user1, repo1] = match1;
        const [, user2, repo2] = match2;
        return user1.toLowerCase() === user2.toLowerCase() && 
               repo1.toLowerCase() === repo2.toLowerCase();
      }
    } catch (e) {
      // 如果解析失败，继续使用URL直接比较的结果
    }
    
    return false;
  }

  // 获取已安装的插件列表
  getInstalledPlugins(): any[] {
    try {
      const installedPlugins: any[] = [];
      
      // 确保目录存在
      if (!fs.existsSync(CUSTOM_NODES_PATH)) {
        console.log(`[API] 创建custom_nodes目录: ${CUSTOM_NODES_PATH}`);
        fs.mkdirSync(CUSTOM_NODES_PATH, { recursive: true });
        return [];
      }
      
      // 确保禁用插件目录存在
      if (!fs.existsSync(DISABLED_PLUGINS_PATH)) {
        console.log(`[API] 创建禁用插件目录: ${DISABLED_PLUGINS_PATH}`);
        fs.mkdirSync(DISABLED_PLUGINS_PATH, { recursive: true });
      }
      
      // 读取所有已启用插件目录
      const directories = fs.readdirSync(CUSTOM_NODES_PATH, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory() && !dirent.name.startsWith('.'))
        .map(dirent => dirent.name);
      
      // 处理已启用的插件
      for (const dir of directories) {
        const pluginInfo = this.getPluginInfo(dir, false);
        if (pluginInfo) {
          installedPlugins.push(pluginInfo);
        }
      }
      
      // 读取所有禁用的插件目录
      if (fs.existsSync(DISABLED_PLUGINS_PATH)) {
        const disabledDirectories = fs.readdirSync(DISABLED_PLUGINS_PATH, { withFileTypes: true })
          .filter(dirent => dirent.isDirectory() && !dirent.name.startsWith('.'))
          .map(dirent => dirent.name);
        
        // 处理禁用的插件
        for (const dir of disabledDirectories) {
          const pluginInfo = this.getPluginInfo(dir, true);
          if (pluginInfo) {
            installedPlugins.push(pluginInfo);
          }
        }
      }
      
      return installedPlugins;
    } catch (error) {
      console.error(`[API] 获取已安装插件列表失败: ${error}`);
      return [];
    }
  }
  
  // 获取单个插件的信息
  private getPluginInfo(dir: string, isDisabled: boolean): any {
    try {
      const pluginPath = isDisabled 
        ? path.join(DISABLED_PLUGINS_PATH, dir)
        : path.join(CUSTOM_NODES_PATH, dir);
      
      // 尝试读取git信息
      let repoUrl = '';
      try {
        const gitConfig = path.join(pluginPath, '.git', 'config');
        if (fs.existsSync(gitConfig)) {
          const configContent = fs.readFileSync(gitConfig, 'utf-8');
          const urlMatch = configContent.match(/url\s*=\s*(.+)/i);
          if (urlMatch && urlMatch[1]) {
            repoUrl = urlMatch[1].trim();
          }
        }
      } catch (e) {
        console.error(`[API] 无法读取git信息: ${e}`);
      }
      
      // 尝试从pyproject.toml获取元数据
      let metadata: any = {};
      try {
        const pyprojectPath = path.join(pluginPath, 'pyproject.toml');
        if (fs.existsSync(pyprojectPath)) {
          const pyprojectContent = fs.readFileSync(pyprojectPath, 'utf-8');
          // 简单解析，实际应使用toml解析器
          const nameMatch = pyprojectContent.match(/name\s*=\s*"([^"]+)"/);
          const versionMatch = pyprojectContent.match(/version\s*=\s*"([^"]+)"/);
          const authorMatch = pyprojectContent.match(/author\s*=\s*"([^"]+)"/);
          const descriptionMatch = pyprojectContent.match(/description\s*=\s*"([^"]+)"/);
          
          if (nameMatch) metadata.name = nameMatch[1];
          if (versionMatch) metadata.version = versionMatch[1];
          if (authorMatch) metadata.author = authorMatch[1];
          if (descriptionMatch) metadata.description = descriptionMatch[1];
        }
      } catch (e) {
        console.error(`[API] 无法读取pyproject.toml: ${e}`);
      }
      
      // 获取安装日期（使用目录创建时间）
      let installedOn;
      try {
        const stats = fs.statSync(pluginPath);
        installedOn = stats.birthtime.toISOString();
      } catch (e) {
        installedOn = new Date().toISOString(); // 默认为当前时间
      }
      
      // 返回插件信息
      return {
        id: dir,
        name: metadata.name || dir,
        description: metadata.description || `安装在 ${dir} 目录中的插件`,
        version: metadata.version || '1.0.0',
        author: metadata.author || '未知作者',
        github: repoUrl,
        installed: true,
        installedOn,
        disabled: isDisabled
      };
    } catch (error) {
      console.error(`[API] 获取插件信息失败: ${error}`);
      return null;
    }
  }

  // 刷新插件缓存
  async refreshPluginsCache(): Promise<void> {
    try {
      console.log('[API] 刷新插件缓存');
      // 只更新安装状态，不强制从网络获取
      cachedPlugins = await this.fetchComfyUIManagerPlugins(false);
      lastFetchTime = Date.now();
      console.log(`[API] 插件缓存刷新完成，当前有 ${cachedPlugins.length} 个插件`);
    } catch (error) {
      console.error('[API] 刷新插件缓存失败:', error);
    }
  }

  // 刷新已安装插件列表
  async refreshInstalledPlugins(): Promise<any[]> {
    try {
      console.log('[API] 刷新本地插件列表');
      
      // 获取最新的已安装插件列表
      const installedPlugins = this.getInstalledPlugins();
      
      // 如果缓存为空或过期，先获取最新的ComfyUI-Manager插件列表
      if (cachedPlugins.length === 0 || (Date.now() - lastFetchTime) >= CACHE_DURATION) {
        await this.refreshPluginsCache();
      }
      
      // 更新缓存中已安装插件的状态
      if (cachedPlugins.length > 0) {
        // 创建一个映射以快速查找插件
        const installedMap = new Map();
        installedPlugins.forEach(plugin => {
          // 使用小写ID作为键
          installedMap.set(plugin.id.toLowerCase(), {
            installed: true,
            installedOn: plugin.installedOn,
            disabled: plugin.disabled,
            github: plugin.github // 保存GitHub URL用于后续比较
          });
        });
        
        // 更新缓存中的插件状态
        cachedPlugins = cachedPlugins.map(plugin => {
          // 优先通过ID匹配（忽略大小写）
          const installed = installedMap.get(plugin.id.toLowerCase());
          if (installed) {
            return {
              ...plugin,
              installed: true,
              installedOn: installed.installedOn,
              disabled: installed.disabled
            };
          } else if (plugin.github) {
            // 如果ID没匹配上但有GitHub URL，尝试用GitHub URL匹配
            const matchedByGithub = this.findPluginByGithubUrl(plugin, installedPlugins);
            if (matchedByGithub) {
              return {
                ...plugin,
                installed: true,
                installedOn: matchedByGithub.installedOn,
                disabled: matchedByGithub.disabled
              };
            }
          }
          
          return {
            ...plugin,
            installed: false,
            disabled: false
          };
        });
        
        // 也更新本地安装但不在缓存中的插件
        installedPlugins.forEach(plugin => {
          // 检查是否已存在（忽略大小写ID和GitHub URL）
          const exists = cachedPlugins.some(p => 
            p.id.toLowerCase() === plugin.id.toLowerCase() || 
            this.isSameGithubRepo(p.github, plugin.github)
          );
          
          if (!exists) {
            cachedPlugins.push(plugin);
          }
        });
      }
      
      return installedPlugins;
    } catch (error) {
      console.error(`[API] 刷新本地插件列表失败: ${error}`);
      throw error;
    }
  }

  // 获取缓存状态
  getCacheStatus(): { count: number, lastUpdate: number, isValid: boolean } {
    const currentTime = Date.now();
    return {
      count: cachedPlugins.length,
      lastUpdate: lastFetchTime,
      isValid: (currentTime - lastFetchTime) < CACHE_DURATION
    };
  }

  // 清空缓存
  clearCache(): void {
    cachedPlugins = [];
    lastFetchTime = 0;
    console.log('[API] 插件缓存已清空');
  }
} 