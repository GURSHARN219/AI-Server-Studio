package server

import (
	"database/sql"
	"errors"
	"net/http"

	"ai-server-studio-backend/rag"
)

func (s *Server) registerRAGRoutes() {
	s.mux.HandleFunc("GET /v1/rag/status", s.handleRAGStatus)
	s.mux.HandleFunc("POST /v1/rag/documents", s.handleRAGIngest)
	s.mux.HandleFunc("PATCH /v1/rag/documents/{id}", s.handleRAGUpdate)
	s.mux.HandleFunc("POST /v1/rag/search", s.handleRAGSearch)
	s.mux.HandleFunc("DELETE /v1/rag/documents/{id}", s.handleRAGDelete)
}

func (s *Server) handleRAGStatus(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.ownerFromRequest(w, r); !ok {
		return
	}
	writeJSON(w, map[string]interface{}{
		"available":          s.rag != nil,
		"embeddingAvailable": s.rag != nil && s.rag.EmbeddingAvailable(),
		"embeddingModel": func() string {
			if s.rag == nil {
				return ""
			}
			return s.rag.EmbeddingModel()
		}(),
		"embeddingDimensions": func() int {
			if s.rag == nil {
				return 0
			}
			return s.rag.EmbeddingDimension()
		}(),
		"embeddingVersion": func() string {
			if s.rag == nil {
				return ""
			}
			return s.rag.EmbeddingVersion()
		}(),
		"message": func() string {
			if s.rag == nil || !s.rag.EmbeddingAvailable() {
				return rag.ErrEmbeddingUnavailable.Error()
			}
			return "ready"
		}(),
	})
}

func (s *Server) handleRAGIngest(w http.ResponseWriter, r *http.Request) {
	owner, ok := s.ownerFromRequest(w, r)
	if !ok {
		return
	}
	var req struct {
		Title   string   `json:"title"`
		Content string   `json:"content"`
		Source  string   `json:"source"`
		Tags    []string `json:"tags"`
	}
	if err := jsonDecode(r, &req); err != nil {
		writeError(w, 400, "invalid JSON", "invalid_request")
		return
	}
	if s.rag == nil {
		writeError(w, 503, rag.ErrEmbeddingUnavailable.Error(), "capability_unavailable")
		return
	}
	doc, err := s.rag.Ingest(r.Context(), owner, req.Title, req.Content, req.Source, req.Tags)
	if err != nil {
		writeRAGError(w, err)
		return
	}
	writeJSONStatus(w, http.StatusCreated, doc)
}

func (s *Server) handleRAGSearch(w http.ResponseWriter, r *http.Request) {
	owner, ok := s.ownerFromRequest(w, r)
	if !ok {
		return
	}
	var req struct {
		Query string `json:"query"`
		Limit int    `json:"limit"`
	}
	if err := jsonDecode(r, &req); err != nil {
		writeError(w, 400, "invalid JSON", "invalid_request")
		return
	}
	if s.rag == nil {
		writeError(w, 503, rag.ErrEmbeddingUnavailable.Error(), "capability_unavailable")
		return
	}
	results, err := s.rag.Search(r.Context(), owner, req.Query, req.Limit)
	if err != nil {
		writeRAGError(w, err)
		return
	}
	writeJSON(w, map[string]interface{}{"results": results})
}

func (s *Server) handleRAGUpdate(w http.ResponseWriter, r *http.Request) {
	owner, ok := s.ownerFromRequest(w, r)
	if !ok {
		return
	}
	var req struct {
		Title   string   `json:"title"`
		Content string   `json:"content"`
		Source  string   `json:"source"`
		Tags    []string `json:"tags"`
		Reindex bool     `json:"reindex"`
	}
	if err := jsonDecode(r, &req); err != nil {
		writeError(w, 400, "invalid JSON", "invalid_request")
		return
	}
	if s.rag == nil {
		writeError(w, 503, rag.ErrEmbeddingUnavailable.Error(), "capability_unavailable")
		return
	}
	var doc rag.Document
	var err error
	if req.Reindex && req.Content == "" && req.Title == "" && req.Source == "" && len(req.Tags) == 0 {
		doc, err = s.rag.Reindex(r.Context(), owner, r.PathValue("id"))
	} else {
		doc, err = s.rag.Update(r.Context(), owner, r.PathValue("id"), req.Title, req.Content, req.Source, req.Tags)
	}
	if err != nil {
		writeRAGError(w, err)
		return
	}
	writeJSON(w, doc)
}

func (s *Server) handleRAGDelete(w http.ResponseWriter, r *http.Request) {
	owner, ok := s.ownerFromRequest(w, r)
	if !ok {
		return
	}
	if s.rag == nil {
		writeError(w, 503, rag.ErrEmbeddingUnavailable.Error(), "capability_unavailable")
		return
	}
	if err := s.rag.Delete(r.Context(), owner, r.PathValue("id")); err != nil {
		writeRAGError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) ownerFromRequest(w http.ResponseWriter, r *http.Request) (string, bool) {
	owner := s.requireOwner(w, r)
	return owner, owner != ""
}

func writeRAGError(w http.ResponseWriter, err error) {
	status, kind := http.StatusInternalServerError, "rag_error"
	switch {
	case errors.Is(err, rag.ErrEmbeddingUnavailable):
		status, kind = http.StatusServiceUnavailable, "capability_unavailable"
	case errors.Is(err, rag.ErrInvalidDocument):
		status, kind = http.StatusBadRequest, "invalid_request"
	case errors.Is(err, rag.ErrEmbeddingMismatch):
		status, kind = http.StatusConflict, "incompatible_index"
	case errors.Is(err, sql.ErrNoRows):
		status, kind = http.StatusNotFound, "not_found"
	}
	writeError(w, status, err.Error(), kind)
}
