<template>
  <q-page padding>
    <div class="text-h4 q-mb-lg">{{ $t('network.config') }}</div>

    <div v-if="loading" class="text-center q-pa-lg">
      <q-spinner size="3em" color="primary" />
      <div class="q-mt-md">{{ $t('network.loading') }}</div>
    </div>

    <template v-else>
      <!-- Github 配置卡片 -->
      <q-card class="q-mb-md" flat bordered style="border-radius: var(--border-radius-xl);">
        <q-card-section class="relative-position">
          <div class="absolute-top-right q-pa-sm">
            <q-btn outline color="grey-7" style="border-radius: var(--border-radius-md); margin-right: 8px; margin-top: 16px;" @click="checkNetworkStatus('github')">
              <q-icon :name="networkStatus.github ? 'wifi' : 'wifi_off'" style="margin-right: 12px;"/>
              {{ $t('network.checkNetwork') }}
            </q-btn>
          </div>
          <div class="row items-center">
            <q-avatar size="40px" class="q-mr-md">
              <q-img src="../assets/github-logo.png" />
            </q-avatar>
            <div>
              <div class="text-subtitle1">{{ $t('network.github.title') }}</div>
              <div class="text-caption" :class="networkStatus.github ? 'text-positive' : 'text-negative'">
                {{ networkStatus.github ? $t('network.github.accessible') : $t('network.github.inaccessible') }}
              </div>
            </div>
            <q-space />
          </div>
        </q-card-section>
        
        <q-separator />
        
        <q-card-section>
          <div class="text-caption q-mb-xs">{{ $t('network.github.selectUrl') }}</div>
          <q-select
            outlined
            dense
            v-model="githubUrl"
            :options="['https://github.com/','http://gh-proxy.com/https://github.com/', 'https://hub.fastgit.xyz/', 'https://github.com.cnpmjs.org/']"
            placeholder="http://gh-proxy.com/https://github.com/"
            dropdown-icon="expand_more"
            @update:model-value="saveGithubConfig"
          />
        </q-card-section>
      </q-card>

      <!-- PyPI 配置卡片 -->
      <q-card class="q-mb-md" flat bordered style="border-radius: var(--border-radius-xl);">
        <q-card-section class="relative-position">
          <div class="absolute-top-right q-pa-sm">
            <q-btn outline color="grey-7" style="border-radius: var(--border-radius-md); margin-right: 8px; margin-top: 16px;" @click="checkNetworkStatus('pip')">
              <q-icon :name="networkStatus.pip ? 'wifi' : 'wifi_off'" style="margin-right: 12px;" />
              {{ $t('network.checkNetwork') }}
            </q-btn>
          </div>
          <div class="row items-center">
            <q-avatar size="40px" class="q-mr-md">
              <q-img src="../assets/pypi-logo.png" />
            </q-avatar>
            <div>
              <div class="text-subtitle1">{{ $t('network.pypi.title') }}</div>
              <div class="text-caption" :class="networkStatus.pip ? 'text-positive' : 'text-negative'">
                {{ networkStatus.pip ? $t('network.pypi.accessible') : $t('network.pypi.inaccessible') }}
              </div>
            </div>
            <q-space />
          </div>
        </q-card-section>
        
        <q-separator />
        
        <q-card-section>
          <div class="text-caption q-mb-xs">{{ $t('network.pypi.selectUrl') }}</div>
          <q-select
            outlined
            dense
            v-model="pypiUrl"
            :options="['https://pypi.joinolares.cn/root/olares3/+simple/', 'https://pypi.tuna.tsinghua.edu.cn/simple', 'https://mirrors.aliyun.com/pypi/simple/', 'https://pypi.org/simple/']"
            placeholder="https://pypi.joinolares.cn/root/olares3/+simple/"
            dropdown-icon="expand_more"
            @update:model-value="savePipConfig"
          />
        </q-card-section>
      </q-card>

      <!-- HuggingFace 配置卡片 -->
      <q-card class="q-mb-md" flat bordered style="border-radius: var(--border-radius-xl);">
        <q-card-section class="relative-position">
          <div class="absolute-top-right q-pa-sm">
            <q-btn outline color="grey-7" style="border-radius: var(--border-radius-md); margin-right: 8px; margin-top: 16px;" @click="checkNetworkStatus('huggingface')">
              <q-icon :name="networkStatus.huggingface ? 'wifi' : 'wifi_off'" style="margin-right: 12px;" />
              {{ $t('network.checkNetwork') }}
            </q-btn>
          </div>
          <div class="row items-center">
            <q-avatar size="40px" class="q-mr-md">
              <q-img src="../assets/huggingface-logo.png" />
            </q-avatar>
            <div>
              <div class="text-subtitle1">{{ $t('network.huggingface.title') }}</div>
              <div class="text-caption" :class="networkStatus.huggingface ? 'text-positive' : 'text-negative'">
                {{ networkStatus.huggingface ? $t('network.huggingface.accessible') : $t('network.huggingface.inaccessible') }}
              </div>
            </div>
            <q-space />
          </div>
        </q-card-section>
        
        <q-separator />
        
        <q-card-section>
          <div class="text-caption q-mb-xs">{{ $t('network.huggingface.selectUrl') }}</div>
          <q-select
            outlined
            dense
            v-model="huggingfaceUrl"
            :options="['https://huggingface.co/', 'https://hf-mirror.com/']"
            placeholder="https://huggingface.co/"
            dropdown-icon="expand_more"
            @update:model-value="saveHuggingFaceConfig"
          />
        </q-card-section>
      </q-card>
    </template>

    <!-- 使用抽离的网络检查弹窗组件 -->
    <NetworkCheckDialog
      v-model="logDialog.show"
      :loading="logDialog.loading"
      :logs="logDialog.logs"
      :current-network-status="currentNetworkStatus"
      :checking-network="checkingNetwork"
      @force-check="forceCheckNetworkStatus"
    />

    <!-- 现有的通知对话框 -->
    <q-dialog v-model="notifyDialog.show">
      <q-card>
        <q-card-section :class="`bg-${notifyDialog.color} text-white`">
          <div class="text-h6">{{ notifyDialog.title }}</div>
        </q-card-section>
        <q-card-section>
          {{ notifyDialog.message }}
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="确定" color="primary" v-close-popup />
        </q-card-actions>
      </q-card>
    </q-dialog>


  </q-page>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import api from 'src/api';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import NetworkCheckDialog from '../components/NetworkCheckDialog.vue';

const i18n = useI18n();
const $q = useQuasar();

// 输入框绑定的URL值
const githubUrl = ref('');
const pypiUrl = ref('');
const huggingfaceUrl = ref('');

// 页面状态
const loading = ref(true);
const networkStatus = ref({
  github: false,
  pip: false,
  huggingface: false
});

// 保存状态
const isSaving = ref({
  github: false,
  pip: false,
  huggingface: false
});

// 通知对话框
const notifyDialog = ref({
  show: false,
  title: '',
  message: '',
  color: 'primary'
});

// 添加日志对话框状态
const logDialog = ref({
  show: false,
  loading: false,
  checkId: null,
  logs: [],
  polling: null,
  pollingInterval: 1000, // 轮询间隔(毫秒)
  status: 'in_progress' // 'in_progress', 'completed', 'failed'
});

// 当前检查获取的网络状态
const currentNetworkStatus = ref({
  github: { accessible: false },
  pip: { accessible: false },
  huggingface: { accessible: false }
});

// 是否正在强制检查网络
const checkingNetwork = ref(false);



// 显示通知
const showNotify = (title, message, color = 'primary') => {
  notifyDialog.value.title = title;
  notifyDialog.value.message = message;
  notifyDialog.value.color = color;
  notifyDialog.value.show = true;
};

// 停止轮询
const stopPolling = () => {
  if (logDialog.value.polling) {
    clearInterval(logDialog.value.polling);
    logDialog.value.polling = null;
  }
};

// 获取网络检查日志
const fetchNetworkCheckLog = async () => {
  if (!logDialog.value.checkId) return;
  
  try {
    // 获取当前语言
    const currentLocale = i18n.locale.value;
    
    const response = (await api.getNetworkCheckLog(
      logDialog.value.checkId, 
      { lang: currentLocale }
    )).body;
    
    console.log('response:', response);
    if (response.code === 200) {
      const data = response.data;
      logDialog.value.logs = data.log.logs;
      logDialog.value.status = data.log.status;
      currentNetworkStatus.value = data.currentNetworkStatus;
      
      // 如果检查已完成，停止轮询并更新总体网络状态
      if (data.log.status === 'completed' || data.log.status === 'failed') {
        stopPolling();
        // 更新页面上的网络状态
        networkStatus.value.github = currentNetworkStatus.value.github.accessible;
        networkStatus.value.pip = currentNetworkStatus.value.pip.accessible;
        networkStatus.value.huggingface = currentNetworkStatus.value.huggingface.accessible;
      }
    }
  } catch (error) {
    console.error('Failed to fetch network check log:', error);
    // 如果获取日志失败，停止轮询
    stopPolling();
  } finally {
    logDialog.value.loading = false;
  }
};

// 开始轮询网络检查日志
const startPolling = () => {
  // 先停止现有的轮询
  stopPolling();
  
  // 立即获取一次日志
  fetchNetworkCheckLog();
  
  // 设置轮询间隔
  logDialog.value.polling = setInterval(fetchNetworkCheckLog, logDialog.value.pollingInterval);
};

// 获取当前配置
const fetchNetworkConfig = async () => {
  try {
    loading.value = true;
    const response = await api.get('system/network-config');
    
    if (response.data.code === 200) {
      const config = response.data.data;
      githubUrl.value = config.github.url || '';
      pypiUrl.value = config.pip.url || '';
      huggingfaceUrl.value = config.huggingface.url || '';
      
      // 同时更新网络状态
      networkStatus.value.github = config.github.accessible;
      networkStatus.value.pip = config.pip.accessible;
      networkStatus.value.huggingface = config.huggingface.accessible;
    }
  } catch (error) {
    console.error('Failed to fetch network config:', error);
    showNotify($t('network.error'), $t('network.fetchConfigError'), 'negative');
  } finally {
    loading.value = false;
  }
};

// 检查网络状态 - 修改版本，支持日志查看，并传递语言信息
const checkNetworkStatus = async () => {
  try {
    // 获取当前语言
    const currentLocale = i18n.locale.value;
    
    const response = await api.get('system/network-status', {
      params: { lang: currentLocale }
    });
    
    console.log('response:', response);
    if (response.data.code === 200) {
      const result = response.data.data;
      
      // 获取检查ID并开始轮询日志
      const checkId = result.checkId;
      if (checkId) {
        logDialog.value.checkId = checkId;
        logDialog.value.logs = [];
        logDialog.value.loading = true;
        logDialog.value.show = true;
        logDialog.value.status = 'in_progress';
        startPolling();
      }
    }
  } catch (error) {
    console.error('Failed to check network status:', error);
    showNotify($t('network.error'), $t('network.checkNetworkError'), 'negative');
  }
};

// 强制重新检测网络状态（忽略缓存）
async function forceCheckNetworkStatus() {
  checkingNetwork.value = true;
  try {
    // 获取当前语言
    const currentLocale = i18n.locale.value;
    
    // 使用 POST 请求并传递 force=true 参数
    const response = await api.post('system/network-status', { 
      force: true,
      lang: currentLocale
    });
    
    console.log('强制检测网络响应:', response);
    
    if (response.data.code === 200) {
      const result = response.data.data;
      const checkId = result.checkId;
      
      if (checkId) {
        logDialog.value.checkId = checkId;
        logDialog.value.logs = [];
        logDialog.value.loading = true;
        logDialog.value.show = true;
        logDialog.value.status = 'in_progress';
        startPolling();
        
        // 显示强制检测的提示
        $q.notify({
          type: 'info',
          message: '已启动强制网络重新检测'
        });
      }
    }
  } catch (error) {
    console.error('强制网络检测出错:', error);
    $q.notify({
      type: 'negative',
      message: '网络检测请求失败'
    });
  } finally {
    checkingNetwork.value = false;
  }
}

// 保存GitHub配置
const saveGithubConfig = async () => {
  if (!githubUrl.value.trim()) {
    showNotify($t('network.warning'), $t('network.github.urlRequired'), 'warning');
    return;
  }
  
  try {
    isSaving.value.github = true;
    const response = await api.post('system/github-proxy', {
      githubProxy: githubUrl.value.trim()
    });
    
    if (response.data.code === 200) {
      showNotify($t('network.success'), $t('network.saveSuccess'), 'positive');
      // 更新网络状态
      checkNetworkStatus();
    }
  } catch (error) {
    console.error('Failed to save GitHub proxy config:', error);
    showNotify($t('network.error'), $t('network.saveError'), 'negative');
  } finally {
    isSaving.value.github = false;
  }
};

// 保存PIP配置
const savePipConfig = async () => {
  if (!pypiUrl.value.trim()) {
    showNotify($t('network.warning'), $t('network.pypi.urlRequired'), 'warning');
    return;
  }
  
  try {
    isSaving.value.pip = true;
    const response = await api.post('system/pip-source', {
      pipUrl: pypiUrl.value.trim()
    });
    
    if (response.data.code === 200) {
      showNotify($t('network.success'), $t('network.saveSuccess'), 'positive');
      // 更新网络状态
      checkNetworkStatus();
    }
  } catch (error) {
    console.error('Failed to save PIP source config:', error);
    showNotify($t('network.error'), $t('network.saveError'), 'negative');
  } finally {
    isSaving.value.pip = false;
  }
};

// 保存HuggingFace配置
const saveHuggingFaceConfig = async () => {
  if (!huggingfaceUrl.value.trim()) {
    showNotify($t('network.warning'), $t('network.huggingface.urlRequired'), 'warning');
    return;
  }
  
  try {
    isSaving.value.huggingface = true;
    const response = await api.post('system/huggingface-endpoint', {
      hfEndpoint: huggingfaceUrl.value.trim()
    });
    
    if (response.data.code === 200) {
      showNotify($t('network.success'), $t('network.saveSuccess'), 'positive');
      // 更新网络状态
      checkNetworkStatus();
    }
  } catch (error) {
    console.error('Failed to save Hugging Face endpoint config:', error);
    showNotify($t('network.error'), $t('network.saveError'), 'negative');
  } finally {
    isSaving.value.huggingface = false;
  }
};

// 组件挂载时获取配置
onMounted(() => {
  fetchNetworkConfig();
});

// 组件卸载前停止轮询
onBeforeUnmount(() => {
  stopPolling();
});
</script>

<style scoped>
.q-card {
  border-radius: 8px;
  box-shadow: 0 1px 5px rgba(0, 0, 0, 0.05);
}


</style> 