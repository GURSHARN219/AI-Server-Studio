package server

import (
	"encoding/json"
	"fmt"
	"net/http"

	"ai-server-studio-backend/engine"
)

func (s *Server) registerComponentRoutes() {
	s.mux.HandleFunc("GET /v1/components", s.handleGetComponents)
	s.mux.HandleFunc("GET /v1/components/{name}", s.handleGetComponent)
	s.mux.HandleFunc("POST /v1/components/{name}/install", s.handleInstallComponent)
}

// GET /v1/components — all installable runtime components
func (s *Server) handleGetComponents(w http.ResponseWriter, r *http.Request) {
	python := pythonComponentInfo(s.baseDir)
	eng := engineComponentInfo(s.baseDir)
	writeJSON(w, map[string]interface{}{
		"object": "list",
		"data":   []interface{}{python, eng},
	})
}

// GET /v1/components/{name}
func (s *Server) handleGetComponent(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	switch name {
	case "python":
		writeJSON(w, pythonComponentInfo(s.baseDir))
	case "engine":
		writeJSON(w, engineComponentInfo(s.baseDir))
	default:
		writeError(w, 404, fmt.Sprintf("unknown component: %s", name), "not_found")
	}
}

// POST /v1/components/{name}/install
func (s *Server) handleInstallComponent(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	switch name {
	case "python":
		s.installPython(w, r)
	case "engine":
		s.installEngine(w, r)
	default:
		writeError(w, 404, fmt.Sprintf("unknown component: %s", name), "not_found")
	}
}

func (s *Server) installPython(w http.ResponseWriter, r *http.Request) {
	installer := engine.GetPythonInstaller(s.baseDir)
	if installer.IsInstalling() {
		writeError(w, http.StatusConflict, "installation already in progress", "conflict")
		return
	}
	if err := installer.Install(); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error(), "install_error")
		return
	}

	// Stream progress via SSE
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher, ok := w.(http.Flusher)
	if !ok {
		return
	}

	ch := installer.Subscribe()
	defer installer.Unsubscribe(ch)
	for {
		select {
		case <-r.Context().Done():
			return
		case prog, ok := <-ch:
			if !ok {
				return
			}
			data, _ := json.Marshal(prog)
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
			if prog.Stage == "done" || prog.Stage == "error" {
				return
			}
		}
	}
}

func (s *Server) installEngine(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Variant string `json:"variant"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if req.Variant == "" {
		req.Variant = "auto"
	}

	installer := engine.GetEngineInstaller(s.baseDir)
	if installer.IsInstalling() {
		writeError(w, http.StatusConflict, "installation already in progress", "conflict")
		return
	}
	if err := installer.Install(req.Variant); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error(), "install_error")
		return
	}

	// Stream progress via SSE
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher, ok := w.(http.Flusher)
	if !ok {
		return
	}

	ch := installer.Subscribe()
	defer installer.Unsubscribe(ch)
	for {
		select {
		case <-r.Context().Done():
			return
		case prog, ok := <-ch:
			if !ok {
				return
			}
			data, _ := json.Marshal(prog)
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
			if prog.Stage == "done" || prog.Stage == "error" {
				return
			}
		}
	}
}

func pythonComponentInfo(baseDir string) map[string]interface{} {
	installer := engine.GetPythonInstaller(baseDir)
	status := "not_installed"
	if installer.IsInstalling() {
		status = "installing"
	} else if installer.IsInstalled() {
		status = "ready"
	}
	return map[string]interface{}{
		"name":       "python",
		"installed":  installer.IsInstalled(),
		"installing": installer.IsInstalling(),
		"status":     status,
		"path":       installer.PythonExePath(),
		"installDir": installer.InstallDir(),
	}
}

func engineComponentInfo(baseDir string) map[string]interface{} {
	installer := engine.GetEngineInstaller(baseDir)
	status := "not_installed"
	if installer.IsInstalling() {
		status = "installing"
	} else if installer.IsInstalled() {
		status = "ready"
	}
	return map[string]interface{}{
		"name":               "engine",
		"installed":          installer.IsInstalled(),
		"installing":         installer.IsInstalling(),
		"status":             status,
		"variant":            installer.InstalledVariant(),
		"version":            installer.InstalledVersion(),
		"binaryPath":         installer.BinaryPath(),
		"binDir":             installer.BinDir(),
		"recommendedVariant": installer.RecommendedVariant(),
	}
}
