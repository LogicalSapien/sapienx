import 'dotenv/config';

export default {
  owner: {
    phone: process.env.OWNER_PHONE,
    name: process.env.OWNER_NAME || 'owner',
    allowedNumbers: (process.env.ALLOWED_NUMBERS || '').split(',').filter(Boolean)
  },

  groupPolicy: process.env.GROUP_POLICY || 'ignore', // 'ignore', 'allowlist', 'all'
  allowedGroups: (process.env.ALLOWED_GROUPS || '').split(',').filter(Boolean),

  channels: {
    whatsapp: {
      enabled: true,
      cli: null,
      model: null
    },
    tui: {
      enabled: true,
      cli: 'claude',
      model: null
    },
    telegram: {
      enabled: false,
      cli: null,
      model: null
    }
  },

  groups: {},

  cli: {
    default: 'claude',
    maxConcurrent: 2,
    adapters: {
      claude: {
        model: 'sonnet',
        autoModel: false,
        maxTurns: 10,
        outputFormat: 'stream-json'
      },
      codex: {
        model: 'o3',
        autoModel: false,
        maxTurns: 3
      }
    }
  },

  sessions: {
    inactivityTimeout: 30 * 60 * 1000,
    maxPinnedSessions: 5,
    summaryOnExpiry: true,
    messageBufferSize: 10,
    retentionMonths: 6
  },

  skills: {
    paths: ['./skills'],
    destructiveKeywords: [
      'rm', 'kill', 'reboot', 'shutdown',
      'drop', 'mkfs', 'dd', 'format'
    ]
  },

  scheduler: {
    enabled: true,
    persistPath: './data/schedules.json'
  },

  health: {
    dailyPing: false,
    dailyPingTime: '0 8 * * *',
    reconnectTimeout: 5 * 60 * 1000
  },

  vps: {
    commandTimeout: 30000,
    maxOutputSize: 10240
  },

  upgrades: {
    autoCheck: true,
    autoApply: false,
    notifyOnUpdate: true,
    schedule: '0 4 * * *'
  },

  data: {
    sessionHistoryRetentionMonths: 6
  }
};
