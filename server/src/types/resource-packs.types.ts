/**
 * 资源包管理相关类型定义
 */

// 资源类型枚举
export enum ResourceType {
  MODEL = 'model',
  PLUGIN = 'plugin',
  WORKFLOW = 'workflow',
  CUSTOM = 'custom'
}

// 资源包安装状态
export enum InstallStatus {
  PENDING = 'pending',
  DOWNLOADING = 'downloading',
  INSTALLING = 'installing',
  COMPLETED = 'completed',
  ERROR = 'error',
  SKIPPED = 'skipped',
  CANCELED = 'canceled'
}

// 基础资源接口
export interface Resource {
  id: string;
  name: string;
  type: ResourceType;
  description?: string;
  optional?: boolean; // 是否可选安装
}

// 模型资源接口
export interface ModelResource extends Resource {
  type: ResourceType.MODEL;
  url: string | { mirror: string; hf: string };
  dir: string; // 相对于ComfyUI模型目录的路径
  out: string; // 输出文件名
  essential?: boolean;
}

// 插件资源接口
export interface PluginResource extends Resource {
  type: ResourceType.PLUGIN;
  github: string;
  branch?: string;
}

// 工作流资源接口
export interface WorkflowResource extends Resource {
  type: ResourceType.WORKFLOW;
  url: string;
  filename: string; // 保存的文件名
}

// 自定义资源接口
export interface CustomResource extends Resource {
  type: ResourceType.CUSTOM;
  url: string;
  destination: string; // 目标保存路径
}

// 资源包接口
export interface ResourcePack {
  id: string;
  name: string;
  description?: string;
  author?: string;
  version?: string;
  tags?: string[];
  resources: (ModelResource | PluginResource | WorkflowResource | CustomResource)[];
}

// 资源安装状态
export interface ResourceInstallStatus {
  resourceId: string;
  resourceName: string;
  resourceType: ResourceType;
  status: InstallStatus;
  progress: number;
  error?: string;
  startTime?: number;
  endTime?: number;
}

// 资源包安装进度
export interface ResourcePackInstallProgress {
  packId: string;
  packName: string;
  taskId: string;
  status: InstallStatus;
  currentResourceIndex: number;
  totalResources: number;
  progress: number; // 0-100总体进度
  startTime: number;
  endTime?: number;
  resourceStatuses: ResourceInstallStatus[];
  error?: string;
  canceled?: boolean;
}

// 自定义下载选项接口
export interface CustomDownloadOptions {
  abortController: AbortController;
  onProgress: (progress: number, downloadedBytes: number, totalBytes: number) => void;
} 