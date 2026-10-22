'use strict'

const { isoTime, pick, text, GOAL_LIMIT, READING_LIMIT } = require('./common')

const projectSessions = snapshot => {
  const sessions = Array.isArray(snapshot?.sessions) ? snapshot.sessions : []
  return {
    asOf: isoTime(snapshot?.updatedAt) ?? undefined,
    total: sessions.length,
    counts: Object.fromEntries([...new Set(sessions.map(session => session.status || 'unknown'))].sort().map(state => [state, sessions.filter(session => (session.status || 'unknown') === state).length])),
    sessions: sessions.slice(0, READING_LIMIT).map(session => pick(session, {
      id: session => session.sessionId ?? session.id,
      reportingMachine: session => text(session.reportedBy, GOAL_LIMIT),
      control: () => 'report_only',
      project: session => session.workspaceName,
      workingDirectory: session => session.cwd,
      state: session => session.status,
      goal: session => text(session.latestGoal, GOAL_LIMIT),
      activity: session => text(session.activity, GOAL_LIMIT),
      updatedAt: session => isoTime(session.updatedAt),
    })),
    truncated: sessions.length > READING_LIMIT,
  }
}

function createPiSessionReadings(piSessions) {
  if (!piSessions?.scan) return []
  return [{
    id: 'odk.app.pi-sessions',
    home: { mode: 'optional', priority: 0, icon: 'sessions', fields: ['total', 'counts', 'sessions', 'truncated'] },
    label: 'Pi sessions',
    kind: 'app',
    read: async () => {
      const snapshot = await piSessions.scan()
      if (snapshot?.ok !== true) return { state: 'unavailable', value: null }
      return { state: 'live', value: projectSessions(snapshot), updatedAt: snapshot.updatedAt }
    },
  }]
}

module.exports = { createPiSessionReadings }
