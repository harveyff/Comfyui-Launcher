import * as fs from 'fs';
import * as path from 'path';

// 确定环境和路径
const isDev = process.env.NODE_ENV !== 'production';

// 在开发环境中使用当前目录，生产环境使用配置路径
const COMFYUI_PATH = process.env.COMFYUI_PATH || 
  (isDev ? path.join(process.cwd(), 'comfyui') : '/root/ComfyUI');

const CUSTOM_NODES_PATH = path.join(COMFYUI_PATH, 'custom_nodes');

// 确保有一个 .disabled 目录用于存放禁用的插件
const DISABLED_PLUGINS_PATH = path.join(CUSTOM_NODES_PATH, '.disabled');

export interface PluginMetadata {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  github: string;
  installed: boolean;
  installedOn?: string;
  disabled: boolean;
  tags?: string[];
  dependencies?: string[];
  requirements?: string[];
  hasInstallScript?: boolean;
  hasRequirementsFile?: boolean;
  lastModified?: string;
  size?: number;
}

export class PluginInfoManager {
  
  constructor() {}

  // 获取插件的Git信息
  getGitInfo(pluginPath: string): { repoUrl: string; branch: string; commit: string } | null {
    try {
      const gitConfig = path.join(pluginPath, '.git', 'config');
      if (!fs.existsSync(gitConfig)) {
        return null;
      }

      const configContent = fs.readFileSync(gitConfig, 'utf-8');
      const urlMatch = configContent.match(/url\s*=\s*(.+)/i);
      
      if (!urlMatch) {
        return null;
      }

      const repoUrl = urlMatch[1].trim();
      
      // 尝试获取分支信息
      let branch = 'main';
      try {
        const headFile = path.join(pluginPath, '.git', 'HEAD');
        if (fs.existsSync(headFile)) {
          const headContent = fs.readFileSync(headFile, 'utf-8').trim();
          const branchMatch = headContent.match(/ref: refs\/heads\/(.+)/);
          if (branchMatch) {
            branch = branchMatch[1];
          }
        }
      } catch (e) {
        console.error(`[插件信息] 无法读取分支信息: ${e}`);
      }

      // 尝试获取提交信息
      let commit = '';
      try {
        const headFile = path.join(pluginPath, '.git', 'HEAD');
        if (fs.existsSync(headFile)) {
          const headContent = fs.readFileSync(headFile, 'utf-8').trim();
          if (headContent.length === 40) {
            // 直接是commit hash
            commit = headContent;
          } else {
            // 是ref，需要读取对应的commit
            const refMatch = headContent.match(/ref: refs\/heads\/(.+)/);
            if (refMatch) {
              const refFile = path.join(pluginPath, '.git', 'refs', 'heads', refMatch[1]);
              if (fs.existsSync(refFile)) {
                commit = fs.readFileSync(refFile, 'utf-8').trim();
              }
            }
          }
        }
      } catch (e) {
        console.error(`[插件信息] 无法读取提交信息: ${e}`);
      }

      return { repoUrl, branch, commit };
    } catch (error) {
      console.error(`[插件信息] 读取Git信息失败: ${error}`);
      return null;
    }
  }

  // 从pyproject.toml获取元数据
  getPyprojectMetadata(pluginPath: string): Partial<PluginMetadata> {
    try {
      const pyprojectPath = path.join(pluginPath, 'pyproject.toml');
      if (!fs.existsSync(pyprojectPath)) {
        return {};
      }

      const pyprojectContent = fs.readFileSync(pyprojectPath, 'utf-8');
      const metadata: Partial<PluginMetadata> = {};

      // 解析基本信息
      const nameMatch = pyprojectContent.match(/name\s*=\s*"([^"]+)"/);
      const versionMatch = pyprojectContent.match(/version\s*=\s*"([^"]+)"/);
      const descriptionMatch = pyprojectContent.match(/description\s*=\s*"([^"]+)"/);
      const authorsMatch = pyprojectContent.match(/authors\s*=\s*\[([^\]]+)\]/);
      const dependenciesMatch = pyprojectContent.match(/dependencies\s*=\s*\[([^\]]+)\]/);

      if (nameMatch) metadata.name = nameMatch[1];
      if (versionMatch) metadata.version = versionMatch[1];
      if (descriptionMatch) metadata.description = descriptionMatch[1];
      
      if (authorsMatch) {
        const authors = authorsMatch[1].split(',').map(a => a.trim().replace(/"/g, ''));
        metadata.author = authors[0] || '未知作者';
      }
      
      if (dependenciesMatch) {
        const deps = dependenciesMatch[1].split(',').map(d => d.trim().replace(/"/g, ''));
        metadata.dependencies = deps;
      }

      return metadata;
    } catch (error) {
      console.error(`[插件信息] 读取pyproject.toml失败: ${error}`);
      return {};
    }
  }

  // 从setup.py获取元数据
  getSetupPyMetadata(pluginPath: string): Partial<PluginMetadata> {
    try {
      const setupPath = path.join(pluginPath, 'setup.py');
      if (!fs.existsSync(setupPath)) {
        return {};
      }

      const setupContent = fs.readFileSync(setupPath, 'utf-8');
      const metadata: Partial<PluginMetadata> = {};

      // 解析基本信息
      const nameMatch = setupContent.match(/name\s*=\s*["']([^"']+)["']/);
      const versionMatch = setupContent.match(/version\s*=\s*["']([^"']+)["']/);
      const descriptionMatch = setupContent.match(/description\s*=\s*["']([^"']+)["']/);
      const authorMatch = setupContent.match(/author\s*=\s*["']([^"']+)["']/);

      if (nameMatch) metadata.name = nameMatch[1];
      if (versionMatch) metadata.version = versionMatch[1];
      if (descriptionMatch) metadata.description = descriptionMatch[1];
      if (authorMatch) metadata.author = authorMatch[1];

      return metadata;
    } catch (error) {
      console.error(`[插件信息] 读取setup.py失败: ${error}`);
      return {};
    }
  }

  // 检查插件文件结构
  getPluginFileStructure(pluginPath: string): {
    hasInstallScript: boolean;
    hasRequirementsFile: boolean;
    hasReadme: boolean;
    hasLicense: boolean;
    pythonFiles: string[];
    requirements: string[];
  } {
    try {
      const files = fs.readdirSync(pluginPath);
      
      const result = {
        hasInstallScript: false,
        hasRequirementsFile: false,
        hasReadme: false,
        hasLicense: false,
        pythonFiles: [] as string[],
        requirements: [] as string[]
      };

      // 检查各种文件
      result.hasInstallScript = files.some(f => 
        f === 'install.py' || f === 'setup.py' || f === 'install.sh'
      );
      
      result.hasRequirementsFile = files.some(f => 
        f === 'requirements.txt' || f === 'requirements-dev.txt'
      );
      
      result.hasReadme = files.some(f => 
        f.toLowerCase().includes('readme') || f.toLowerCase().includes('说明')
      );
      
      result.hasLicense = files.some(f => 
        f.toLowerCase().includes('license') || f.toLowerCase().includes('licence')
      );

      // 获取Python文件
      result.pythonFiles = files.filter(f => 
        f.endsWith('.py') && !f.startsWith('__')
      );

      // 读取requirements.txt
      if (result.hasRequirementsFile) {
        try {
          const requirementsPath = path.join(pluginPath, 'requirements.txt');
          if (fs.existsSync(requirementsPath)) {
            const content = fs.readFileSync(requirementsPath, 'utf-8');
            result.requirements = content
              .split('\n')
              .map(line => line.trim())
              .filter(line => line && !line.startsWith('#'))
              .map(line => line.split('==')[0].split('>=')[0].split('<=')[0].split('~=')[0]);
          }
        } catch (e) {
          console.error(`[插件信息] 读取requirements.txt失败: ${e}`);
        }
      }

      return result;
    } catch (error) {
      console.error(`[插件信息] 检查文件结构失败: ${error}`);
      return {
        hasInstallScript: false,
        hasRequirementsFile: false,
        hasReadme: false,
        hasLicense: false,
        pythonFiles: [],
        requirements: []
      };
    }
  }

  // 获取插件的完整信息
  getPluginInfo(dir: string, isDisabled: boolean = false): PluginMetadata | null {
    try {
      const pluginPath = isDisabled 
        ? path.join(DISABLED_PLUGINS_PATH, dir)
        : path.join(CUSTOM_NODES_PATH, dir);
      
      if (!fs.existsSync(pluginPath)) {
        return null;
      }

      // 获取Git信息
      const gitInfo = this.getGitInfo(pluginPath);
      
      // 获取元数据（优先从pyproject.toml，然后是setup.py）
      let metadata = this.getPyprojectMetadata(pluginPath);
      if (!metadata.name) {
        metadata = this.getSetupPyMetadata(pluginPath);
      }
      
      // 获取文件结构信息
      const fileStructure = this.getPluginFileStructure(pluginPath);
      
      // 获取文件统计信息
      let size = 0;
      let lastModified = '';
      try {
        const stats = fs.statSync(pluginPath);
        size = stats.size;
        lastModified = stats.mtime.toISOString();
      } catch (e) {
        console.error(`[插件信息] 获取文件统计失败: ${e}`);
      }

      // 获取安装日期（使用目录创建时间）
      let installedOn;
      try {
        const stats = fs.statSync(pluginPath);
        installedOn = stats.birthtime.toISOString();
      } catch (e) {
        installedOn = new Date().toISOString();
      }

      // 构建完整的插件信息
      const pluginInfo: PluginMetadata = {
        id: dir,
        name: metadata.name || dir,
        description: metadata.description || `安装在 ${dir} 目录中的插件`,
        version: metadata.version || '1.0.0',
        author: metadata.author || '未知作者',
        github: gitInfo?.repoUrl || '',
        installed: true,
        installedOn,
        disabled: isDisabled,
        dependencies: metadata.dependencies || [],
        requirements: fileStructure.requirements,
        hasInstallScript: fileStructure.hasInstallScript,
        hasRequirementsFile: fileStructure.hasRequirementsFile,
        lastModified,
        size
      };

      return pluginInfo;
    } catch (error) {
      console.error(`[插件信息] 获取插件信息失败: ${error}`);
      return null;
    }
  }

  // 获取所有已安装插件的详细信息
  getAllInstalledPluginsInfo(): PluginMetadata[] {
    try {
      const installedPlugins: PluginMetadata[] = [];
      
      // 确保目录存在
      if (!fs.existsSync(CUSTOM_NODES_PATH)) {
        console.log(`[插件信息] 创建custom_nodes目录: ${CUSTOM_NODES_PATH}`);
        fs.mkdirSync(CUSTOM_NODES_PATH, { recursive: true });
        return [];
      }
      
      // 确保禁用插件目录存在
      if (!fs.existsSync(DISABLED_PLUGINS_PATH)) {
        console.log(`[插件信息] 创建禁用插件目录: ${DISABLED_PLUGINS_PATH}`);
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
      console.error(`[插件信息] 获取已安装插件列表失败: ${error}`);
      return [];
    }
  }

  // 验证插件完整性
  validatePlugin(pluginPath: string): {
    isValid: boolean;
    issues: string[];
    warnings: string[];
  } {
    const result = {
      isValid: true,
      issues: [] as string[],
      warnings: [] as string[]
    };

    try {
      if (!fs.existsSync(pluginPath)) {
        result.isValid = false;
        result.issues.push('插件目录不存在');
        return result;
      }

      const files = fs.readdirSync(pluginPath);
      
      // 检查必要的文件
      if (!files.some(f => f.endsWith('.py'))) {
        result.warnings.push('未找到Python文件');
      }

      if (!files.some(f => f === 'requirements.txt')) {
        result.warnings.push('未找到requirements.txt文件');
      }

      if (!files.some(f => f === 'README.md' || f.toLowerCase().includes('readme'))) {
        result.warnings.push('未找到README文件');
      }

      // 检查目录结构
      const hasValidStructure = files.some(f => 
        f === 'nodes' || f === 'custom_nodes' || f === 'scripts' || f === 'workflows'
      );
      
      if (!hasValidStructure) {
        result.warnings.push('目录结构可能不符合ComfyUI插件标准');
      }

    } catch (error) {
      result.isValid = false;
      result.issues.push(`读取插件目录失败: ${error}`);
    }

    return result;
  }

  // 获取插件的依赖关系
  getPluginDependencies(pluginPath: string): {
    direct: string[];
    indirect: string[];
    conflicts: string[];
  } {
    try {
      const requirementsPath = path.join(pluginPath, 'requirements.txt');
      if (!fs.existsSync(requirementsPath)) {
        return { direct: [], indirect: [], conflicts: [] };
      }

      const content = fs.readFileSync(requirementsPath, 'utf-8');
      const requirements = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));

      // 这里可以添加更复杂的依赖分析逻辑
      // 目前只返回直接依赖
      return {
        direct: requirements,
        indirect: [],
        conflicts: []
      };
    } catch (error) {
      console.error(`[插件信息] 获取依赖关系失败: ${error}`);
      return { direct: [], indirect: [], conflicts: [] };
    }
  }
} 