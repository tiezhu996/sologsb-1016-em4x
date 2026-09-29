<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  NAlert,
  NButton,
  NConfigProvider,
  NEmpty,
  NFormItem,
  NInput,
  NInputNumber,
  NModal,
  NProgress,
  NScrollbar,
  NSelect,
  NSpace,
  NTabPane,
  NTabs,
  NTag
} from 'naive-ui'
import { useStudio } from './useStudio'
import type { Cue, CueKind, FrozenVersion, Rate } from './types'
import { cueKindLabel, diffDocuments } from './versionDiff'
import type { SceneDiff, VersionDiff } from './versionDiff'

const studio = useStudio()
const {
  state,
  selectedSceneId,
  selectedScene,
  totalDuration,
  pendingChanges,
  warnings,
  saveState,
  durationOfCue,
  durationOfScene,
  updateProject,
  updateScene,
  updateCue,
  addScene,
  deleteScene,
  addCue,
  deleteCue,
  moveCue,
  moveScene,
  acceptChange,
  rejectChange,
  acceptAll,
  undo,
  redo,
  freeze,
  restoreVersion,
  downloadVersion,
  resetSample
} = studio

const dragCueId = ref('')
const showFreezeModal = ref(false)
const freezeName = ref('')
const activeRightTab = ref('warnings')
const selectedVersionId = ref('')
const showDiffModal = ref(false)
const showRestoreModal = ref(false)
const diffSceneId = ref('')

const kindOptions = [
  { label: '台词', value: 'dialogue' },
  { label: '音效', value: 'sfx' },
  { label: '转场', value: 'transition' }
]
const rateOptions: Array<{ label: string; value: Rate }> = [
  { label: '慢 0.8×', value: 0.8 },
  { label: '偏慢 0.9×', value: 0.9 },
  { label: '标准 1.0×', value: 1 },
  { label: '偏快 1.1×', value: 1.1 },
  { label: '快 1.2×', value: 1.2 }
]
const characterOptions = computed(() => state.value.document.characters.map((item) => ({ label: `${item.name} / ${item.voiceActor}`, value: item.id })))
const effectOptions = computed(() => state.value.document.soundEffects.map((item) => ({ label: `${item.name} (${item.duration}s)`, value: item.id })))
const themeOverrides = {
  common: {
    primaryColor: '#73daca',
    primaryColorHover: '#8de7d9',
    primaryColorPressed: '#52b9aa',
    bodyColor: '#0d111b',
    cardColor: '#151b28',
    modalColor: '#171e2c',
    popoverColor: '#1b2332',
    textColorBase: '#e7edf7',
    borderColor: '#2b3445',
    borderRadius: '8px'
  },
  Input: { color: '#101621', colorFocus: '#101621', border: '1px solid #2b3445' },
  InputNumber: { color: '#101621', border: '1px solid #2b3445' },
  Card: { borderColor: '#252f40' },
  Tab: { tabTextColorActiveLine: '#73daca', barColor: '#73daca' }
}
const projectMinutes = computed(() => `${Math.floor(totalDuration.value / 60)}:${String(Math.round(totalDuration.value % 60)).padStart(2, '0')}`)
const pendingCount = computed(() => pendingChanges.value.length)
const warningCount = computed(() => warnings.value.length)
const saveLabel = computed(() => saveState.value === 'saved' ? '已保存到本机' : '正在保存…')

const selectedVersion = computed<FrozenVersion | undefined>(() => state.value.frozen.find((version) => version.id === selectedVersionId.value))
const versionDiff = computed<VersionDiff | null>(() => {
  if (!selectedVersion.value) return null
  return diffDocuments(selectedVersion.value.document, state.value.document)
})
const diffHasChanges = computed(() => {
  const diff = versionDiff.value
  if (!diff) return false
  return diff.sceneAdded > 0 || diff.sceneRemoved > 0 || diff.cueAdded > 0 || diff.cueRemoved > 0 || diff.cueModified > 0
})
const changedScenes = computed(() => versionDiff.value?.scenes.filter((scene) => scene.addedCues + scene.removedCues + scene.modifiedCues > 0) ?? [])
const activeDiffScene = computed<SceneDiff | undefined>(() => versionDiff.value?.scenes.find((scene) => scene.id === diffSceneId.value) ?? changedScenes.value[0])
const restorePendingChanges = computed(() => state.value.pending.filter((item) => item.status === 'pending'))

function toggleVersion(versionId: string) {
  selectedVersionId.value = selectedVersionId.value === versionId ? '' : versionId
}

function openDiffModal(sceneId?: string) {
  if (!selectedVersion.value) return
  diffSceneId.value = sceneId ?? changedScenes.value[0]?.id ?? ''
  showDiffModal.value = true
}

function openRestoreModal() {
  if (!selectedVersion.value) return
  showRestoreModal.value = true
}

function confirmRestore() {
  if (!selectedVersion.value) return
  restoreVersion(selectedVersion.value)
  showRestoreModal.value = false
  showDiffModal.value = false
  activeRightTab.value = 'pending'
}

function cueName(cue: Cue) {
  if (cue.kind === 'dialogue') return state.value.document.characters.find((item) => item.id === cue.characterId)?.name ?? '未指定角色'
  if (cue.kind === 'sfx') return state.value.document.soundEffects.find((item) => item.id === cue.soundEffectId)?.name ?? '缺失音效'
  return '转场'
}

function sceneStatus(sceneId: string) {
  return warnings.value.some((warning) => warning.sceneId === sceneId) ? 'warning' : 'ok'
}

function dropCue(targetId: string) {
  if (!dragCueId.value || !selectedScene.value) return
  moveCue(selectedScene.value.id, dragCueId.value, targetId)
  dragCueId.value = ''
}

function goToScene(sceneId: string) {
  selectedSceneId.value = sceneId
  document.querySelector('.editor-column')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function changeCueKind(cue: Cue, kind: CueKind) {
  updateCue(cue.id, 'kind', kind)
  if (kind === 'dialogue' && !cue.characterId) updateCue(cue.id, 'characterId', state.value.document.characters[0]?.id)
  if (kind === 'sfx' && !cue.soundEffectId) updateCue(cue.id, 'soundEffectId', state.value.document.soundEffects[0]?.id)
  if (kind === 'transition') updateCue(cue.id, 'transition', cue.transition || '淡出')
}

function openFreeze() {
  freezeName.value = `制作稿 v${state.value.frozen.length + 1}`
  showFreezeModal.value = true
}

function confirmFreeze() {
  const version = freeze(freezeName.value)
  showFreezeModal.value = false
  downloadVersion(version)
}

function onKeydown(event: KeyboardEvent) {
  const command = event.ctrlKey || event.metaKey
  if (command && event.key.toLowerCase() === 's') {
    event.preventDefault()
    studio.persist()
  }
  if (command && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    event.shiftKey ? redo() : undo()
  }
  if (command && event.key.toLowerCase() === 'y') {
    event.preventDefault()
    redo()
  }
  if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && selectedScene.value) {
    event.preventDefault()
    moveScene(selectedScene.value.id, event.key === 'ArrowUp' ? -1 : 1)
  }
  if (event.key === '[' || event.key === ']') {
    const index = state.value.document.scenes.findIndex((scene) => scene.id === selectedScene.value?.id)
    const next = event.key === '[' ? index - 1 : index + 1
    if (state.value.document.scenes[next]) selectedSceneId.value = state.value.document.scenes[next].id
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <n-config-provider :theme-overrides="themeOverrides">
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark">声</div>
          <div>
            <strong>声场制作台</strong>
            <span>RADIO DRAMA STUDIO</span>
          </div>
        </div>
        <div class="project-fields">
          <n-input :value="state.document.title" aria-label="项目标题" @update:value="updateProject('title', $event)" />
          <n-input :value="state.document.subtitle" aria-label="项目副标题" @update:value="updateProject('subtitle', $event)" />
        </div>
        <div class="top-actions">
          <span class="save-state">{{ saveLabel }}</span>
          <n-button quaternary @click="undo">撤销 ⌘Z</n-button>
          <n-button quaternary @click="redo">重做 ⇧⌘Z</n-button>
          <n-button type="primary" @click="openFreeze">冻结并导出</n-button>
        </div>
      </header>

      <section class="summary-strip">
        <div class="metric">
          <span>预计总时长</span>
          <strong>{{ projectMinutes }}</strong>
          <small>{{ totalDuration.toFixed(1) }} / {{ state.document.targetDuration }} 秒</small>
        </div>
        <div class="target-control">
          <n-progress
            type="line"
            :percentage="Math.min(100, Number(((totalDuration / state.document.targetDuration) * 100).toFixed(1)))"
            :height="8"
            :show-indicator="false"
            :status="totalDuration > state.document.targetDuration ? 'error' : 'success'"
          />
          <n-input-number
            :value="state.document.targetDuration"
            size="small"
            :min="30"
            :step="10"
            @update:value="updateProject('targetDuration', $event ?? 0)"
          >
            <template #suffix>秒目标</template>
          </n-input-number>
        </div>
        <div class="metric compact">
          <span>场次</span><strong>{{ state.document.scenes.length }}</strong>
        </div>
        <div class="metric compact">
          <span>待确认</span><strong class="accent">{{ pendingCount }}</strong>
        </div>
        <div class="metric compact">
          <span>检查项</span><strong :class="{ danger: warningCount }">{{ warningCount }}</strong>
        </div>
      </section>

      <main class="workspace">
        <aside class="scene-sidebar">
          <div class="panel-heading">
            <div>
              <span class="eyebrow">PLAYLIST</span>
              <h2>场次结构</h2>
            </div>
            <n-button circle secondary aria-label="新增场次" @click="addScene">＋</n-button>
          </div>
          <div class="scene-list">
            <button
              v-for="(scene, index) in state.document.scenes"
              :key="scene.id"
              class="scene-item"
              :class="{ active: scene.id === selectedSceneId, warning: sceneStatus(scene.id) === 'warning' }"
              @click="selectedSceneId = scene.id"
            >
              <span class="scene-index">{{ String(index + 1).padStart(2, '0') }}</span>
              <span class="scene-copy">
                <strong>{{ scene.code }} · {{ scene.title }}</strong>
                <small>{{ scene.location }} / {{ scene.timeOfDay }}</small>
              </span>
              <span class="scene-duration">{{ durationOfScene(scene).toFixed(0) }}s</span>
            </button>
          </div>
          <div class="sidebar-tip">
            <strong>键盘工作流</strong>
            <span>[ / ] 切换场次</span>
            <span>Alt + ↑ / ↓ 调整顺序</span>
            <span>⌘S 立即保存 · ⌘Z 撤销</span>
          </div>
          <n-button block quaternary @click="resetSample">恢复示例数据</n-button>
        </aside>

        <section v-if="selectedScene" class="editor-column">
          <div class="scene-title-row">
            <div>
              <span class="eyebrow">SCENE {{ selectedScene.code }}</span>
              <input class="title-input" :value="selectedScene.title" aria-label="场次标题" @change="updateScene(selectedScene.id, 'title', ($event.target as HTMLInputElement).value)" />
            </div>
            <div class="scene-order-actions">
              <n-button size="small" secondary @click="moveScene(selectedScene.id, -1)">上移</n-button>
              <n-button size="small" secondary @click="moveScene(selectedScene.id, 1)">下移</n-button>
              <n-button size="small" type="error" tertiary @click="deleteScene(selectedScene.id)">删除场次</n-button>
            </div>
          </div>

          <div class="scene-meta-grid">
            <n-form-item label="场次号"><n-input :value="selectedScene.code" @update:value="updateScene(selectedScene.id, 'code', $event)" /></n-form-item>
            <n-form-item label="空间"><n-input :value="selectedScene.location" @update:value="updateScene(selectedScene.id, 'location', $event)" /></n-form-item>
            <n-form-item label="时间"><n-input :value="selectedScene.timeOfDay" @update:value="updateScene(selectedScene.id, 'timeOfDay', $event)" /></n-form-item>
            <n-form-item label="场次限额（秒）"><n-input-number :value="selectedScene.durationLimit" :min="5" :step="5" @update:value="updateScene(selectedScene.id, 'durationLimit', $event ?? 0)" /></n-form-item>
            <n-form-item label="场次转场" class="span-2"><n-input :value="selectedScene.transition" @update:value="updateScene(selectedScene.id, 'transition', $event)" /></n-form-item>
          </div>

          <div class="timeline-heading">
            <div>
              <span class="eyebrow">TIMELINE</span>
              <h3>台词与声音提示</h3>
            </div>
            <div class="add-actions">
              <n-button size="small" type="primary" secondary @click="addCue('dialogue')">＋ 台词</n-button>
              <n-button size="small" secondary @click="addCue('sfx')">＋ 音效</n-button>
              <n-button size="small" secondary @click="addCue('transition')">＋ 转场</n-button>
            </div>
          </div>

          <div class="cue-list">
            <article
              v-for="(cue, index) in selectedScene.cues"
              :key="cue.id"
              class="cue-card"
              :class="[`kind-${cue.kind}`, { dragging: dragCueId === cue.id }]"
              draggable="true"
              @dragstart="dragCueId = cue.id"
              @dragend="dragCueId = ''"
              @dragover.prevent
              @drop="dropCue(cue.id)"
            >
              <div class="cue-grip" title="拖动调整顺序">⋮⋮</div>
              <div class="cue-main">
                <div class="cue-topline">
                  <span class="cue-number">{{ String(index + 1).padStart(2, '0') }}</span>
                  <n-select class="kind-select" size="small" :value="cue.kind" :options="kindOptions" @update:value="changeCueKind(cue, $event)" />
                  <n-tag size="small" :bordered="false">{{ cueName(cue) }}</n-tag>
                  <span class="duration-pill">{{ durationOfCue(cue).toFixed(1) }}s</span>
                  <n-button size="tiny" tertiary type="error" @click="deleteCue(cue.id)">删除</n-button>
                </div>

                <div v-if="cue.kind === 'dialogue'" class="cue-grid">
                  <n-select :value="cue.characterId" :options="characterOptions" placeholder="选择角色" @update:value="updateCue(cue.id, 'characterId', $event)" />
                  <n-input :value="cue.emotion" placeholder="情绪与表演提示" @update:value="updateCue(cue.id, 'emotion', $event)" />
                  <n-select :value="cue.rate" :options="rateOptions" @update:value="updateCue(cue.id, 'rate', $event)" />
                  <n-input-number :value="cue.manualDuration" clearable placeholder="自动" :min="0.5" :step="0.5" @update:value="updateCue(cue.id, 'manualDuration', $event ?? undefined)">
                    <template #suffix>手动秒</template>
                  </n-input-number>
                  <n-input class="span-4" type="textarea" :autosize="{ minRows: 2, maxRows: 5 }" :value="cue.text" @update:value="updateCue(cue.id, 'text', $event)" />
                </div>

                <div v-else-if="cue.kind === 'sfx'" class="cue-grid">
                  <n-select :value="cue.soundEffectId" :options="effectOptions" filterable placeholder="选择音效" @update:value="updateCue(cue.id, 'soundEffectId', $event)" />
                  <n-input :value="cue.text" placeholder="声音动作说明" @update:value="updateCue(cue.id, 'text', $event)" />
                  <n-input-number :value="cue.manualDuration" clearable placeholder="使用素材时长" :min="0.2" :step="0.5" @update:value="updateCue(cue.id, 'manualDuration', $event ?? undefined)">
                    <template #suffix>覆盖秒数</template>
                  </n-input-number>
                </div>

                <div v-else class="cue-grid">
                  <n-input :value="cue.transition" placeholder="转场方式" @update:value="updateCue(cue.id, 'transition', $event)" />
                  <n-input :value="cue.text" placeholder="转场说明" @update:value="updateCue(cue.id, 'text', $event)" />
                  <n-input-number :value="cue.manualDuration" :min="0" :step="0.5" @update:value="updateCue(cue.id, 'manualDuration', $event ?? undefined)">
                    <template #suffix>秒</template>
                  </n-input-number>
                </div>
              </div>
            </article>
            <n-empty v-if="!selectedScene.cues.length" description="这场还没有声音提示">
              <template #extra><n-button @click="addCue('dialogue')">添加第一条台词</n-button></template>
            </n-empty>
          </div>
        </section>

        <aside class="review-column">
          <div class="review-heading">
            <div>
              <span class="eyebrow">REVIEW DESK</span>
              <h2>导演确认区</h2>
            </div>
            <n-button v-if="pendingCount" size="small" type="primary" secondary @click="acceptAll">全部接受</n-button>
          </div>
          <n-tabs v-model:value="activeRightTab" type="line" animated>
            <n-tab-pane name="warnings" :tab="`检查 ${warningCount}`">
              <div class="review-list">
                <div v-for="warning in warnings" :key="warning.id" class="warning-card" :class="warning.level">
                  <div class="warning-title">
                    <n-tag size="small" :type="warning.level === 'error' ? 'error' : 'warning'" :bordered="false">{{ warning.type === 'collision' ? '撞场' : warning.type === 'missing-sfx' ? '引用' : '时长' }}</n-tag>
                    <strong>{{ warning.title }}</strong>
                  </div>
                  <p>{{ warning.detail }}</p>
                  <n-button size="tiny" quaternary @click="goToScene(warning.sceneId)">定位到 {{ state.document.scenes.find((scene) => scene.id === warning.sceneId)?.code }}</n-button>
                </div>
                <n-empty v-if="!warnings.length" description="当前没有连续性问题" />
              </div>
            </n-tab-pane>

            <n-tab-pane name="pending" :tab="`待确认 ${pendingCount}`">
              <div class="pending-toolbar">
                <n-alert type="info" :show-icon="false">每次编辑都会形成草稿记录。退回较早记录时，其上方尚未确认的草稿会一并撤销。</n-alert>
              </div>
              <div class="review-list">
                <div v-for="change in state.pending.filter((item) => item.status === 'pending')" :key="change.id" class="pending-card">
                  <div class="pending-meta">
                    <strong>{{ change.label }}</strong>
                    <span>{{ new Date(change.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }}</span>
                  </div>
                  <p v-if="change.note">{{ change.note }}</p>
                  <div class="pending-actions">
                    <n-button size="small" type="primary" @click="acceptChange(change.id)">接受</n-button>
                    <n-button size="small" tertiary type="warning" @click="rejectChange(change.id)">退回</n-button>
                  </div>
                </div>
                <n-empty v-if="!pendingCount" description="所有修改都已确认" />
              </div>
            </n-tab-pane>

            <n-tab-pane name="versions" :tab="`冻结 ${state.frozen.length}`">
              <div class="review-list">
                <div v-for="version in state.frozen" :key="version.id" class="version-card selectable" :class="{ active: version.id === selectedVersionId }">
                  <div class="version-head" @click="toggleVersion(version.id)">
                    <div class="version-info">
                      <div class="version-title-line">
                        <strong>{{ version.name }}</strong>
                        <n-tag size="tiny" :bordered="false">只读快照</n-tag>
                        <n-tag v-if="version.id === selectedVersionId" size="tiny" type="info" :bordered="false">已选中</n-tag>
                      </div>
                      <span>{{ new Date(version.createdAt).toLocaleString('zh-CN') }}</span>
                      <small>{{ version.document.scenes.length }} 场 · {{ version.totalDuration.toFixed(1) }} 秒</small>
                    </div>
                    <n-button size="small" type="primary" secondary @click.stop="downloadVersion(version)">导出稿</n-button>
                  </div>

                  <template v-if="version.id === selectedVersionId && versionDiff">
                    <div class="diff-summary">
                      <span class="diff-summary-label">对比当前草稿</span>
                      <n-tag size="small" type="success" :bordered="false">新增提示 {{ versionDiff.cueAdded }}</n-tag>
                      <n-tag size="small" type="error" :bordered="false">删除提示 {{ versionDiff.cueRemoved }}</n-tag>
                      <n-tag size="small" type="warning" :bordered="false">改动 {{ versionDiff.cueModified }}</n-tag>
                      <n-tag v-if="versionDiff.sceneAdded" size="small" type="success" :bordered="false">新增场次 {{ versionDiff.sceneAdded }}</n-tag>
                      <n-tag v-if="versionDiff.sceneRemoved" size="small" type="error" :bordered="false">删除场次 {{ versionDiff.sceneRemoved }}</n-tag>
                      <span v-if="!diffHasChanges" class="diff-clean">草稿与该版本一致，没有差异</span>
                    </div>

                    <div v-if="diffHasChanges" class="scene-diff-list">
                      <button
                        v-for="scene in versionDiff.scenes.filter((item) => item.addedCues + item.removedCues + item.modifiedCues > 0)"
                        :key="scene.id"
                        class="scene-diff-row"
                        :class="`scene-${scene.kind}`"
                        @click="openDiffModal(scene.id)"
                      >
                        <strong>{{ scene.code }} · {{ scene.title }}</strong>
                        <span class="scene-diff-counts">
                          <em v-if="scene.kind === 'added'" class="added">整场新增</em>
                          <em v-else-if="scene.kind === 'removed'" class="removed">整场已删除</em>
                          <template v-else>
                            <em v-if="scene.addedCues" class="added">+{{ scene.addedCues }}</em>
                            <em v-if="scene.removedCues" class="removed">-{{ scene.removedCues }}</em>
                            <em v-if="scene.modifiedCues" class="changed">改 {{ scene.modifiedCues }}</em>
                          </template>
                        </span>
                        <small>查看前后内容 ›</small>
                      </button>
                    </div>

                    <div class="version-actions">
                      <n-button size="small" secondary :disabled="!diffHasChanges" @click="openDiffModal()">对比当前草稿</n-button>
                      <n-button size="small" type="warning" secondary @click="openRestoreModal">恢复到此版本</n-button>
                    </div>
                  </template>
                </div>
                <n-empty v-if="!state.frozen.length" description="冻结后生成只读制作稿" />
              </div>
            </n-tab-pane>
          </n-tabs>
        </aside>
      </main>
    </div>

    <n-modal v-model:show="showFreezeModal">
      <div class="dialog-card">
        <span class="eyebrow">FREEZE VERSION</span>
        <h2>冻结当前版本</h2>
        <p>冻结会保存一份不可变快照，并立即下载纯文本制作稿。当前草稿仍可继续编辑。</p>
        <n-input v-model:value="freezeName" placeholder="版本名称" @keyup.enter="confirmFreeze" />
        <div class="dialog-actions">
          <n-button @click="showFreezeModal = false">取消</n-button>
          <n-button type="primary" @click="confirmFreeze">冻结并导出</n-button>
        </div>
      </div>
    </n-modal>

    <n-modal v-model:show="showRestoreModal">
      <div class="dialog-card">
        <span class="eyebrow">RESTORE VERSION</span>
        <h2>恢复到「{{ selectedVersion?.name }}」</h2>
        <p>
          草稿将整体回到该冻结版本的内容；冻结版本本身保持只读，不会被修改。
          恢复操作本身会生成一条新的待确认记录，并且可以撤销回到恢复前的状态。
        </p>
        <n-alert v-if="restorePendingChanges.length" type="warning" title="以下未确认修改将会丢失">
          <ul class="lost-changes">
            <li v-for="change in restorePendingChanges" :key="change.id">
              <strong>{{ change.label }}</strong>
              <span>{{ new Date(change.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }}</span>
            </li>
          </ul>
        </n-alert>
        <n-alert v-else type="info" :show-icon="false">当前没有未确认修改，可以直接恢复。</n-alert>
        <div class="dialog-actions">
          <n-button @click="showRestoreModal = false">取消</n-button>
          <n-button type="warning" @click="confirmRestore">确认恢复</n-button>
        </div>
      </div>
    </n-modal>

    <n-modal v-model:show="showDiffModal">
      <div class="diff-dialog">
        <header class="diff-dialog-head">
          <div>
            <span class="eyebrow">VERSION DIFF</span>
            <h2>「{{ selectedVersion?.name }}」对比当前草稿</h2>
          </div>
          <n-button size="small" quaternary @click="showDiffModal = false">关闭 ✕</n-button>
        </header>

        <div v-if="versionDiff" class="diff-totals">
          <n-tag size="small" type="success" :bordered="false">新增提示 {{ versionDiff.cueAdded }}</n-tag>
          <n-tag size="small" type="error" :bordered="false">删除提示 {{ versionDiff.cueRemoved }}</n-tag>
          <n-tag size="small" type="warning" :bordered="false">改动 {{ versionDiff.cueModified }}</n-tag>
          <n-tag v-if="versionDiff.sceneAdded" size="small" type="success" :bordered="false">新增场次 {{ versionDiff.sceneAdded }}</n-tag>
          <n-tag v-if="versionDiff.sceneRemoved" size="small" type="error" :bordered="false">删除场次 {{ versionDiff.sceneRemoved }}</n-tag>
        </div>

        <div v-if="changedScenes.length > 1" class="diff-scene-tabs">
          <button
            v-for="scene in changedScenes"
            :key="scene.id"
            class="diff-scene-tab"
            :class="{ active: scene.id === activeDiffScene?.id }"
            @click="diffSceneId = scene.id"
          >
            {{ scene.code }}
            <em v-if="scene.kind === 'added'" class="added">新增</em>
            <em v-else-if="scene.kind === 'removed'" class="removed">删除</em>
            <template v-else>
              <em v-if="scene.addedCues" class="added">+{{ scene.addedCues }}</em>
              <em v-if="scene.removedCues" class="removed">-{{ scene.removedCues }}</em>
              <em v-if="scene.modifiedCues" class="changed">{{ scene.modifiedCues }}</em>
            </template>
          </button>
        </div>

        <n-scrollbar class="diff-body">
          <section v-if="activeDiffScene" class="diff-scene">
            <h3>
              {{ activeDiffScene.code }} · {{ activeDiffScene.title }}
              <n-tag v-if="activeDiffScene.kind === 'added'" size="small" type="success" :bordered="false">整场新增</n-tag>
              <n-tag v-else-if="activeDiffScene.kind === 'removed'" size="small" type="error" :bordered="false">整场已删除</n-tag>
            </h3>

            <div v-for="cue in activeDiffScene.cues" :key="cue.id" class="cue-diff" :class="`diff-${cue.kind}`">
              <div class="cue-diff-head">
                <n-tag size="tiny" :type="cue.kind === 'added' ? 'success' : cue.kind === 'removed' ? 'error' : 'warning'" :bordered="false">
                  {{ cue.kind === 'added' ? '新增' : cue.kind === 'removed' ? '删除' : '改动' }}
                </n-tag>
                <n-tag size="tiny" :bordered="false">{{ cueKindLabel(cue.cueKind) }}</n-tag>
                <strong v-if="cue.kind === 'added'">#{{ cue.afterIndex + 1 }} {{ cue.afterHeadline }}</strong>
                <strong v-else-if="cue.kind === 'removed'">#{{ cue.beforeIndex + 1 }} {{ cue.beforeHeadline }}</strong>
                <strong v-else>
                  #{{ cue.beforeIndex + 1 }}<span v-if="cue.moved" class="moved-mark"> → #{{ cue.afterIndex + 1 }} 顺序调整</span>
                  <template v-else> → #{{ cue.afterIndex + 1 }}</template>
                  {{ cue.beforeHeadline !== cue.afterHeadline ? `${cue.beforeHeadline} → ${cue.afterHeadline}` : cue.afterHeadline }}
                </strong>
              </div>

              <template v-if="cue.kind !== 'modified'">
                <div class="diff-pane diff-before">
                  <span class="diff-pane-label">旧版内容</span>
                  <p>{{ cue.beforeText || '—' }}</p>
                </div>
                <div class="diff-pane diff-after">
                  <span class="diff-pane-label">当前草稿</span>
                  <p>{{ cue.afterText || '—' }}</p>
                </div>
              </template>

              <template v-else>
                <div v-for="field in cue.fields" :key="field.field" class="field-diff">
                  <span class="field-label">{{ field.label }}</span>
                  <div class="field-values">
                    <span class="field-before">{{ field.before }}</span>
                    <span class="field-arrow">→</span>
                    <span class="field-after">{{ field.after }}</span>
                  </div>
                </div>
                <p v-if="!cue.fields.length" class="reorder-note">内容未变，仅在时间轴上的位置发生调整。</p>
              </template>
            </div>
          </section>
        </n-scrollbar>

        <footer class="diff-dialog-foot">
          <n-button @click="showDiffModal = false">关闭</n-button>
          <n-button type="warning" secondary @click="showDiffModal = false; showRestoreModal = true">恢复到此版本</n-button>
        </footer>
      </div>
    </n-modal>
  </n-config-provider>
</template>
