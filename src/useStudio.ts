import { computed, ref, watch } from 'vue'
import { sampleDocument } from './sample'
import type { Cue, CueDiff, CueFieldChange, CueKind, FrozenVersion, PendingChange, Scene, SceneDiff, StudioDocument, StudioState, WarningItem } from './types'

const STORAGE_KEY = 'sologsb-1016-studio-v1'
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

function loadState(): StudioState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as StudioState
      if (parsed.document?.scenes?.length) return parsed
    }
  } catch {
    // A corrupt local draft should not prevent access to the built-in example.
  }
  return {
    document: clone(sampleDocument),
    pending: [],
    frozen: [],
    updatedAt: new Date().toISOString()
  }
}

export function useStudio() {
  const state = ref<StudioState>(loadState())
  const selectedSceneId = ref(state.value.document.scenes[0]?.id ?? '')
  const selectedCueId = ref('')
  const selectedVersionId = ref('')
  const saveState = ref<'saved' | 'saving' | 'dirty'>('saved')
  const undoStack = ref<StudioDocument[]>([])
  const redoStack = ref<StudioDocument[]>([])
  let saveTimer: number | undefined

  const selectedScene = computed(() => state.value.document.scenes.find((scene) => scene.id === selectedSceneId.value) ?? state.value.document.scenes[0])

  function durationOfCue(cue: Cue): number {
    if (cue.manualDuration !== undefined) return cue.manualDuration
    if (cue.kind === 'sfx') {
      return state.value.document.soundEffects.find((effect) => effect.id === cue.soundEffectId)?.duration ?? 6
    }
    if (cue.kind === 'transition') return 3
    const pauses = (cue.text.match(/[，。！？；、…]/g)?.length ?? 0) * 0.22
    const effectiveRate = cue.rate || 1
    return Number((cue.text.length / (4.2 * effectiveRate) + pauses).toFixed(1))
  }

  function durationOfScene(scene: Scene): number {
    return Number(scene.cues.reduce((total, cue) => total + durationOfCue(cue), 0).toFixed(1))
  }

  const totalDuration = computed(() => state.value.document.scenes.reduce((total, scene) => total + durationOfScene(scene), 0))
  const pendingChanges = computed(() => state.value.pending.filter((item) => item.status === 'pending'))

  const warnings = computed<WarningItem[]>(() => {
    const result: WarningItem[] = []
    for (const scene of state.value.document.scenes) {
      const actorRoles = new Map<string, string[]>()
      for (const cue of scene.cues) {
        if (cue.kind === 'dialogue' && cue.characterId) {
          const character = state.value.document.characters.find((item) => item.id === cue.characterId)
          if (character) {
            const roles = actorRoles.get(character.voiceActor) ?? []
            roles.push(character.name)
            actorRoles.set(character.voiceActor, roles)
          }
        }
        if (cue.kind === 'sfx' && cue.soundEffectId && !state.value.document.soundEffects.some((effect) => effect.id === cue.soundEffectId)) {
          result.push({
            id: `missing-${cue.id}`,
            type: 'missing-sfx',
            level: 'error',
            sceneId: scene.id,
            cueId: cue.id,
            title: `${scene.code} 音效引用缺失`,
            detail: `“${cue.text}”引用了不存在的音效 ${cue.soundEffectId}。`
          })
        }
      }
      actorRoles.forEach((roles, actor) => {
        const uniqueRoles = [...new Set(roles)]
        if (uniqueRoles.length > 1) {
          result.push({
            id: `collision-${scene.id}-${actor}`,
            type: 'collision',
            level: 'error',
            sceneId: scene.id,
            title: `${scene.code} 角色撞场`,
            detail: `${actor} 同时为 ${uniqueRoles.join('、')} 配音；同场角色需拆分演员或调整台词。`
          })
        }
      })
      const sceneDuration = durationOfScene(scene)
      if (sceneDuration > scene.durationLimit) {
        result.push({
          id: `over-${scene.id}`,
          type: 'over-time',
          level: 'warning',
          sceneId: scene.id,
          title: `${scene.code} 超出场次限额`,
          detail: `预计 ${sceneDuration.toFixed(1)} 秒，限额 ${scene.durationLimit} 秒，超出 ${(sceneDuration - scene.durationLimit).toFixed(1)} 秒。`
        })
      }
    }
    return result
  })

  function persist() {
    state.value.updatedAt = new Date().toISOString()
    saveState.value = 'saving'
    window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.value))
      saveState.value = 'saved'
    }, 180)
  }

  function commit(label: string, mutator: (document: StudioDocument) => void, note = '') {
    const before = clone(state.value.document)
    const document = clone(state.value.document)
    mutator(document)
    undoStack.value.push(before)
    if (undoStack.value.length > 60) undoStack.value.shift()
    redoStack.value = []
    state.value.document = document
    state.value.pending.unshift({
      id: uid('change'),
      label,
      note,
      createdAt: new Date().toISOString(),
      status: 'pending',
      before,
      after: clone(document)
    })
    if (state.value.pending.length > 80) state.value.pending = state.value.pending.slice(0, 80)
    persist()
  }

  function replaceDocument(next: StudioDocument, label: string) {
    const before = clone(state.value.document)
    state.value.document = clone(next)
    state.value.pending.unshift({
      id: uid('change'),
      label,
      note: '',
      createdAt: new Date().toISOString(),
      status: 'pending',
      before,
      after: clone(next)
    })
    persist()
  }

  function updateProject(field: 'title' | 'subtitle' | 'targetDuration', value: string | number) {
    commit(`更新项目${field === 'title' ? '标题' : field === 'subtitle' ? '副标题' : '目标时长'}`, (document) => {
      if (field === 'targetDuration') document.targetDuration = Number(value)
      else document[field] = String(value)
    })
  }

  function updateScene(sceneId: string, field: keyof Scene, value: string | number) {
    commit(`更新 ${state.value.document.scenes.find((scene) => scene.id === sceneId)?.code ?? '场次'} ${field}`, (document) => {
      const scene = document.scenes.find((item) => item.id === sceneId)
      if (!scene) return
      if (field === 'durationLimit') scene.durationLimit = Number(value)
      else if (field === 'code' || field === 'title' || field === 'location' || field === 'timeOfDay' || field === 'transition') scene[field] = String(value)
    })
  }

  function updateCue(cueId: string, field: keyof Cue, value: string | number | undefined) {
    commit(`修改台词 ${state.value.document.scenes.flatMap((scene) => scene.cues).find((cue) => cue.id === cueId)?.text.slice(0, 12) ?? ''}`, (document) => {
      for (const scene of document.scenes) {
        const cue = scene.cues.find((item) => item.id === cueId)
        if (!cue) continue
        if (field === 'rate') cue.rate = Number(value) as Cue['rate']
        else if (field === 'manualDuration') cue.manualDuration = value === '' || value === undefined ? undefined : Number(value)
        else if (field === 'kind') cue.kind = value as CueKind
        else cue[field] = (value ?? '') as never
        break
      }
    })
  }

  function addScene() {
    const nextNumber = state.value.document.scenes.length + 1
    const id = uid('scene')
    commit(`新增场次 S${String(nextNumber).padStart(2, '0')}`, (document) => {
      document.scenes.push({
        id,
        code: `S${String(nextNumber).padStart(2, '0')}`,
        title: '未命名场次',
        location: '待填写',
        timeOfDay: '待填写',
        transition: '淡入',
        durationLimit: 150,
        cues: []
      })
    })
    selectedSceneId.value = id
  }

  function deleteScene(sceneId: string) {
    if (state.value.document.scenes.length <= 1) return
    const scene = state.value.document.scenes.find((item) => item.id === sceneId)
    commit(`删除场次 ${scene?.code ?? ''}`, (document) => {
      document.scenes = document.scenes.filter((item) => item.id !== sceneId)
    })
    selectedSceneId.value = state.value.document.scenes[0].id
  }

  function addCue(kind: CueKind, sceneId = selectedSceneId.value) {
    const id = uid('cue')
    commit(`新增${kind === 'dialogue' ? '台词' : kind === 'sfx' ? '音效' : '转场'}`, (document) => {
      const scene = document.scenes.find((item) => item.id === sceneId)
      if (!scene) return
      scene.cues.push({
        id,
        kind,
        characterId: kind === 'dialogue' ? document.characters[0]?.id : undefined,
        text: kind === 'dialogue' ? '请输入台词' : kind === 'sfx' ? '音效提示' : '转场说明',
        emotion: kind === 'dialogue' ? '自然' : '',
        rate: 1,
        soundEffectId: kind === 'sfx' ? document.soundEffects[0]?.id : undefined,
        transition: kind === 'transition' ? '淡出' : '',
        manualDuration: kind === 'transition' ? 3 : undefined
      })
    })
    selectedCueId.value = id
  }

  function deleteCue(cueId: string) {
    commit('删除提示项', (document) => {
      for (const scene of document.scenes) scene.cues = scene.cues.filter((cue) => cue.id !== cueId)
    })
  }

  function moveCue(sceneId: string, cueId: string, targetCueId: string) {
    if (cueId === targetCueId) return
    commit('拖动调整台词与音效顺序', (document) => {
      const scene = document.scenes.find((item) => item.id === sceneId)
      if (!scene) return
      const fromIndex = scene.cues.findIndex((cue) => cue.id === cueId)
      const toIndex = scene.cues.findIndex((cue) => cue.id === targetCueId)
      if (fromIndex < 0 || toIndex < 0) return
      const [moved] = scene.cues.splice(fromIndex, 1)
      scene.cues.splice(toIndex, 0, moved)
    })
  }

  function moveScene(sceneId: string, direction: -1 | 1) {
    const index = state.value.document.scenes.findIndex((scene) => scene.id === sceneId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= state.value.document.scenes.length) return
    commit('调整场次顺序', (document) => {
      const [scene] = document.scenes.splice(index, 1)
      document.scenes.splice(target, 0, scene)
    })
  }

  function acceptChange(changeId: string) {
    const change = state.value.pending.find((item) => item.id === changeId)
    if (!change || change.status !== 'pending') return
    change.status = 'accepted'
    persist()
  }

  function rejectChange(changeId: string) {
    const index = state.value.pending.findIndex((item) => item.id === changeId && item.status === 'pending')
    if (index < 0) return
    const change = state.value.pending[index]
    undoStack.value.push(clone(state.value.document))
    state.value.document = clone(change.before)
    for (let i = 0; i <= index; i += 1) {
      if (state.value.pending[i].status === 'pending') state.value.pending[i].status = 'rejected'
    }
    persist()
  }

  function acceptAll() {
    for (const change of state.value.pending) {
      if (change.status === 'pending') change.status = 'accepted'
    }
    persist()
  }

  function undo() {
    const previous = undoStack.value.pop()
    if (!previous) return
    redoStack.value.push(clone(state.value.document))
    replaceDocument(previous, '撤销上一步修改')
  }

  function redo() {
    const next = redoStack.value.pop()
    if (!next) return
    undoStack.value.push(clone(state.value.document))
    replaceDocument(next, '重做修改')
  }

  function freeze(name: string): FrozenVersion {
    const version: FrozenVersion = {
      id: uid('version'),
      name: name.trim() || `制作稿 v${state.value.frozen.length + 1}`,
      createdAt: new Date().toISOString(),
      document: clone(state.value.document),
      totalDuration: totalDuration.value
    }
    state.value.frozen.unshift(version)
    persist()
    return version
  }

  const kindLabels: Record<CueKind, string> = { dialogue: '台词', sfx: '音效', transition: '转场' }

  function describeCue(document: StudioDocument, cue: Cue) {
    if (cue.kind === 'dialogue') {
      const name = document.characters.find((character) => character.id === cue.characterId)?.name ?? '未指定角色'
      return { title: `台词｜${name}`, detail: `${cue.text}（${cue.emotion || '自然'} · 语速 ${cue.rate}×）` }
    }
    if (cue.kind === 'sfx') {
      const effect = document.soundEffects.find((item) => item.id === cue.soundEffectId)
      return { title: `音效｜${effect?.name ?? '缺失引用'}`, detail: cue.text }
    }
    return { title: `转场｜${cue.transition || '未设置'}`, detail: cue.text }
  }

  function formatCueField(document: StudioDocument, cue: Cue, field: keyof Cue): string {
    switch (field) {
      case 'kind':
        return kindLabels[cue.kind]
      case 'characterId':
        return document.characters.find((character) => character.id === cue.characterId)?.name ?? '未指定角色'
      case 'soundEffectId':
        return cue.soundEffectId ? document.soundEffects.find((item) => item.id === cue.soundEffectId)?.name ?? '缺失引用' : '未选择音效'
      case 'rate':
        return `${cue.rate}×`
      case 'manualDuration':
        return cue.manualDuration === undefined ? '自动' : `${cue.manualDuration} 秒`
      default: {
        const value = cue[field]
        return value === undefined || value === '' ? '（空）' : String(value)
      }
    }
  }

  const cueDiffFields: Array<{ field: keyof Cue; label: string }> = [
    { field: 'kind', label: '类型' },
    { field: 'characterId', label: '角色' },
    { field: 'text', label: '文本' },
    { field: 'emotion', label: '情绪' },
    { field: 'rate', label: '语速' },
    { field: 'soundEffectId', label: '音效素材' },
    { field: 'transition', label: '转场方式' },
    { field: 'manualDuration', label: '手动时长' }
  ]

  function diffCue(beforeDocument: StudioDocument, before: Cue, afterDocument: StudioDocument, after: Cue): CueFieldChange[] {
    const changes: CueFieldChange[] = []
    for (const { field, label } of cueDiffFields) {
      const oldValue = before[field] ?? ''
      const newValue = after[field] ?? ''
      if (oldValue !== newValue) {
        changes.push({ label, before: formatCueField(beforeDocument, before, field), after: formatCueField(afterDocument, after, field) })
      }
    }
    return changes
  }

  function diffVersion(version: FrozenVersion): SceneDiff[] {
    const beforeDocument = version.document
    const afterDocument = state.value.document
    const diffs: SceneDiff[] = []
    const beforeSceneMap = new Map(beforeDocument.scenes.map((scene) => [scene.id, scene]))

    for (const afterScene of afterDocument.scenes) {
      const beforeScene = beforeSceneMap.get(afterScene.id)
      if (!beforeScene) {
        diffs.push({
          sceneId: afterScene.id,
          code: afterScene.code,
          title: afterScene.title,
          sceneState: 'added',
          addedCount: afterScene.cues.length,
          removedCount: 0,
          modifiedCount: 0,
          cues: afterScene.cues.map((cue): CueDiff => ({ cueId: cue.id, state: 'added', ...describeCue(afterDocument, cue), changes: [] }))
        })
        continue
      }
      const beforeCueMap = new Map(beforeScene.cues.map((cue) => [cue.id, cue]))
      const afterCueIds = new Set(afterScene.cues.map((cue) => cue.id))
      const cues: CueDiff[] = []
      for (const cue of afterScene.cues) {
        const before = beforeCueMap.get(cue.id)
        if (!before) {
          cues.push({ cueId: cue.id, state: 'added', ...describeCue(afterDocument, cue), changes: [] })
        } else {
          const changes = diffCue(beforeDocument, before, afterDocument, cue)
          if (changes.length) cues.push({ cueId: cue.id, state: 'modified', ...describeCue(afterDocument, cue), changes })
        }
      }
      for (const cue of beforeScene.cues) {
        if (!afterCueIds.has(cue.id)) cues.push({ cueId: cue.id, state: 'removed', ...describeCue(beforeDocument, cue), changes: [] })
      }
      if (cues.length) {
        diffs.push({
          sceneId: afterScene.id,
          code: afterScene.code,
          title: afterScene.title,
          sceneState: 'kept',
          addedCount: cues.filter((cue) => cue.state === 'added').length,
          removedCount: cues.filter((cue) => cue.state === 'removed').length,
          modifiedCount: cues.filter((cue) => cue.state === 'modified').length,
          cues
        })
      }
    }

    const afterSceneIds = new Set(afterDocument.scenes.map((scene) => scene.id))
    for (const beforeScene of beforeDocument.scenes) {
      if (afterSceneIds.has(beforeScene.id)) continue
      diffs.push({
        sceneId: beforeScene.id,
        code: beforeScene.code,
        title: beforeScene.title,
        sceneState: 'removed',
        addedCount: 0,
        removedCount: beforeScene.cues.length,
        modifiedCount: 0,
        cues: beforeScene.cues.map((cue): CueDiff => ({ cueId: cue.id, state: 'removed', ...describeCue(beforeDocument, cue), changes: [] }))
      })
    }
    return diffs
  }

  function restoreVersion(version: FrozenVersion) {
    const lost = state.value.pending.filter((item) => item.status === 'pending').length
    for (const change of state.value.pending) {
      if (change.status === 'pending') change.status = 'rejected'
    }
    commit(`恢复版本「${version.name}」`, (document) => {
      Object.assign(document, clone(version.document))
    }, lost ? `同时退回 ${lost} 条未确认修改；撤销可回到恢复前的草稿。` : '撤销可回到恢复前的草稿。')
    selectedSceneId.value = state.value.document.scenes[0]?.id ?? ''
    selectedCueId.value = ''
  }

  function makeScript(document: StudioDocument): string {
    const lines = [
      document.title,
      document.subtitle,
      `目标时长：${document.targetDuration} 秒`,
      '='.repeat(48),
      ''
    ]
    document.scenes.forEach((scene, sceneIndex) => {
      lines.push(`${scene.code}｜${scene.title}`)
      lines.push(`场景：${scene.location} / ${scene.timeOfDay}`)
      lines.push(`转场：${scene.transition}`)
      lines.push(`场次限额：${scene.durationLimit} 秒｜预计：${durationOfScene(scene)} 秒`)
      lines.push('-'.repeat(34))
      scene.cues.forEach((cue, cueIndex) => {
        const prefix = `${String(cueIndex + 1).padStart(2, '0')} [${durationOfCue(cue).toFixed(1)}s]`
        if (cue.kind === 'dialogue') {
          const role = document.characters.find((character) => character.id === cue.characterId)?.name ?? '未指定角色'
          lines.push(`${prefix} ${role}｜${cue.emotion || '自然'}｜语速 ${cue.rate}`)
          lines.push(`    ${cue.text}`)
        } else if (cue.kind === 'sfx') {
          const effect = document.soundEffects.find((item) => item.id === cue.soundEffectId)
          lines.push(`${prefix} 音效｜${cue.text}`)
          lines.push(`    文件：${effect?.source ?? '缺失引用'}｜${effect?.note ?? '需补齐音效'}`)
        } else {
          lines.push(`${prefix} 转场｜${cue.transition}｜${cue.text}`)
        }
      })
      if (sceneIndex < document.scenes.length - 1) lines.push('')
    })
    return lines.join('\n')
  }

  function downloadVersion(version: FrozenVersion) {
    const blob = new Blob([makeScript(version.document)], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${version.document.title}-${version.name}.txt`.replace(/[\\/:*?"<>|]/g, '-')
    anchor.click()
    URL.revokeObjectURL(url)
  }

  function resetSample() {
    commit('恢复示例数据', (document) => {
      const next = clone(sampleDocument)
      Object.assign(document, next)
    })
    selectedSceneId.value = state.value.document.scenes[0]?.id ?? ''
  }

  watch(state, persist, { deep: true })

  return {
    state,
    selectedSceneId,
    selectedCueId,
    selectedVersionId,
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
    diffVersion,
    restoreVersion,
    downloadVersion,
    makeScript,
    resetSample,
    persist
  }
}
