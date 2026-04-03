package server

import (
	"math"
	"net/http"
	"time"
)

func (s *Server) registerTaskRoutes() {
	s.mux.HandleFunc("POST /v1/tasks/download", s.handleDownload)
	s.mux.HandleFunc("GET /v1/tasks", s.handleListTasks)
	s.mux.HandleFunc("GET /v1/tasks/{id}", s.handleGetTask)
}

// POST /v1/tasks/download — start a model file download
func (s *Server) handleDownload(w http.ResponseWriter, r *http.Request) {
	var req struct {
		URL      string `json:"url"`
		DestDir  string `json:"dest_dir"`
		Filename string `json:"filename"`
	}
	if err := jsonDecode(r, &req); err != nil {
		writeError(w, 400, "Invalid JSON", "invalid_request")
		return
	}
	if req.URL == "" || req.DestDir == "" || req.Filename == "" {
		writeError(w, 400, "url, dest_dir, and filename are required", "invalid_request")
		return
	}
	if err := s.dlMgr.StartDownload(req.URL, req.DestDir, req.Filename); err != nil {
		writeError(w, 409, err.Error(), "download_error")
		return
	}
	writeJSON(w, map[string]interface{}{"ok": true, "task_id": req.Filename})
}

// GET /v1/tasks/{id} — progress for a specific task (download by filename)
func (s *Server) handleGetTask(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeError(w, 400, "task id required", "invalid_request")
		return
	}

	state, exists := s.dlMgr.GetProgress(id)
	if !exists {
		writeError(w, 404, "task not found", "not_found")
		return
	}

	elapsed := float64(time.Now().UnixMilli()-state.StartTime) / 1000.0
	speedBps := int64(0)
	if elapsed > 0 {
		speedBps = int64(math.Round(float64(state.BytesReceived) / elapsed))
	}
	progress := float64(0)
	if state.TotalBytes > 0 {
		progress = float64(state.BytesReceived) / float64(state.TotalBytes)
	}

	writeJSON(w, map[string]interface{}{
		"id":             id,
		"type":           "download",
		"progress":       progress,
		"bytes_received": state.BytesReceived,
		"total_bytes":    state.TotalBytes,
		"speed_bps":      speedBps,
		"status":         taskStatus(state.Done, state.Error),
		"error":          state.Error,
	})
}

// GET /v1/tasks — list all known download tasks
func (s *Server) handleListTasks(w http.ResponseWriter, r *http.Request) {
	// DownloadManager doesn't expose a list yet; return empty for now
	writeJSON(w, map[string]interface{}{"object": "list", "data": []interface{}{}})
}

func taskStatus(done bool, errMsg string) string {
	if errMsg != "" {
		return "error"
	}
	if done {
		return "done"
	}
	return "running"
}
