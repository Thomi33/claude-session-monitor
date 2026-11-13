export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Ctx = { tokens?: number; window: number; percent?: number }
export type Agent = { id: string; description: string; type: string; status: string }
export type Info = { model: string; effort?: string }

declare module 'claude-code' {
  interface PluginState {
    'session-monitor': {
      limits: Shaped<Limit[]>
      context: Shaped<Ctx | null>
      cost: Shaped<number | null>
      info: Shaped<Info>
      agents: Shaped<Agent[]>
      compacting: Shaped<boolean>
    }
  }
}
