import type { Cue, StudioDocument } from './types'

export interface CueFieldChange {
  field: string
  label: string
  before: string
  after: string
}

export interface CueDiff {
  id: string
  kind: 'added' | 'removed' | 'modified'
  cueKind: Cue['kind']
  beforeIndex: number
  afterIndex: number
  moved: boolean
  fields: CueFieldChange[]
  beforeHeadline: string
  afterHeadline: string
  beforeText: string
  afterText: string
}

export interface SceneDiff {
  id: string
  code: string
  title: string
  kind: 'added' | 'removed' | 'matched'
  addedCues: number
  removedCues: number
  modifiedCues: number
  cues: CueDiff[]
}

export interface VersionDiff {
  sceneAdded: number
  sceneRemoved: number
  cueAdded: number
  cueRemoved: number
  cueModified: number
  scenes: SceneDiff[]
}

interface FieldSpec {
  field: keyof Cue
  label: string
}

const FIELD_SPECS: FieldSpec[] = [
  { field: 'kind', label: '类型' },
  { field: 'characterId', label: '角色' },
  { field: 'text', label: '台词/说明' },
  { field: 'emotion', label: '情绪' },
  { field: 'rate', label: '语速' },
  { field: 'soundEffectId', label: '音效' },
  { field: 'transition', label: '转场' },
  { field: 'manualDuration', label: '时长(秒)' }
]

export function cueKindLabel(kind: Cue['kind']): string {
  return kind === 'dialogue' ? '台词' : kind === 'sfx' ? '音效' : '转场'
}

export function cueHeadline(cue: Cue, document: StudioDocument): string {
  if (cue.kind === 'dialogue') {
    return document.characters.find((item) => item.id === cue.characterId)?.name ?? '未指定角色'
  }
  if (cue.kind === 'sfx') {
    return document.soundEffects.find((item) => item.id === cue.soundEffectId)?.name ?? '缺失音效'
  }
  return '转场'
}

function rawValue(cue: Cue, field: keyof Cue, document: StudioDocument): string {
  const value = cue[field]
  if (value === undefined || value === '') return '—'
  if (field === 'characterId') return document.characters.find((item) => item.id === value)?.name ?? String(value)
  if (field === 'soundEffectId') return document.soundEffects.find((item) => item.id === value)?.name ?? String(value)
  if (field === 'rate') return `${value}×`
  if (field === 'kind') return cueKindLabel(value as Cue['kind'])
  return String(value)
}

function diffCue(before: Cue, after: Cue, beforeIndex: number, afterIndex: number, beforeDoc: StudioDocument, afterDoc: StudioDocument, moved: boolean): CueDiff {
  const fields: CueFieldChange[] = []
  for (const spec of FIELD_SPECS) {
    const oldValue = rawValue(before, spec.field, beforeDoc)
    const newValue = rawValue(after, spec.field, afterDoc)
    if (oldValue !== newValue) {
      fields.push({ field: spec.field, label: spec.label, before: oldValue, after: newValue })
    }
  }
  return {
    id: after.id,
    kind: 'modified',
    cueKind: after.kind,
    beforeIndex,
    afterIndex,
    moved,
    fields,
    beforeHeadline: cueHeadline(before, beforeDoc),
    afterHeadline: cueHeadline(after, afterDoc),
    beforeText: before.text,
    afterText: after.text
  }
}

/**
 * 判断两个均为交集的提示项序列中，哪些元素的相对位置真正发生了变化。
 * 删除导致的整体位移不算，只有相对顺序改变（拖动排序）才标记为移动。
 */
function detectMoves(oldIds: string[], newIds: string[]): Set<string> {
  const moved = new Set<string>()
  const survivors = new Set(newIds)
  const oldOrder = oldIds.filter((id) => survivors.has(id))
  const oldRank = new Map(oldOrder.map((id, index) => [id, index]))
  // 与任何其他幸存提示项的相对顺序发生翻转，即视为顺序调整。
  for (let i = 0; i < newIds.length; i += 1) {
    for (let j = i + 1; j < newIds.length; j += 1) {
      const rankI = oldRank.get(newIds[i])
      const rankJ = oldRank.get(newIds[j])
      if (rankI !== undefined && rankJ !== undefined && rankI > rankJ) {
        moved.add(newIds[i])
        moved.add(newIds[j])
      }
    }
  }
  return moved
}

/**
 * 对比旧版快照与当前草稿，按场次给出提示项的新增、删除与改动明细。
 */
export function diffDocuments(oldDoc: StudioDocument, currentDoc: StudioDocument): VersionDiff {
  const scenes: SceneDiff[] = []
  let sceneAdded = 0
  let sceneRemoved = 0
  let cueAdded = 0
  let cueRemoved = 0
  let cueModified = 0

  for (const scene of oldDoc.scenes) {
    const current = currentDoc.scenes.find((item) => item.id === scene.id)
    if (!current) {
      const cues: CueDiff[] = scene.cues.map((cue, index) => ({
        id: cue.id,
        kind: 'removed',
        cueKind: cue.kind,
        beforeIndex: index,
        afterIndex: -1,
        moved: false,
        fields: [],
        beforeHeadline: cueHeadline(cue, oldDoc),
        afterHeadline: '',
        beforeText: cue.text,
        afterText: ''
      }))
      sceneRemoved += 1
      cueRemoved += cues.length
      scenes.push({
        id: scene.id,
        code: scene.code,
        title: scene.title,
        kind: 'removed',
        addedCues: 0,
        removedCues: cues.length,
        modifiedCues: 0,
        cues
      })
      continue
    }

    const oldMap = new Map(scene.cues.map((cue, index) => [cue.id, { cue, index }]))
    const currentMap = new Map(current.cues.map((cue, index) => [cue.id, { cue, index }]))
    const cueDiffs: CueDiff[] = []
    const movedIds = detectMoves(
      scene.cues.map((cue) => cue.id),
      current.cues.map((cue) => cue.id)
    )

    for (const [id, entry] of currentMap) {
      if (!oldMap.has(id)) {
        cueDiffs.push({
          id,
          kind: 'added',
          cueKind: entry.cue.kind,
          beforeIndex: -1,
          afterIndex: entry.index,
          moved: false,
          fields: [],
          beforeHeadline: '',
          afterHeadline: cueHeadline(entry.cue, currentDoc),
          beforeText: '',
          afterText: entry.cue.text
        })
      }
    }
    for (const [id, entry] of oldMap) {
      const currentEntry = currentMap.get(id)
      if (!currentEntry) {
        cueDiffs.push({
          id,
          kind: 'removed',
          cueKind: entry.cue.kind,
          beforeIndex: entry.index,
          afterIndex: -1,
          moved: false,
          fields: [],
          beforeHeadline: cueHeadline(entry.cue, oldDoc),
          afterHeadline: '',
          beforeText: entry.cue.text,
          afterText: ''
        })
      } else {
        const diff = diffCue(entry.cue, currentEntry.cue, entry.index, currentEntry.index, oldDoc, currentDoc, movedIds.has(id))
        if (diff.fields.length || diff.moved) cueDiffs.push(diff)
      }
    }

    cueDiffs.sort((a, b) => {
      const aIndex = a.afterIndex >= 0 ? a.afterIndex : a.beforeIndex
      const bIndex = b.afterIndex >= 0 ? b.afterIndex : b.beforeIndex
      return aIndex - bIndex
    })

    const added = cueDiffs.filter((item) => item.kind === 'added').length
    const removed = cueDiffs.filter((item) => item.kind === 'removed').length
    const modified = cueDiffs.filter((item) => item.kind === 'modified').length
    cueAdded += added
    cueRemoved += removed
    cueModified += modified
    scenes.push({
      id: scene.id,
      code: current.code,
      title: current.title,
      kind: 'matched',
      addedCues: added,
      removedCues: removed,
      modifiedCues: modified,
      cues: cueDiffs
    })
  }

  for (const scene of currentDoc.scenes) {
    if (oldDoc.scenes.some((item) => item.id === scene.id)) continue
    const cues: CueDiff[] = scene.cues.map((cue, index) => ({
      id: cue.id,
      kind: 'added',
      cueKind: cue.kind,
      beforeIndex: -1,
      afterIndex: index,
      moved: false,
      fields: [],
      beforeHeadline: '',
      afterHeadline: cueHeadline(cue, currentDoc),
      beforeText: '',
      afterText: cue.text
    }))
    sceneAdded += 1
    cueAdded += cues.length
    scenes.push({
      id: scene.id,
      code: scene.code,
      title: scene.title,
      kind: 'added',
      addedCues: cues.length,
      removedCues: 0,
      modifiedCues: 0,
      cues
    })
  }

  return { sceneAdded, sceneRemoved, cueAdded, cueRemoved, cueModified, scenes }
}
