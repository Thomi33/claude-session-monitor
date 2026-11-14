import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Agent, Ctx, Info, Limit } from '../types'

const PANE = 'session-monitor'
const TITLE = 'Monitor'

const limits = atom({ plugin: 'session-monitor', key: 'limits' } as const, [] as Limit[], { shape: 'limits-1' })
const context = atom({ plugin: 'session-monitor', key: 'context' } as const, null as Ctx | null, { shape: 'ctx-1' })
const cost = atom({ plugin: 'session-monitor', key: 'cost' } as const, null as number | null, { shape: 'cost-1' })
const info = atom({ plugin: 'session-monitor', key: 'info' } as const, { model: '…' } as Info, { shape: 'info-1' })
const agents = atom({ plugin: 'session-monitor', key: 'agents' } as const, [] as Agent[], { shape: 'agents-1' })
const compacting = atom({ plugin: 'session-monitor', key: 'compacting' } as const, false, { shape: 'compacting-1' })
const agentModel = atom({ plugin: 'session-monitor', key: 'agentModel' } as const, 'inherit', { shape: 'agentModel-1' })
const switching = atom({ plugin: 'session-monitor', key: 'switching' } as const, false, { shape: 'switching-1' })

const MODELS = [
  { value: 'claude-opus-5-5', label: 'Opus 5.5', family: 'opus' },
  { value: 'claude-sonnet-5-5', label: 'Sonnet 5.5', family: 'sonnet' },
  { value: 'claude-haiku-5-5', label: 'Haiku 5.5', family: 'haiku' },
  { value: 'claude-fable-5-2', label: 'Fable 5.2', family: 'fable' },
]
const familyOf = (model: string) => MODELS.find(m => model.toLowerCase().includes(m.family))?.family
const labelOf = (model: string) => MODELS.find(m => m.family === familyOf(model))?.label ?? model

const LIMIT_NAMES: Record<string, string> = {
  five_hour: 'Sesión (5 h)',
  seven_day: 'Semanal (7 d)',
  seven_day_opus: 'Semanal Opus',
  seven_day_sonnet: 'Semanal Sonnet',
  seven_day_fable: 'Semanal Fable',
  spend_limit: 'Gasto',
}

const fmtTokens = (n?: number) =>
  n === undefined ? '—' : n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : `${n}`

const color = (pct: number) => (pct >= 85 ? 'red' : pct >= 60 ? 'yellow' : 'green')

function fmtReset(iso?: string): string {
  if (!iso) return ''
  const ms = Date.parse(iso) - Date.now()
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  return h >= 24 ? `reinicia en ${Math.floor(h / 24)}d ${h % 24}h` : `reinicia en ${h}h ${m}m`
}

const BAR = 22
const Bar = ({ Text, pct, tone }: { Text: any; pct: number; tone: string }) => {
  const n = Math.max(0, Math.min(BAR, Math.round((Math.min(100, Math.max(0, pct)) / 100) * BAR)))
  return (
    <Text>
      <Text color={tone}>{'█'.repeat(n)}</Text>
      <Text dimColor>{'░'.repeat(BAR - n)}</Text>
    </Text>
  )
}

async function refreshModel($: EngineInterface) {
  const model = await $.session.model()
  const old = await read($, info)
  if (model && old.model !== model) await update($, info, o => ({ ...o, model }))
}

const ACTIVE = new Set(['pending', 'running', 'waiting'])

async function refreshUsage($: EngineInterface) {
  const u = await $.session.usage()
  await update($, limits, () => u.rateLimits.map((l: Limit) => ({ ...l })))
  await update($, context, () => ({ tokens: u.context.tokens, window: u.context.window, percent: u.context.percent }))
  await update($, cost, () => u.cost?.usd ?? null)
}

async function refreshAgents($: EngineInterface) {
  const list = await $.agent.list()
  const next: Agent[] = list.map((a: { id: string; description: string; type: string; status: string }) => ({ id: a.id, description: a.description, type: a.type, status: a.status }))
  const prev = await read($, agents)
  if (JSON.stringify(prev) !== JSON.stringify(next)) await update($, agents, () => next)
}


export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const ran = await next(e)
    await $.command.register({ name: 'monitor', description: 'Abre el panel Monitor (cuota, modelo, contexto)' })
    const model = await $.session.model()
    const effort = (await $.settings.read({ key: 'effortLevel' })) as string | undefined
    await update($, info, old => ({ model, effort: old.effort ?? effort }))
    await refreshUsage($).catch(() => {})
    await refreshAgents($).catch(() => {})
    $.clock.every(2000, () => {
      void refreshAgents($).catch(() => {})
      void refreshModel($).catch(() => {})
    })
    void $.ui.open({ id: PANE, title: TITLE })
    return ran
  })

  on('command.run', { command: 'monitor' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Panel Monitor abierto.' }
  })

  on('session.measure', async ($, e, next) => {
    await update($, limits, () => e.rateLimits.map(l => ({ ...l })))
    await update($, context, () => ({ tokens: e.context.tokens, window: e.context.window, percent: e.context.percent }))
    await update($, cost, () => e.cost?.usd ?? null)
    void refreshModel($).catch(() => {})
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      const effort = e.effort === undefined ? undefined : String(e.effort)
      const old = await read($, info)
      if (old.model !== e.model || old.effort !== effort) {
        await update($, info, () => ({ model: e.model, effort }))
      }
    }
    return yield* next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    void refreshAgents($).catch(() => {})
    return r
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined) void refreshAgents($).catch(() => {})
    else void refreshUsage($).catch(() => {})
    return r
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Select, Input } = $.ui.resolve(e)
    const ls = await read($, limits)
    const ctx = await read($, context)
    const usd = await read($, cost)
    const inf = await read($, info)
    const ags = await read($, agents)
    const busy = await read($, compacting)
    const active = ags.filter(a => ACTIVE.has(a.status))
    const aModel = await read($, agentModel)
    const isSwitching = await read($, switching)
    const fam = familyOf(inf.model)
    const isFable = fam === 'fable'
    const fableLimits = ls.filter(l => l.kind.includes('fable'))
    const shownLimits = ls.filter(l => !l.kind.includes('fable') || isFable)
    const curValue = MODELS.find(m => m.family === fam)?.value ?? inf.model

    const switchModel = async (value: string) => {
      if (value === curValue || (await read($, switching))) return
      await update($, switching, () => true)
      try {
        await $.command.run({ command: 'model', args: value })
        await refreshModel($).catch(() => {})
        await refreshUsage($).catch(() => {})
        $.ui.toast(`Modelo: ${labelOf(value)}`)
      } catch {
        $.ui.toast('No se pudo cambiar el modelo ahora. Probá al terminar el turno.')
      } finally {
        await update($, switching, () => false)
      }
    }

    const spawnAgent = async (task: string) => {
      const prompt = task.trim()
      if (prompt === '') return
      const model = await read($, agentModel)
      const description = prompt.length > 40 ? `${prompt.slice(0, 39)}…` : prompt
      try {
        const r = await $.agent.spawn({
          prompt,
          description,
          subagentType: 'general-purpose',
          ...(model === 'inherit' ? {} : { model }),
        })
        if ('deny' in r && r.deny) $.ui.toast(`Agente rechazado: ${String(r.deny)}`)
        else $.ui.toast(`Agente lanzado (${labelOf(('model' in r && r.model) || (model === 'inherit' ? inf.model : model))})`)
      } catch (err) {
        $.ui.toast(`No se pudo lanzar el agente: ${String(err)}`)
      }
      void refreshAgents($).catch(() => {})
    }

    const doCompact = async () => {
      if (await read($, compacting)) return
      await update($, compacting, () => true)
      try {
        const r = await $.session.compact()
        if (r && 'skip' in r && r.skip) $.ui.toast(`Compactación omitida: ${r.skip}`)
        else $.ui.toast('Contexto compactado.')
        await refreshUsage($).catch(() => {})
      } catch {
        $.ui.toast('No se puede compactar mientras Claude está trabajando. Probá al terminar el turno.')
      } finally {
        await update($, compacting, () => false)
      }
    }

    const ctxPct = ctx?.percent
    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>Cuota</Text>
          {shownLimits.length === 0 && <Text dimColor>Sin datos aún (aparece tras la primera respuesta, solo en suscripción).</Text>}
          {shownLimits.map(l => (
            <Box flexDirection="column">
              <Text>
                {LIMIT_NAMES[l.kind] ?? l.kind}: <Text bold color={color(l.percentUsed)}>{l.percentUsed}%</Text>
              </Text>
              <Bar Text={Text} pct={l.percentUsed} tone={color(l.percentUsed)} />
              {fmtReset(l.resetsAt) !== '' && <Text dimColor>{fmtReset(l.resetsAt)}</Text>}
            </Box>
          ))}
          {isFable && fableLimits.length === 0 && <Text dimColor>Semanal Fable: sin datos aún (aparece tras una respuesta con Fable)</Text>}
          {usd !== null && <Text dimColor>Costo sesión: ${usd.toFixed(2)}</Text>}
        </Box>

        <Box flexDirection="column">
          <Text bold>Modelo</Text>
          <Text>
            {labelOf(inf.model)} <Text dimColor>({inf.model})</Text>
          </Text>
          <Select
            key="model-switch"
            label={isSwitching ? 'Cambiando…' : 'Cambiar a:'}
            value={curValue}
            options={MODELS.map(m => ({ value: m.value, label: m.label }))}
            onSelect={v => void switchModel(v)}
          />
          <Text>
            Esfuerzo: <Text bold>{inf.effort ?? 'por defecto'}</Text>
          </Text>
        </Box>

        <Box flexDirection="column">
          <Text bold>Subagentes</Text>
          {active.length === 0 ? (
            <Text dimColor>Ninguno en ejecución</Text>
          ) : (
            <Text color="cyan">● {active.length} en ejecución</Text>
          )}
          {active.slice(0, 6).map(a => (
            <Text dimColor wrap="truncate-end">
              {a.type}: {a.description}
            </Text>
          ))}
          <Select
            key="agent-model"
            label="Modelo del agente:"
            value={aModel}
            options={[
              { value: 'inherit', label: `Actual (${labelOf(inf.model)})` },
              ...MODELS.filter(m => m.family !== fam).map(m => ({ value: m.value, label: m.label })),
            ]}
            onSelect={v => void update($, agentModel, () => v)}
          />
          <Input
            key="agent-task"
            label="Nuevo agente:"
            placeholder="Describe la tarea y pulsa Enter"
            submitLabel="lanzar"
            value=""
            onSubmit={v => void spawnAgent(v)}
          />
        </Box>

        <Box flexDirection="column">
          <Text bold>Contexto</Text>
          {ctx === null ? (
            <Text dimColor>Sin datos aún</Text>
          ) : (
            <Box flexDirection="column">
              <Text>
                <Text bold color={color(ctxPct ?? 0)}>{ctxPct ?? 0}%</Text> · {fmtTokens(ctx.tokens)} / {fmtTokens(ctx.window)}
              </Text>
              <Bar Text={Text} pct={ctxPct ?? 0} tone={color(ctxPct ?? 0)} />
            </Box>
          )}
          <Button variant="primary" onPress={() => void doCompact()}>
            {busy ? 'Compactando…' : 'Compactar contexto'}
          </Button>
        </Box>
      </Box>
    )
  })
}
