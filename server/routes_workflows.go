package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"ai-server-studio-backend/workflow"
)

type workflowDefinitionRequest struct {
	Name  string                 `json:"name"`
	Graph workflow.WorkflowGraph `json:"graph"`
}

type workflowRunRequest struct {
	DefinitionID string                 `json:"definitionId"`
	Version      uint64                 `json:"version,omitempty"`
	Input        json.RawMessage        `json:"input,omitempty"`
	Metadata     map[string]interface{} `json:"metadata,omitempty"`
}

func (s *Server) registerWorkflowRoutes() {
	s.mux.HandleFunc("POST /v1/workflows", s.handleCreateWorkflow)
	s.mux.HandleFunc("GET /v1/workflows", s.handleListWorkflows)
	s.mux.HandleFunc("GET /v1/workflows/{id}", s.handleGetWorkflow)
	s.mux.HandleFunc("POST /v1/workflows/{id}/versions", s.handleCreateWorkflowVersion)
	s.mux.HandleFunc("GET /v1/workflows/{id}/versions/{version}", s.handleGetWorkflowVersion)
	s.mux.HandleFunc("POST /v1/workflows/{id}/runs", s.handleCreateWorkflowRun)
	s.mux.HandleFunc("GET /v1/workflow-runs", s.handleListWorkflowRuns)
	s.mux.HandleFunc("GET /v1/workflow-runs/{id}", s.handleGetWorkflowRun)
	s.mux.HandleFunc("GET /v1/workflow-runs/{id}/events", s.handleWorkflowRunEvents)
}

func (s *Server) workflowReady(w http.ResponseWriter) bool {
	if s.workflowErr != nil || s.workflows == nil {
		writeError(w, http.StatusServiceUnavailable, "workflow store unavailable", "unavailable")
		return false
	}
	return true
}

func (s *Server) workflowOwner(w http.ResponseWriter, r *http.Request) (string, bool) {
	owner := s.requireOwner(w, r)
	return owner, owner != ""
}

func (s *Server) handleCreateWorkflow(w http.ResponseWriter, r *http.Request) {
	if !s.workflowReady(w) {
		return
	}
	owner, ok := s.workflowOwner(w, r)
	if !ok {
		return
	}
	var request workflowDefinitionRequest
	if err := decodeSecurityJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid workflow definition", "invalid_request")
		return
	}
	definition, err := s.workflows.CreateDefinition(owner, workflow.CreateDefinitionRequest{Name: request.Name, Graph: request.Graph})
	if err != nil {
		writeWorkflowError(w, err)
		return
	}
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, definition)
}

func (s *Server) handleListWorkflows(w http.ResponseWriter, r *http.Request) {
	if !s.workflowReady(w) {
		return
	}
	owner, ok := s.workflowOwner(w, r)
	if !ok {
		return
	}
	definitions, err := s.workflows.ListDefinitions(owner)
	if err != nil {
		writeWorkflowError(w, err)
		return
	}
	writeJSON(w, map[string]interface{}{"object": "list", "data": definitions})
}

func (s *Server) handleGetWorkflow(w http.ResponseWriter, r *http.Request) {
	if !s.workflowReady(w) {
		return
	}
	owner, ok := s.workflowOwner(w, r)
	if !ok {
		return
	}
	definition, err := s.workflows.GetDefinition(owner, r.PathValue("id"))
	if err != nil {
		writeWorkflowError(w, err)
		return
	}
	writeJSON(w, definition)
}

func (s *Server) handleCreateWorkflowVersion(w http.ResponseWriter, r *http.Request) {
	if !s.workflowReady(w) {
		return
	}
	owner, ok := s.workflowOwner(w, r)
	if !ok {
		return
	}
	var request workflowDefinitionRequest
	if err := decodeSecurityJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid workflow version", "invalid_request")
		return
	}
	version, err := s.workflows.CreateVersion(owner, r.PathValue("id"), request.Graph)
	if err != nil {
		writeWorkflowError(w, err)
		return
	}
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, version)
}

func (s *Server) handleGetWorkflowVersion(w http.ResponseWriter, r *http.Request) {
	if !s.workflowReady(w) {
		return
	}
	owner, ok := s.workflowOwner(w, r)
	if !ok {
		return
	}
	version, err := strconv.ParseUint(r.PathValue("version"), 10, 64)
	if err != nil || version == 0 {
		writeError(w, http.StatusBadRequest, "valid workflow version required", "invalid_request")
		return
	}
	result, err := s.workflows.GetVersion(owner, r.PathValue("id"), version)
	if err != nil {
		writeWorkflowError(w, err)
		return
	}
	writeJSON(w, result)
}

func (s *Server) handleCreateWorkflowRun(w http.ResponseWriter, r *http.Request) {
	if !s.workflowReady(w) {
		return
	}
	owner, ok := s.workflowOwner(w, r)
	if !ok {
		return
	}
	var request workflowRunRequest
	if err := decodeSecurityJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid workflow run", "invalid_request")
		return
	}
	request.DefinitionID = r.PathValue("id")
	run, err := s.workflows.CreateRun(owner, workflow.CreateRunRequest{
		DefinitionID: request.DefinitionID,
		Version:      request.Version,
		Input:        request.Input,
		Metadata:     request.Metadata,
	})
	if err != nil {
		writeWorkflowError(w, err)
		return
	}
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, run)
}

func (s *Server) handleListWorkflowRuns(w http.ResponseWriter, r *http.Request) {
	if !s.workflowReady(w) {
		return
	}
	owner, ok := s.workflowOwner(w, r)
	if !ok {
		return
	}
	runs, err := s.workflows.ListRuns(owner)
	if err != nil {
		writeWorkflowError(w, err)
		return
	}
	writeJSON(w, map[string]interface{}{"object": "list", "data": runs})
}

func (s *Server) handleGetWorkflowRun(w http.ResponseWriter, r *http.Request) {
	if !s.workflowReady(w) {
		return
	}
	owner, ok := s.workflowOwner(w, r)
	if !ok {
		return
	}
	run, err := s.workflows.GetRun(owner, r.PathValue("id"))
	if err != nil {
		writeWorkflowError(w, err)
		return
	}
	writeJSON(w, run)
}

func (s *Server) handleWorkflowRunEvents(w http.ResponseWriter, r *http.Request) {
	if !s.workflowReady(w) {
		return
	}
	owner, ok := s.workflowOwner(w, r)
	if !ok {
		return
	}
	after := uint64(0)
	if raw := strings.TrimSpace(r.URL.Query().Get("after")); raw != "" {
		parsed, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid after cursor", "invalid_request")
			return
		}
		after = parsed
	}
	limit := 1000
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			writeError(w, http.StatusBadRequest, "invalid event limit", "invalid_request")
			return
		}
		limit = parsed
	}
	events, err := s.workflows.ListEvents(owner, r.PathValue("id"), after, limit)
	if err != nil {
		writeWorkflowError(w, err)
		return
	}
	writeJSON(w, map[string]interface{}{"object": "list", "data": events, "after": after})
}

func writeWorkflowError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, workflow.ErrNotFound):
		writeError(w, http.StatusNotFound, "workflow resource not found", "not_found")
	case errors.Is(err, workflow.ErrConflict):
		writeError(w, http.StatusConflict, "workflow revision conflict", "conflict")
	case errors.Is(err, workflow.ErrInvalidTransition), errors.Is(err, workflow.ErrTerminal), errors.Is(err, workflow.ErrIncompleteSteps):
		writeError(w, http.StatusConflict, "workflow state transition rejected", "conflict")
	case errors.Is(err, workflow.ErrValidation):
		writeError(w, http.StatusBadRequest, "invalid workflow request", "invalid_request")
	default:
		writeError(w, http.StatusInternalServerError, "workflow operation failed", "internal_error")
	}
}
