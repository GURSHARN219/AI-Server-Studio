package cmd

import (
	"sync"

	"github.com/GURSHARN219/aistclaw/internal/agent"
	"github.com/GURSHARN219/aistclaw/internal/bus"
	"github.com/GURSHARN219/aistclaw/internal/channels"
	"github.com/GURSHARN219/aistclaw/internal/config"
	"github.com/GURSHARN219/aistclaw/internal/scheduler"
	"github.com/GURSHARN219/aistclaw/internal/store"
	"github.com/GURSHARN219/aistclaw/internal/tools"
)

// ConsumerDeps bundles shared dependencies for consumer message handlers.
// Replaces 11+ positional params with a single injectable struct.
type ConsumerDeps struct {
	Cfg              *config.Config
	Agents           *agent.Router
	Sched            *scheduler.Scheduler
	ChannelMgr       *channels.Manager
	MsgBus           *bus.MessageBus
	TeamStore        store.TeamStore
	AgentStore       store.AgentStore
	SessStore        store.SessionStore
	PostTurn         tools.PostTurnProcessor
	QuotaChecker     *channels.QuotaChecker
	ContactCollector *store.ContactCollector
	TaskRunSessions  sync.Map
	SubagentMgr      *tools.SubagentManager
	BgWg             sync.WaitGroup
	GetAnnounceMu    func(string) *sync.Mutex
}
