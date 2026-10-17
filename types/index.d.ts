export type FleetState = 'working' | 'waiting' | 'idle' | 'ended'

export type FleetTokens = { input: number; output: number; cacheRead: number; cacheWrite: number }

export type FleetAgent = {
  id: string
  // What to call it: the name it was spawned with, else one picked for it (unique in its session).
  name?: string
  type: string
  description: string
  model: string
  state: 'working' | 'done' | 'failed'
  now: string
  // What kind of work `now` is (reading, editing, running...), for the worker drawn.
  kind?: string
  // Steps done of planned, as the subagent reports them (savvy-progress's step tool).
  progress?: FleetProgress | null
  startedAt: number
  endedAt: number | null
  // When it last did anything (a tool call or a model reply): a running agent quiet too long is flagged.
  lastAt?: number
  // When its current tool call started; null between calls.
  toolAt?: number | null
  // A reply cut off at the output-token limit.
  hitMax?: boolean
  tokens: FleetTokens
  contextTokens: number
  contextWindow: number
  steps: number
  tools: number
}

export type FleetProgress = { done: number; total: number }

// What one finished turn of the main agent did.
export type FleetReceipt = { ms: number; edits: number; errors: number; agents: number; costUsd: number | null; endedAt: number }

// The running tally of the turn in progress, which becomes its receipt.
export type FleetTally = { edits: number; errors: number; agents: number; costStart: number | null }

// A model loop no agent list names: a workflow's agents, and the engine's or a plugin's forks.
export type FleetLoop = { id: string; model: string; steps: number; tokens: number; startedAt: number; lastAt: number }

export type FleetLimit = {
  kind: string
  percentUsed: number
  resetsAt: string | null
  // The forecast: ms until the limit fills at the current pace. Set for drawing only, never written to a heartbeat.
  fullInMs?: number
}

// One session's heartbeat, as its own copy of the mod writes it to ~/.claude/fleet/<id>.json.
export type FleetSession = {
  v: 1
  id: string
  project: string
  // The session's title as the app shows it, when it has one.
  title?: string
  cwd: string
  surface: string
  model: string
  effort: string | null
  state: FleetState
  task: string
  now: string
  kind?: string
  // The session's task list, by task id: its status. Progress is the completed share.
  tasks?: Record<string, string>
  last: string
  turnStartedAt: number | null
  // When the main agent's current tool call started; null between calls.
  toolAt?: number | null
  // The desktop app's id for this session (CLAUDE_CODE_HOST_SESSION_ID): claude://claude.ai/epitaxy/<id> opens it.
  // Terminal sessions have none.
  hostId?: string
  // The permission mode (default, acceptEdits, plan, auto, bypassPermissions, dontAsk).
  mode?: string
  // Context used, in percent, each time the conversation was compacted.
  compactions?: number[]
  tally?: FleetTally | null
  receipt?: FleetReceipt | null
  loops?: FleetLoop[]
  // The side panel opened by itself at this session's first subagent; the person closed it. Kept in
  // the record so a reload of the mod remembers both.
  panelOpenedOnce?: boolean
  panelClosed?: boolean
  // A reading of this session once held a plan limit: it is on a subscription, so the fleet's plan readings apply to it.
  hasPlan?: boolean
  // When the person last sent a prompt: the panel lists the most recent first.
  promptAt?: number
  // When the main agent last heard back from the model: its prompt cache lives a TTL past this.
  cacheAt?: number | null
  idleSince?: number | null
  // When the session began waiting on the person; null once it stops.
  waitingSince?: number | null
  turns: number
  toolsThisTurn: number
  toolsTotal: number
  contextTokens: number
  contextWindow: number
  contextPercent: number | null
  costUsd: number | null
  tokens: FleetTokens
  limits: FleetLimit[]
  agents: FleetAgent[]
  startedAt: number
  updatedAt: number
}

export type FleetView = { isCompact: boolean; isStill: boolean; showEnded: boolean; showBand: boolean; showColony?: boolean; showAlerts?: boolean }

declare module 'claude-code' {
  interface PluginState {
    fleet: {
      me: FleetSession | null
      sessions: FleetSession[]
      frame: number
      view: FleetView
    }
  }
}
