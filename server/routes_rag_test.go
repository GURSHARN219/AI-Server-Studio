package server

import (
	"context"
	"testing"

	"ai-server-studio-backend/rag"
)

func TestRAGRouteSupportsExplicitOwnedReindex(t *testing.T) {
	s, ownerToken, otherToken := securityTestServer(t)
	var err error
	s.rag, err = rag.New(s.db, serverRAGTestEmbedder{})
	if err != nil {
		t.Fatal(err)
	}
	s.registerRAGRoutes()
	doc, err := s.rag.Ingest(context.Background(), "owner-a", "title", "hello local RAG", "test", nil)
	if err != nil {
		t.Fatal(err)
	}

	h := s.authMiddleware(s.mux)
	if response := securityRequest(t, h, "PATCH", "/v1/rag/documents/"+doc.ID, otherToken, `{"reindex":true}`); response.Code != 404 {
		t.Fatalf("cross-owner reindex status = %d, body = %s", response.Code, response.Body.String())
	}
	if response := securityRequest(t, h, "PATCH", "/v1/rag/documents/"+doc.ID, ownerToken, `{"reindex":true}`); response.Code != 200 {
		t.Fatalf("owned reindex status = %d, body = %s", response.Code, response.Body.String())
	}
	var version string
	if err := s.db.QueryRow(`SELECT embedding_version FROM rag_chunks WHERE document_id=? LIMIT 1`, doc.ID).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != "route-v1" {
		t.Fatalf("reindexed version = %q", version)
	}
}

type serverRAGTestEmbedder struct{}

func (serverRAGTestEmbedder) EmbeddingModel() string   { return "route-test" }
func (serverRAGTestEmbedder) EmbeddingDimension() int  { return 2 }
func (serverRAGTestEmbedder) EmbeddingVersion() string { return "route-v1" }
func (serverRAGTestEmbedder) Embed(context.Context, string) ([]float32, error) {
	return []float32{1, 0}, nil
}
