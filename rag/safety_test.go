package rag

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"ai-server-studio-backend/persistence"
)

func TestOpenAIEmbedderRequiresLoopbackCompleteConfig(t *testing.T) {
	for _, endpoint := range []string{"https://example.com/v1", "http://10.0.0.1:8080/v1"} {
		if _, err := NewOpenAIEmbedder(OpenAIEmbedderConfig{BaseURL: endpoint, Model: "m", Dimensions: 2, Version: "v1"}); err == nil {
			t.Fatalf("remote endpoint %q was accepted", endpoint)
		}
	}
	for _, config := range []OpenAIEmbedderConfig{
		{BaseURL: "http://127.0.0.1:1", Model: "", Dimensions: 2, Version: "v1"},
		{BaseURL: "http://127.0.0.1:1", Model: "m", Dimensions: 0, Version: "v1"},
		{BaseURL: "http://127.0.0.1:1", Model: "m", Dimensions: 2, Version: ""},
	} {
		if _, err := NewOpenAIEmbedder(config); err == nil {
			t.Fatal("incomplete provider configuration was accepted")
		}
	}
}

func TestOpenAIEmbedderBoundsBodyAndHonorsCancellation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/embeddings" {
			t.Errorf("path = %q", r.URL.Path)
		}
		if r.Header.Get("Proxy-Authorization") != "" {
			t.Error("proxy header unexpectedly forwarded")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(strings.Repeat("x", maxEmbeddingBodyBytes+1)))
	}))
	defer server.Close()
	provider := OpenAIEmbedder{BaseURL: server.URL, Model: "m", Dimensions: 2, Version: "v1"}
	if _, err := provider.Embed(context.Background(), "hello"); err == nil || !strings.Contains(err.Error(), "size limit") {
		t.Fatalf("body limit error = %v", err)
	}

	blocking := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(100 * time.Millisecond)
	}))
	defer blocking.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	provider.BaseURL = blocking.URL
	if _, err := provider.Embed(ctx, "hello"); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("cancellation error = %v", err)
	}
}

func TestFiniteAndConfiguredDimensionsRequiredOnIngest(t *testing.T) {
	db, err := persistence.Open(t.TempDir() + "/rag.sqlite")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	service, err := New(db, invalidVectorEmbedder{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Ingest(context.Background(), "owner", "title", "content", "test", nil); !errors.Is(err, ErrEmbeddingMismatch) {
		t.Fatalf("invalid vector error = %v", err)
	}
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM rag_documents`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("invalid vector inserted %d documents", count)
	}
}

func TestUpdateChecksOwnershipBeforeEmbeddingAndRollsBackOnFailure(t *testing.T) {
	db, err := persistence.Open(t.TempDir() + "/rag.sqlite")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	embedder := &countingEmbedder{}
	service, err := New(db, embedder)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := service.Ingest(context.Background(), "owner", "old", "alpha", "test", nil)
	if err != nil {
		t.Fatal(err)
	}
	beforeUnauthorized := atomic.LoadInt32(&embedder.calls)
	if _, err := service.Update(context.Background(), "other", doc.ID, "hijack", "new", "test", nil); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("unauthorized update error = %v", err)
	}
	if got := atomic.LoadInt32(&embedder.calls); got != beforeUnauthorized {
		t.Fatalf("unauthorized update embedded %d chunks", got-beforeUnauthorized)
	}

	embedder.failAfter = 2
	longContent := strings.Repeat("beta ", 300)
	if _, err := service.Update(context.Background(), "owner", doc.ID, "new", longContent, "test", nil); err == nil {
		t.Fatal("failed update unexpectedly succeeded")
	}
	var content string
	if err := db.QueryRow(`SELECT content FROM rag_documents WHERE id=?`, doc.ID).Scan(&content); err != nil {
		t.Fatal(err)
	}
	if content != "alpha" {
		t.Fatalf("failed update changed content to %q", content)
	}
}

func TestLegacyMetadataIsExplicitAndRowsArePreserved(t *testing.T) {
	db, err := persistence.Open(t.TempDir() + "/rag.sqlite")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	service, err := New(db, testEmbedder{})
	if err != nil {
		t.Fatal(err)
	}
	doc, err := service.Ingest(context.Background(), "owner", "title", "alpha", "test", nil)
	if err != nil {
		t.Fatal(err)
	}
	var chunkCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM rag_chunks WHERE document_id=?`, doc.ID).Scan(&chunkCount); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE rag_chunks SET embedding_model='', embedding_dimensions=0, embedding_version='' WHERE document_id=?`, doc.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Search(context.Background(), "owner", "alpha", 5); !errors.Is(err, ErrEmbeddingMismatch) {
		t.Fatalf("legacy search error = %v", err)
	}
	var preserved int
	if err := db.QueryRow(`SELECT COUNT(*) FROM rag_chunks WHERE document_id=?`, doc.ID).Scan(&preserved); err != nil {
		t.Fatal(err)
	}
	if preserved != chunkCount {
		t.Fatalf("legacy rows changed from %d to %d", chunkCount, preserved)
	}
	if _, err := service.Reindex(context.Background(), "owner", doc.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE rag_chunks SET embedding_model='other-model' WHERE document_id=?`, doc.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Search(context.Background(), "owner", "alpha", 5); !errors.Is(err, ErrEmbeddingMismatch) {
		t.Fatalf("incompatible index error = %v", err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM rag_chunks WHERE document_id=?`, doc.ID).Scan(&preserved); err != nil {
		t.Fatal(err)
	}
	if preserved != chunkCount {
		t.Fatalf("incompatible rows changed to %d", preserved)
	}
}

func TestRuneSafeChunkingAndVersionedRestart(t *testing.T) {
	path := t.TempDir() + "/rag.sqlite"
	db, err := persistence.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	service, err := New(db, testEmbedder{})
	if err != nil {
		t.Fatal(err)
	}
	parts := chunkText("😀世界abc", 2, 0)
	if got := strings.Join(parts, "|"); got != "😀世|界a|bc" {
		t.Fatalf("rune chunks = %q", got)
	}
	if _, err := service.Ingest(context.Background(), "owner", "title", "😀世界", "test", nil); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	db, err = persistence.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	restarted, err := New(db, testEmbedder{})
	if err != nil {
		t.Fatal(err)
	}
	var version string
	if err := db.QueryRow(`SELECT embedding_version FROM rag_chunks LIMIT 1`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != "custom" {
		t.Fatalf("persisted version = %q", version)
	}
	if _, err := restarted.Search(context.Background(), "owner", "😀", 5); err != nil {
		t.Fatal(err)
	}
}

func TestOpenAIEmbedderRealLocalIntegration(t *testing.T) {
	endpoint := strings.TrimSpace(getenv("AIST_RAG_REAL_LOCAL_URL"))
	if endpoint == "" {
		t.Skip("set AIST_RAG_REAL_LOCAL_URL to run the opt-in local provider integration test")
	}
	provider, err := NewOpenAIEmbedder(OpenAIEmbedderConfig{
		BaseURL: endpoint, Model: getenv("AIST_RAG_REAL_LOCAL_MODEL"), Dimensions: atoi(getenv("AIST_RAG_REAL_LOCAL_DIMENSIONS")), Version: "integration-v1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := provider.Embed(context.Background(), "local integration"); err != nil {
		t.Fatal(err)
	}
}

type invalidVectorEmbedder struct{}

func (invalidVectorEmbedder) EmbeddingModel() string   { return "invalid" }
func (invalidVectorEmbedder) EmbeddingDimension() int  { return 2 }
func (invalidVectorEmbedder) EmbeddingVersion() string { return "v1" }
func (invalidVectorEmbedder) Embed(context.Context, string) ([]float32, error) {
	return []float32{float32(math.NaN()), 1}, nil
}

type countingEmbedder struct {
	calls     int32
	failAfter int32
}

func (e *countingEmbedder) EmbeddingModel() string   { return "counting" }
func (e *countingEmbedder) EmbeddingDimension() int  { return 2 }
func (e *countingEmbedder) EmbeddingVersion() string { return "v1" }
func (e *countingEmbedder) Embed(context.Context, string) ([]float32, error) {
	call := atomic.AddInt32(&e.calls, 1)
	if e.failAfter > 0 && call >= e.failAfter {
		return nil, errors.New("synthetic embedding failure")
	}
	return []float32{1, 0}, nil
}

// Keep the focused test independent from the production server's environment
// helpers; the integration test is intentionally opt-in.
func getenv(key string) string { return strings.TrimSpace(os.Getenv(key)) }
func atoi(raw string) int {
	value, _ := strconv.Atoi(strings.TrimSpace(raw))
	return value
}
