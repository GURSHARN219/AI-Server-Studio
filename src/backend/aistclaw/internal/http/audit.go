package http

import (
	"net/http"

	"github.com/GURSHARN219/aistclaw/internal/bus"
	"github.com/GURSHARN219/aistclaw/internal/store"
	"github.com/GURSHARN219/aistclaw/pkg/protocol"
)

// emitAudit broadcasts an audit event via msgBus for async persistence.
func emitAudit(msgBus *bus.MessageBus, r *http.Request, action, entityType, entityID string) {
	if msgBus == nil {
		return
	}
	actorID := store.UserIDFromContext(r.Context())
	if actorID == "" {
		actorID = extractUserID(r)
	}
	if actorID == "" {
		actorID = "system"
	}
	msgBus.Broadcast(bus.Event{
		Name: protocol.EventAuditLog,
		Payload: bus.AuditEventPayload{
			ActorType:  "user",
			ActorID:    actorID,
			Action:     action,
			EntityType: entityType,
			EntityID:   entityID,
			IPAddress:  r.RemoteAddr,
			TenantID:   store.TenantIDFromContext(r.Context()),
		},
	})
}
