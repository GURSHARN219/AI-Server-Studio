package server

import (
	"database/sql"
	"errors"
	"math"
	"net/http"
	"time"

	"ai-server-studio-backend/engine"
)

func (s *Server) registerTaskRoutes() {
	s.mux.HandleFunc("POST /v1/tasks/download", s.handleDownload)
	s.mux.HandleFunc("POST /v1/tasks/{id}/cancel", s.handleCancelTask)
	s.mux.HandleFunc("DELETE /v1/tasks/{id}", s.handleCancelTask)
	s.mux.HandleFunc("GET /v1/tasks", s.handleListTasks)
	s.mux.HandleFunc("GET /v1/tasks/{id}", s.handleGetTask)
}

// POST /v1/tasks/download — start a model file download
func (s *Server) handleDownload(w http.ResponseWriter, r *http.Request) {
	var req struct {
		URL string `json:"url"`
		// DestDir is retained for request compatibility but is deliberately
		// ignored. Downloads are always resolved beneath the configured model root.
		DestDir        string `json:"dest_dir"`
		Filename       string `json:"filename"`
		ExpectedSHA256 string `json:"expected_sha256"`
	}
	if err := jsonDecode(r, &req); err != nil {
		writeError(w, 400, "Invalid JSON", "invalid_request")
		return
	}
	if req.URL == "" || req.Filename == "" || req.ExpectedSHA256 == "" {
		writeError(w, 400, "url, filename, and expected_sha256 are required", "invalid_request")
		return
	}
	s.dlMgr.SetModelRoot(s.eng.GetModelsDir())
	taskID, err := s.dlMgr.StartDownload(req.URL, req.Filename, req.ExpectedSHA256)
	if err != nil {
		status := http.StatusConflict
		errType := "download_error"
		if errors.Is(err, engine.ErrDownloadValidation) {
			status = http.StatusBadRequest
			errType = "invalid_request"
		}
		writeError(w, status, err.Error(), errType)
		return
	}
	writeJSON(w, map[string]interface{}{"ok": true, "task_id": taskID})
}

// GET /v1/tasks/{id} — progress for a specific durable download task
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
		"status":         state.Status,
		"error":          state.Error,
	})
}

func (s *Server) handleCancelTask(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeError(w, 400, "task id required", "invalid_request")
		return
	}
	if err := s.dlMgr.Cancel(id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, 404, "task not found", "not_found")
			return
		}
		writeError(w, 409, err.Error(), "download_error")
		return
	}
	writeJSON(w, map[string]interface{}{"ok": true, "task_id": id, "status": engine.DownloadCancelled})
}

// GET /v1/tasks — list all known download tasks
func (s *Server) handleListTasks(w http.ResponseWriter, r *http.Request) {
	tasks, err := s.dlMgr.ListProgress()
	if err != nil {
		writeError(w, 500, "task persistence unavailable", "server_error")
		return
	}
	data := make([]interface{}, len(tasks))
	for i := range tasks {
		state := tasks[i]
		data[i] = map[string]interface{}{
			"id": state.ID, "type": "download", "progress": taskProgress(state),
			"url": state.URL, "filename": state.Filename,
			"expected_sha256": state.ExpectedSHA256,
			"bytes_received":  state.BytesReceived, "total_bytes": state.TotalBytes,
			"status": state.Status, "done": state.Done, "error": state.Error,
		}
	}
	writeJSON(w, map[string]interface{}{"object": "list", "data": data})
}

func taskProgress(state engine.DownloadState) float64 {
	if state.TotalBytes <= 0 {
		if state.Status == engine.DownloadCompleted {
			return 1
		}
		return 0
	}
	progress := float64(state.BytesReceived) / float64(state.TotalBytes)
	if progress < 0 {
		return 0
	}
	if progress > 1 {
		return 1
	}
	return progress
}
