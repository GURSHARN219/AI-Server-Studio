// Package rag owns local document indexing and vector retrieval.
//
// Embedding and storage are explicit interfaces. The service never reports a
// semantic success when an embedding provider is missing.
package rag

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
	"unicode"

	"ai-server-studio-backend/persistence"
	"github.com/google/uuid"
)

var (
	ErrEmbeddingUnavailable = errors.New("RAG embedding provider is unavailable")
	ErrInvalidDocument      = errors.New("invalid RAG document")
	ErrEmbeddingMismatch    = errors.New("RAG embedding model or dimension mismatch")
)

const (
	defaultEmbeddingTimeout = 10 * time.Second
	maxEmbeddingBodyBytes   = 1 << 20
)

type Embedder interface {
	Embed(context.Context, string) ([]float32, error)
}

// EmbedderInfo lets persistent indexes record the provider/model contract.
type EmbedderInfo interface {
	Embedder
	EmbeddingModel() string
	EmbeddingDimension() int
}

// EmbedderVersioner is optional for backwards-compatible custom embedders. New
// providers should expose a stable version so persisted indexes can be
// rejected rather than mixed silently after a provider upgrade.
type EmbedderVersioner interface {
	EmbeddingVersion() string
}

type Document struct {
	ID        string    `json:"id"`
	OwnerID   string    `json:"owner_id"`
	Title     string    `json:"title"`
	Content   string    `json:"content"`
	Tags      []string  `json:"tags"`
	Source    string    `json:"source"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Chunk struct {
	ID         string
	DocumentID string
	Index      int
	Text       string
	Metadata   map[string]string
}

type Result struct {
	DocumentID string            `json:"document_id"`
	Title      string            `json:"title"`
	Text       string            `json:"text"`
	Source     string            `json:"source"`
	Score      float64           `json:"score"`
	Metadata   map[string]string `json:"metadata,omitempty"`
}

type Service struct {
	db        *sql.DB
	embedder  Embedder
	chunkSize int
	overlap   int
}

func New(db *sql.DB, embedder Embedder) (*Service, error) {
	if db == nil {
		return nil, errors.New("RAG database is required")
	}
	s := &Service{db: db, embedder: embedder, chunkSize: 500, overlap: 100}
	if err := s.migrate(); err != nil {
		return nil, err
	}
	return s, nil
}

// EmbeddingAvailable reports whether semantic operations can run. A false
// value is an explicit capability gap, not an empty search result.
func (s *Service) EmbeddingAvailable() bool { return s != nil && s.embedder != nil }

func (s *Service) EmbeddingModel() string {
	if s == nil || s.embedder == nil {
		return ""
	}
	if info, ok := s.embedder.(EmbedderInfo); ok {
		return info.EmbeddingModel()
	}
	return "custom"
}

func (s *Service) EmbeddingDimension() int {
	if s == nil || s.embedder == nil {
		return 0
	}
	if info, ok := s.embedder.(EmbedderInfo); ok {
		return info.EmbeddingDimension()
	}
	return 0
}

func (s *Service) EmbeddingVersion() string {
	if s == nil || s.embedder == nil {
		return ""
	}
	if versioner, ok := s.embedder.(EmbedderVersioner); ok {
		return strings.TrimSpace(versioner.EmbeddingVersion())
	}
	return "custom"
}

func (s *Service) migrate() error {
	if err := persistence.ApplyMigration(s.db, "rag/1",
		`CREATE TABLE IF NOT EXISTS rag_documents (
			id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL,
			content TEXT NOT NULL, tags_json TEXT NOT NULL, source TEXT NOT NULL,
			created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
		`CREATE INDEX IF NOT EXISTS rag_documents_owner ON rag_documents(owner_id, updated_at)`,
		`CREATE TABLE IF NOT EXISTS rag_chunks (
			id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES rag_documents(id) ON DELETE CASCADE,
			owner_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, text TEXT NOT NULL,
			metadata_json TEXT NOT NULL, vector_json TEXT NOT NULL)`,
		`CREATE INDEX IF NOT EXISTS rag_chunks_owner ON rag_chunks(owner_id, document_id, chunk_index)`,
	); err != nil {
		return err
	}
	if err := persistence.ApplyMigration(s.db, "rag/2",
		`ALTER TABLE rag_chunks ADD COLUMN embedding_model TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE rag_chunks ADD COLUMN embedding_dimensions INTEGER NOT NULL DEFAULT 0`,
	); err != nil {
		return err
	}
	// rag/1 and rag/2 are immutable. Rows created by those migrations retain an
	// empty version and are reported as legacy/incompatible at query time.
	return persistence.ApplyMigration(s.db, "rag/3",
		`ALTER TABLE rag_chunks ADD COLUMN embedding_version TEXT NOT NULL DEFAULT ''`,
	)
}

func (s *Service) embeddingInfo(vector []float32) (string, int, string, error) {
	dimension := len(vector)
	if err := validateVector(vector, dimension); err != nil {
		return "", 0, "", err
	}
	model := "custom"
	version := "custom"
	if info, ok := s.embedder.(EmbedderInfo); ok {
		model = strings.TrimSpace(info.EmbeddingModel())
		configured := info.EmbeddingDimension()
		if model == "" || configured <= 0 {
			return "", 0, "", ErrEmbeddingMismatch
		}
		if configured != dimension {
			return "", 0, "", fmt.Errorf("%w: provider returned %d dimensions, configured %d", ErrEmbeddingMismatch, dimension, configured)
		}
	}
	if versioner, ok := s.embedder.(EmbedderVersioner); ok {
		version = strings.TrimSpace(versioner.EmbeddingVersion())
	}
	if version == "" {
		return "", 0, "", ErrEmbeddingMismatch
	}
	return model, dimension, version, nil
}

func (s *Service) Ingest(ctx context.Context, ownerID, title, content, source string, tags []string) (Document, error) {
	ownerID, title, content = strings.TrimSpace(ownerID), strings.TrimSpace(title), normalize(content)
	if ownerID == "" || content == "" {
		return Document{}, ErrInvalidDocument
	}
	if title == "" {
		title = "Untitled"
	}
	if source == "" {
		source = "manual"
	}
	if s.embedder == nil {
		return Document{}, ErrEmbeddingUnavailable
	}
	parts := chunkText(content, s.chunkSize, s.overlap)
	if len(parts) == 0 {
		return Document{}, ErrInvalidDocument
	}

	id := uuid.NewString()
	now := time.Now().UTC()
	doc := Document{ID: id, OwnerID: ownerID, Title: title, Content: content, Tags: cleanTags(tags), Source: source, CreatedAt: now, UpdatedAt: now}
	vectors, models, dimensions, versions, err := s.embedParts(ctx, parts)
	if err != nil {
		return Document{}, err
	}
	if err := ctx.Err(); err != nil {
		return Document{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Document{}, err
	}
	defer tx.Rollback()
	tagsJSON, _ := json.Marshal(doc.Tags)
	if _, err = tx.ExecContext(ctx, `INSERT INTO rag_documents(id,owner_id,title,content,tags_json,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`, doc.ID, doc.OwnerID, doc.Title, doc.Content, string(tagsJSON), doc.Source, doc.CreatedAt.Format(time.RFC3339Nano), doc.UpdatedAt.Format(time.RFC3339Nano)); err != nil {
		return Document{}, err
	}
	for i, text := range parts {
		vectorJSON, _ := json.Marshal(vectors[i])
		metadataJSON, _ := json.Marshal(map[string]string{"title": doc.Title, "source": doc.Source, "chunk_index": fmt.Sprint(i), "embedding_version": versions[i]})
		if _, err = tx.ExecContext(ctx, `INSERT INTO rag_chunks(id,document_id,owner_id,chunk_index,text,metadata_json,vector_json,embedding_model,embedding_dimensions,embedding_version) VALUES(?,?,?,?,?,?,?,?,?,?)`, uuid.NewString(), doc.ID, doc.OwnerID, i, text, string(metadataJSON), string(vectorJSON), models[i], dimensions[i], versions[i]); err != nil {
			return Document{}, err
		}
	}
	if err = tx.Commit(); err != nil {
		return Document{}, err
	}
	return doc, nil
}

type embeddedChunk struct {
	vector     []float32
	model      string
	dimensions int
	version    string
}

func (s *Service) embedParts(ctx context.Context, parts []string) (vectors [][]float32, models []string, dimensions []int, versions []string, err error) {
	if s.embedder == nil {
		return nil, nil, nil, nil, ErrEmbeddingUnavailable
	}
	chunks := make([]embeddedChunk, len(parts))
	for i, part := range parts {
		vector, embedErr := s.embedder.Embed(ctx, part)
		if embedErr != nil {
			return nil, nil, nil, nil, fmt.Errorf("embed chunk %d: %w", i, embedErr)
		}
		model, dimension, version, infoErr := s.embeddingInfo(vector)
		if infoErr != nil {
			return nil, nil, nil, nil, fmt.Errorf("embed chunk %d: %w", i, infoErr)
		}
		chunks[i] = embeddedChunk{vector: vector, model: model, dimensions: dimension, version: version}
	}
	vectors = make([][]float32, len(chunks))
	models = make([]string, len(chunks))
	dimensions = make([]int, len(chunks))
	versions = make([]string, len(chunks))
	for i, chunk := range chunks {
		vectors[i], models[i], dimensions[i], versions[i] = chunk.vector, chunk.model, chunk.dimensions, chunk.version
	}
	return vectors, models, dimensions, versions, nil
}

func (s *Service) Search(ctx context.Context, ownerID, query string, limit int) ([]Result, error) {
	if strings.TrimSpace(ownerID) == "" || strings.TrimSpace(query) == "" {
		return nil, ErrInvalidDocument
	}
	if s.embedder == nil {
		return nil, ErrEmbeddingUnavailable
	}
	if limit <= 0 || limit > 100 {
		limit = 5
	}
	queryVector, err := s.embedder.Embed(ctx, normalize(query))
	if err != nil {
		return nil, fmt.Errorf("embed query: %w", err)
	}
	queryModel, queryDimensions, queryVersion, infoErr := s.embeddingInfo(queryVector)
	if infoErr != nil {
		return nil, fmt.Errorf("embed query: %w", infoErr)
	}
	rows, err := s.db.QueryContext(ctx, `SELECT c.document_id,d.title,c.text,d.source,c.metadata_json,c.vector_json,c.embedding_model,c.embedding_dimensions,c.embedding_version FROM rag_chunks c JOIN rag_documents d ON d.id=c.document_id WHERE c.owner_id=?`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	results := make([]Result, 0)
	for rows.Next() {
		var r Result
		var metadataJSON, vectorJSON, model, version string
		var dimensions int
		if err := rows.Scan(&r.DocumentID, &r.Title, &r.Text, &r.Source, &metadataJSON, &vectorJSON, &model, &dimensions, &version); err != nil {
			return nil, err
		}
		if strings.TrimSpace(model) == "" || strings.TrimSpace(version) == "" || dimensions <= 0 {
			return nil, fmt.Errorf("%w: document %s has legacy or incomplete embedding metadata", ErrEmbeddingMismatch, r.DocumentID)
		}
		if model != queryModel || version != queryVersion || dimensions != queryDimensions {
			return nil, fmt.Errorf("%w: document %s uses model/version/dimensions %q/%q/%d, query uses %q/%q/%d", ErrEmbeddingMismatch, r.DocumentID, model, version, dimensions, queryModel, queryVersion, queryDimensions)
		}
		var vector []float32
		if json.Unmarshal([]byte(vectorJSON), &vector) != nil {
			return nil, fmt.Errorf("%w: document %s has invalid vector JSON", ErrEmbeddingMismatch, r.DocumentID)
		}
		if err := validateVector(vector, dimensions); err != nil {
			return nil, fmt.Errorf("%w: document %s vector: %v", ErrEmbeddingMismatch, r.DocumentID, err)
		}
		_ = json.Unmarshal([]byte(metadataJSON), &r.Metadata)
		r.Score = cosine(queryVector, vector)
		results = append(results, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.SliceStable(results, func(i, j int) bool { return results[i].Score > results[j].Score })
	if len(results) > limit {
		results = results[:limit]
	}
	return results, nil
}

// Update replaces a document and its chunks while preserving the document ID.
func (s *Service) Update(ctx context.Context, ownerID, documentID, title, content, source string, tags []string) (Document, error) {
	ownerID, documentID, title, content = strings.TrimSpace(ownerID), strings.TrimSpace(documentID), strings.TrimSpace(title), normalize(content)
	if ownerID == "" || documentID == "" || content == "" {
		return Document{}, ErrInvalidDocument
	}
	if s.embedder == nil {
		return Document{}, ErrEmbeddingUnavailable
	}
	if title == "" {
		title = "Untitled"
	}
	if source == "" {
		source = "manual"
	}
	parts := chunkText(content, s.chunkSize, s.overlap)
	if len(parts) == 0 {
		return Document{}, ErrInvalidDocument
	}
	var createdAt string
	if err := s.db.QueryRowContext(ctx, `SELECT created_at FROM rag_documents WHERE id=? AND owner_id=?`, documentID, ownerID).Scan(&createdAt); err != nil {
		return Document{}, err
	}
	vectors, models, dimensions, versions, err := s.embedParts(ctx, parts)
	if err != nil {
		return Document{}, err
	}
	if err := ctx.Err(); err != nil {
		return Document{}, err
	}
	now := time.Now().UTC()
	doc := Document{ID: documentID, OwnerID: ownerID, Title: title, Content: content, Tags: cleanTags(tags), Source: source, UpdatedAt: now}
	doc.CreatedAt, _ = time.Parse(time.RFC3339Nano, createdAt)
	tagsJSON, _ := json.Marshal(doc.Tags)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Document{}, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `UPDATE rag_documents SET title=?,content=?,tags_json=?,source=?,updated_at=? WHERE id=? AND owner_id=?`, doc.Title, doc.Content, string(tagsJSON), doc.Source, doc.UpdatedAt.Format(time.RFC3339Nano), doc.ID, doc.OwnerID); err != nil {
		return Document{}, err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM rag_chunks WHERE document_id=? AND owner_id=?`, doc.ID, doc.OwnerID); err != nil {
		return Document{}, err
	}
	for i, part := range parts {
		vectorJSON, _ := json.Marshal(vectors[i])
		metadataJSON, _ := json.Marshal(map[string]string{"title": doc.Title, "source": doc.Source, "chunk_index": fmt.Sprint(i), "embedding_version": versions[i]})
		if _, err = tx.ExecContext(ctx, `INSERT INTO rag_chunks(id,document_id,owner_id,chunk_index,text,metadata_json,vector_json,embedding_model,embedding_dimensions,embedding_version) VALUES(?,?,?,?,?,?,?,?,?,?)`, uuid.NewString(), doc.ID, doc.OwnerID, i, part, string(metadataJSON), string(vectorJSON), models[i], dimensions[i], versions[i]); err != nil {
			return Document{}, err
		}
	}
	if err = tx.Commit(); err != nil {
		return Document{}, err
	}
	return doc, nil
}

// Reindex re-embeds one owned document with the current provider and replaces
// its chunks atomically. Embedding happens before the write transaction, so a
// provider failure or cancellation leaves the existing index untouched.
func (s *Service) Reindex(ctx context.Context, ownerID, documentID string) (Document, error) {
	ownerID, documentID = strings.TrimSpace(ownerID), strings.TrimSpace(documentID)
	if ownerID == "" || documentID == "" {
		return Document{}, ErrInvalidDocument
	}
	var doc Document
	var tagsJSON, createdAt, updatedAt string
	if err := s.db.QueryRowContext(ctx, `SELECT id,owner_id,title,content,tags_json,source,created_at,updated_at FROM rag_documents WHERE id=? AND owner_id=?`, documentID, ownerID).
		Scan(&doc.ID, &doc.OwnerID, &doc.Title, &doc.Content, &tagsJSON, &doc.Source, &createdAt, &updatedAt); err != nil {
		return Document{}, err
	}
	if err := json.Unmarshal([]byte(tagsJSON), &doc.Tags); err != nil {
		return Document{}, fmt.Errorf("decode document tags: %w", err)
	}
	doc.CreatedAt, _ = time.Parse(time.RFC3339Nano, createdAt)
	doc.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updatedAt)
	return s.replaceDocument(ctx, doc)
}

func (s *Service) replaceDocument(ctx context.Context, doc Document) (Document, error) {
	parts := chunkText(doc.Content, s.chunkSize, s.overlap)
	if len(parts) == 0 {
		return Document{}, ErrInvalidDocument
	}
	vectors, models, dimensions, versions, err := s.embedParts(ctx, parts)
	if err != nil {
		return Document{}, err
	}
	if err := ctx.Err(); err != nil {
		return Document{}, err
	}
	doc.UpdatedAt = time.Now().UTC()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Document{}, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `UPDATE rag_documents SET updated_at=? WHERE id=? AND owner_id=?`, doc.UpdatedAt.Format(time.RFC3339Nano), doc.ID, doc.OwnerID); err != nil {
		return Document{}, err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM rag_chunks WHERE document_id=? AND owner_id=?`, doc.ID, doc.OwnerID); err != nil {
		return Document{}, err
	}
	for i, part := range parts {
		vectorJSON, _ := json.Marshal(vectors[i])
		metadataJSON, _ := json.Marshal(map[string]string{"title": doc.Title, "source": doc.Source, "chunk_index": fmt.Sprint(i), "embedding_version": versions[i]})
		if _, err = tx.ExecContext(ctx, `INSERT INTO rag_chunks(id,document_id,owner_id,chunk_index,text,metadata_json,vector_json,embedding_model,embedding_dimensions,embedding_version) VALUES(?,?,?,?,?,?,?,?,?,?)`, uuid.NewString(), doc.ID, doc.OwnerID, i, part, string(metadataJSON), string(vectorJSON), models[i], dimensions[i], versions[i]); err != nil {
			return Document{}, err
		}
	}
	if err = tx.Commit(); err != nil {
		return Document{}, err
	}
	return doc, nil
}

// OpenAIEmbedder is an explicit OpenAI-compatible embeddings adapter. It is
// never enabled implicitly; callers must provide endpoint, model and policy.
type OpenAIEmbedder struct {
	Client                 *http.Client
	BaseURL, APIKey, Model string
	Dimensions             int
	Version                string
}

// OpenAIEmbedderConfig is the explicit, local-only provider configuration.
type OpenAIEmbedderConfig struct {
	BaseURL, APIKey, Model string
	Dimensions             int
	Version                string
}

func NewOpenAIEmbedder(config OpenAIEmbedderConfig) (OpenAIEmbedder, error) {
	if _, err := embeddingEndpoint(config.BaseURL); err != nil {
		return OpenAIEmbedder{}, err
	}
	if strings.TrimSpace(config.Model) == "" || config.Dimensions <= 0 || strings.TrimSpace(config.Version) == "" {
		return OpenAIEmbedder{}, errors.New("embedding provider requires endpoint, model, positive dimensions, and version")
	}
	return OpenAIEmbedder{BaseURL: strings.TrimSpace(config.BaseURL), APIKey: config.APIKey, Model: strings.TrimSpace(config.Model), Dimensions: config.Dimensions, Version: strings.TrimSpace(config.Version)}, nil
}

func (e OpenAIEmbedder) EmbeddingModel() string   { return strings.TrimSpace(e.Model) }
func (e OpenAIEmbedder) EmbeddingDimension() int  { return e.Dimensions }
func (e OpenAIEmbedder) EmbeddingVersion() string { return strings.TrimSpace(e.Version) }
func (e OpenAIEmbedder) Embed(ctx context.Context, text string) ([]float32, error) {
	endpoint, err := embeddingEndpoint(e.BaseURL)
	if err != nil || strings.TrimSpace(e.Model) == "" || e.Dimensions <= 0 || strings.TrimSpace(e.Version) == "" {
		return nil, fmt.Errorf("%w: endpoint, model, positive dimensions, and version are required", ErrEmbeddingUnavailable)
	}
	client, err := e.localClient()
	if err != nil {
		return nil, err
	}
	body, _ := json.Marshal(map[string]any{"model": e.Model, "input": text})
	if len(body) > maxEmbeddingBodyBytes {
		return nil, errors.New("embedding provider request exceeds size limit")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(endpoint, "/")+"/embeddings", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if e.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+e.APIKey)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("embedding provider returned HTTP %d", resp.StatusCode)
	}
	limited := io.LimitReader(resp.Body, maxEmbeddingBodyBytes+1)
	responseBody, err := io.ReadAll(limited)
	if err != nil {
		return nil, err
	}
	if len(responseBody) > maxEmbeddingBodyBytes {
		return nil, errors.New("embedding provider response exceeds size limit")
	}
	var payload struct {
		Data []struct {
			Embedding []float32 `json:"embedding"`
		} `json:"data"`
	}
	if err := json.Unmarshal(responseBody, &payload); err != nil {
		return nil, err
	}
	if len(payload.Data) == 0 || len(payload.Data[0].Embedding) == 0 {
		return nil, ErrEmbeddingMismatch
	}
	if err := validateVector(payload.Data[0].Embedding, e.Dimensions); err != nil {
		return nil, err
	}
	return payload.Data[0].Embedding, nil
}

func (e OpenAIEmbedder) localClient() (*http.Client, error) {
	base := e.Client
	if base == nil {
		base = &http.Client{}
	}
	client := *base
	if client.Timeout <= 0 || client.Timeout > defaultEmbeddingTimeout {
		client.Timeout = defaultEmbeddingTimeout
	}
	client.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
		return errors.New("embedding provider redirects are disabled")
	}
	transport, ok := base.Transport.(*http.Transport)
	if base.Transport == nil {
		transport = http.DefaultTransport.(*http.Transport)
		ok = true
	}
	if !ok {
		return nil, errors.New("embedding provider requires an HTTP transport")
	}
	cloned := transport.Clone()
	cloned.Proxy = nil
	cloned.DialContext = loopbackDialContext
	client.Transport = cloned
	return &client, nil
}

func embeddingEndpoint(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u == nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", errors.New("embedding endpoint must be an absolute loopback HTTP(S) URL")
	}
	host := strings.ToLower(u.Hostname())
	if host != "localhost" {
		ip := net.ParseIP(host)
		if ip == nil || !ip.IsLoopback() {
			return "", errors.New("embedding endpoint must use localhost or a loopback IP")
		}
	}
	u.Path = strings.TrimRight(u.Path, "/")
	return u.String(), nil
}

func loopbackDialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	addresses, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, err
	}
	dialer := &net.Dialer{}
	for _, candidate := range addresses {
		if !candidate.IP.IsLoopback() {
			continue
		}
		conn, dialErr := dialer.DialContext(ctx, network, net.JoinHostPort(candidate.IP.String(), port))
		if dialErr == nil {
			return conn, nil
		}
	}
	return nil, errors.New("embedding endpoint resolved outside loopback")
}

func (s *Service) Delete(ctx context.Context, ownerID, documentID string) error {
	if strings.TrimSpace(ownerID) == "" || strings.TrimSpace(documentID) == "" {
		return ErrInvalidDocument
	}
	result, err := s.db.ExecContext(ctx, `DELETE FROM rag_documents WHERE id=? AND owner_id=?`, documentID, ownerID)
	if err != nil {
		return err
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func normalize(raw string) string {
	return strings.Join(strings.FieldsFunc(raw, func(r rune) bool { return unicode.IsSpace(r) }), " ")
}

func chunkText(text string, size, overlap int) []string {
	if size <= 0 {
		size = 500
	}
	if overlap < 0 || overlap >= size {
		overlap = size / 5
	}
	runes := []rune(text)
	var chunks []string
	for start := 0; start < len(runes); {
		end := start + size
		if end > len(runes) {
			end = len(runes)
		}
		if part := strings.TrimSpace(string(runes[start:end])); part != "" {
			chunks = append(chunks, part)
		}
		if end == len(runes) {
			break
		}
		start = end - overlap
	}
	return chunks
}

func validateVector(vector []float32, expected int) error {
	if expected <= 0 || len(vector) == 0 || len(vector) != expected {
		return fmt.Errorf("%w: vector dimension %d does not match positive expected dimension %d", ErrEmbeddingMismatch, len(vector), expected)
	}
	for i, value := range vector {
		if math.IsNaN(float64(value)) || math.IsInf(float64(value), 0) {
			return fmt.Errorf("%w: vector value %d is not finite", ErrEmbeddingMismatch, i)
		}
	}
	return nil
}

func cleanTags(tags []string) []string {
	seen := map[string]bool{}
	result := make([]string, 0, len(tags))
	for _, tag := range tags {
		tag = strings.TrimSpace(tag)
		if tag != "" && !seen[tag] {
			seen[tag] = true
			result = append(result, tag)
		}
	}
	return result
}

func cosine(a, b []float32) float64 {
	if len(a) == 0 || len(a) != len(b) {
		return 0
	}
	var dot, aa, bb float64
	for i := range a {
		x, y := float64(a[i]), float64(b[i])
		dot += x * y
		aa += x * x
		bb += y * y
	}
	if aa == 0 || bb == 0 {
		return 0
	}
	return dot / (math.Sqrt(aa) * math.Sqrt(bb))
}
