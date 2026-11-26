package rag

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"ai-server-studio-backend/persistence"
)

type testEmbedder struct{}

func (testEmbedder) EmbeddingModel() string  { return "test-v1" }
func (testEmbedder) EmbeddingDimension() int { return 2 }

func (testEmbedder) Embed(_ context.Context, text string) ([]float32, error) {
	if len(text) > 0 && text[0] == 'a' {
		return []float32{1, 0}, nil
	}
	return []float32{0, 1}, nil
}

func TestIngestSearchAndDeleteAreOwnerScoped(t *testing.T) {
	db, err := persistence.Open(t.TempDir() + "/rag.sqlite")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	service, err := New(db, testEmbedder{})
	if err != nil {
		t.Fatal(err)
	}
	doc, err := service.Ingest(context.Background(), "owner-a", "Alpha", "alpha content", "test", []string{"one", "one"})
	if err != nil {
		t.Fatal(err)
	}
	results, err := service.Search(context.Background(), "owner-a", "alpha", 5)
	if err != nil || len(results) != 1 || results[0].DocumentID != doc.ID {
		t.Fatalf("unexpected search result: %+v %v", results, err)
	}
	other, err := service.Search(context.Background(), "owner-b", "alpha", 5)
	if err != nil || len(other) != 0 {
		t.Fatalf("cross-owner result: %+v %v", other, err)
	}
	if err := service.Delete(context.Background(), "owner-b", doc.ID); err == nil {
		t.Fatal("cross-owner delete succeeded")
	}
	if err := service.Delete(context.Background(), "owner-a", doc.ID); err != nil {
		t.Fatal(err)
	}
}

func TestUpdatePreservesDocumentID(t *testing.T) {
	db, err := persistence.Open(t.TempDir() + "/rag.sqlite")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	service, err := New(db, testEmbedder{})
	if err != nil {
		t.Fatal(err)
	}
	doc, err := service.Ingest(context.Background(), "owner", "Old", "alpha", "test", nil)
	if err != nil {
		t.Fatal(err)
	}
	updated, err := service.Update(context.Background(), "owner", doc.ID, "New", "alpha updated", "test", []string{"updated"})
	if err != nil || updated.ID != doc.ID || updated.Title != "New" {
		t.Fatalf("unexpected update: %+v %v", updated, err)
	}
}

func TestMissingEmbedderFailsClosed(t *testing.T) {
	db, err := persistence.Open(t.TempDir() + "/rag.sqlite")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	service, err := New(db, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Ingest(context.Background(), "owner", "title", "content", "test", nil); err != ErrEmbeddingUnavailable {
		t.Fatalf("expected unavailable embedder, got %v", err)
	}
}

func TestEmbeddingMetadataIsPersistedAndProviderAdapterWorks(t *testing.T) {
	db, err := persistence.Open(t.TempDir() + "/rag.sqlite")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	service, err := New(db, testEmbedder{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Ingest(context.Background(), "owner", "title", "alpha", "source.md", nil); err != nil {
		t.Fatal(err)
	}
	var model string
	var dimensions int
	if err := db.QueryRow(`SELECT embedding_model, embedding_dimensions FROM rag_chunks LIMIT 1`).Scan(&model, &dimensions); err != nil {
		t.Fatal(err)
	}
	if model != "test-v1" || dimensions != 2 {
		t.Fatalf("metadata = %q/%d", model, dimensions)
	}

	httpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/embeddings" || r.Method != http.MethodPost {
			t.Errorf("request = %s %s", r.Method, r.URL.Path)
		}
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{"embedding": []float32{1, 2, 3}}}})
	}))
	defer httpServer.Close()
	provider := OpenAIEmbedder{BaseURL: httpServer.URL, Model: "local-test", Dimensions: 3, Version: "local-v1"}
	vector, err := provider.Embed(context.Background(), "hello")
	if err != nil || len(vector) != 3 {
		t.Fatalf("provider result = %v %v", vector, err)
	}
}
