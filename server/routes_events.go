package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

func (s *Server) registerEventRoutes() {
	s.mux.HandleFunc("GET /v1/events", s.handleSSEEvents)
}

// GET /v1/events — SSE stream for engine state changes
func (s *Server) handleSSEEvents(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "SSE not supported", 500)
		return
	}

	// Send initial status snapshot
	status := s.eng.GetStatus()
	status["type"] = "status"
	data, _ := json.Marshal(status)
	fmt.Fprintf(w, "data: %s\n\n", data)
	flusher.Flush()

	ch := s.eng.Subscribe()
	defer s.eng.Unsubscribe(ch)

	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case evt, ok := <-ch:
			if !ok {
				return
			}
			data, _ := json.Marshal(evt)
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		case <-heartbeat.C:
			fmt.Fprintf(w, ": heartbeat\n\n")
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}
