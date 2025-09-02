<template>
  <q-dialog v-model="show" persistent>
    <q-card style="min-width: 600px; max-width: 80vw;">
      <q-card-section class="row items-center bg-white text-dark">
        <div class="text-h6">Network Check</div>
        <q-space />
        <q-btn icon="close" flat round dense v-close-popup />
      </q-card-section>
      
      <q-card-section style="max-height: 70vh; overflow-y: auto;">
        <!-- 网络状态概览 -->
        <div class="q-mb-sm">
          <div class="row q-col-gutter-md">
            <div class="col-4 no-margin-top no-padding-top" >
              <q-item>
                <q-item-section avatar>
                  <q-avatar>
                    <img :src="githubLogo" alt="GitHub">
                  </q-avatar>
                </q-item-section>
                <q-item-section>
                  <q-item-label>GitHub</q-item-label>
                  <q-item-label caption>
                    <q-chip 
                      dense 
                      :color="currentNetworkStatus.github?.accessible ? 'positive' : 'negative'" 
                      text-color="white"
                    >
                      {{ currentNetworkStatus.github?.accessible ? $t('network.accessible') : $t('network.inaccessible') }}
                    </q-chip>
                  </q-item-label>
                </q-item-section>
              </q-item>
            </div>
            <div class="col-4 no-margin-top no-padding-top">
              <q-item>
                <q-item-section avatar>
                  <q-avatar>
                    <img :src="pypiLogo" alt="PyPI">
                  </q-avatar>
                </q-item-section>
                <q-item-section>
                  <q-item-label>{{ $t('network.pipSource') }}</q-item-label>
                  <q-item-label caption>
                    <q-chip 
                      dense 
                      :color="currentNetworkStatus.pip?.accessible ? 'positive' : 'negative'" 
                      text-color="white"
                    >
                      {{ currentNetworkStatus.pip?.accessible ? $t('network.accessible') : $t('network.inaccessible') }}
                    </q-chip>
                  </q-item-label>
                </q-item-section>
              </q-item>
            </div>
            <div class="col-4 no-margin-top no-padding-top">
              <q-item>
                <q-item-section avatar>
                  <q-avatar>
                    <img :src="huggingfaceLogo" alt="Hugging Face">
                  </q-avatar>
                </q-item-section>
                <q-item-section>
                  <q-item-label>Hugging Face</q-item-label>
                  <q-item-label caption>
                    <q-chip 
                      dense 
                      :color="currentNetworkStatus.huggingface?.accessible ? 'positive' : 'negative'" 
                      text-color="white"
                    >
                      {{ currentNetworkStatus.huggingface?.accessible ? $t('network.accessible') : $t('network.inaccessible') }}
                    </q-chip>
                  </q-item-label>
                </q-item-section>
              </q-item>
            </div>
          </div>
        </div>

        <!-- 检查日志列表 -->
        <div class="text-subtitle1 q-mb-sm">Detection log</div>
        
        <div v-if="loading" class="text-center q-pa-md">
          <q-spinner color="primary" size="3em" />
          <div class="q-mt-sm">{{ $t('network.loadingLogs') }}</div>
        </div>
        
        <div v-else-if="logs.length === 0" class="text-center q-pa-md text-grey">
          {{ $t('network.noLogs') }}
        </div>
        
        <div v-else class="log-list-border">
          <div class="log-container">
            <q-list>
              <q-item v-for="(log, index) in logs" :key="index">
                <q-item-section avatar>
                  <q-icon 
                    :name="logIcon(log.type)" 
                    :color="logColor(log.type)" 
                  />
                </q-item-section>
                <q-item-section>
                  <q-item-label>
                    <span v-if="log.service" class="log-service">
                      [{{ log.service }}]
                    </span>
                    {{ log.message }}
                  </q-item-label>
                  <q-item-label caption>
                    {{ formatTime(log.time) }}
                  </q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
          </div>
        </div>
      </q-card-section>
      
      <q-card-section align="right" class="q-pt-sm">
        <div class="network-check-buttons">
          <q-btn 
            color="white" 
            text-color="dark"
            outline
            @click="onClose" 
            class="q-mr-sm ok-btn"
          >
            OK
          </q-btn>
          <q-btn 
            color="primary" 
            :loading="checkingNetwork" 
            @click="onForceCheck" 
            class="q-ml-sm"
          >
            Check Again
          </q-btn>
        </div>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue';
// Import logo images
import githubLogo from '../assets/github-logo.png';
import pypiLogo from '../assets/pypi-logo.png';
import huggingfaceLogo from '../assets/huggingface-logo.png';

// 定义日志项的类型接口
interface LogItem {
  type: string;
  service?: string;
  message: string;
  time: number;
}

// 定义网络状态的类型接口
interface NetworkStatusItem {
  accessible: boolean;
}

// 定义组件的 props
interface Props {
  modelValue: boolean;
  loading: boolean;
  logs: LogItem[];
  currentNetworkStatus: {
    github: NetworkStatusItem;
    pip: NetworkStatusItem;
    huggingface: NetworkStatusItem;
  };
  checkingNetwork: boolean;
}

// 定义组件的 emits
interface Emits {
  (e: 'update:modelValue', value: boolean): void;
  (e: 'force-check'): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

// 计算属性
const show = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
});

// 事件处理
const onForceCheck = () => {
  emit('force-check');
};

const onClose = () => {
  emit('update:modelValue', false);
};

// 工具函数
const logIcon = (type: string): string => {
  switch(type) {
    case 'error': return 'error_outline';
    case 'success': return 'check_circle';
    case 'info': 
    default: return 'info_outline';
  }
};

const logColor = (type: string): string => {
  switch(type) {
    case 'error': return 'negative';
    case 'success': return 'positive';
    case 'info': 
    default: return 'info';
  }
};

const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString();
};
</script>

<style scoped>
.log-container {
  max-height: 400px;
  overflow-y: auto;
}

.log-list-border {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 8px;

}

.log-service {
  font-weight: bold;
  margin-right: 6px;
}

.network-check-buttons {
  /* margin-top: 16px; */
  text-align: right;
}

.ok-btn {
  min-width: 80px;
}

.no-margin-top {
  margin-top: 0;
}

.no-padding-top {
  padding-top: 0;
}
</style>
