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

const LIMIT_NAMES: Record<string, string> = {
  five_hour: 'Sesión (5 h)',
  seven_day: 'Semanal (7 d)',
  seven_day_opus: 'Semanal Opus',
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
    const { Box, Text, Button, Progress } = $.ui.resolve(e)
    const ls = await read($, limits)
    const ctx = await read($, context)
    const usd = await read($, cost)
    const inf = await read($, info)
    const ags = await read($, agents)
    const busy = await read($, compacting)
    const active = ags.filter(a => ACTIVE.has(a.status))

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
          {ls.length === 0 && <Text dimColor>Sin datos aún (aparece tras la primera respuesta, solo en suscripción).</Text>}
          {ls.map(l => (
            <Box flexDirection="column">
              <Text>
                {LIMIT_NAMES[l.kind] ?? l.kind}: <Text bold color={color(l.percentUsed)}>{l.percentUsed}%</Text>
              </Text>
              <Progress label={LIMIT_NAMES[l.kind] ?? l.kind} value={l.percentUsed} max={100} color={color(l.percentUsed)} />
              {fmtReset(l.resetsAt) !== '' && <Text dimColor>{fmtReset(l.resetsAt)}</Text>}
            </Box>
          ))}
          {usd !== null && <Text dimColor>Costo sesión: ${usd.toFixed(2)}</Text>}
        </Box>

        <Box flexDirection="column">
          <Text bold>Modelo</Text>
          <Text>{inf.model}</Text>
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
              <Progress
                label="Ventana de contexto"
                value={ctx.tokens ?? 0}
                max={ctx.window}
                valueText={`${fmtTokens(ctx.tokens)} de ${fmtTokens(ctx.window)}`}
                color={color(ctxPct ?? 0)}
              />
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
