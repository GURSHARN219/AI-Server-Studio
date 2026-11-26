// Package modelregistry provides durable, file-backed registration for local
// GGUF models. Registration records references to files; it never copies,
// moves, or removes model files.
package modelregistry

import (
	"context"
	"database/sql"
)

const (
	// Unknown is used for values that the registry cannot establish safely.
	Unknown = "unknown"

	// UnknownSize is the explicit size value used when a registered file is not
	// currently available.
	UnknownSize int64 = -1

	// UnknownCount is the explicit count value used for unavailable metadata.
	UnknownCount int64 = -1
)

// TokenizerMetadata is the small, stable subset of tokenizer metadata useful
// to a model server. Unknown fields remain Unknown; they are never inferred
// from a model filename.
type TokenizerMetadata struct {
	Model      string `json:"model"`
	Pre        string `json:"pre"`
	TokenType  string `json:"token_type"`
	TokenCount int64  `json:"token_count"`
}

// GGUFMetadata contains metadata read from a GGUF header. Status is Known
// only when the header and all metadata values were parsed safely.
type GGUFMetadata struct {
	Status       string            `json:"status"`
	Version      uint32            `json:"version"`
	Architecture string            `json:"architecture"`
	Quantization string            `json:"quantization"`
	Tokenizer    TokenizerMetadata `json:"tokenizer"`
}

// LastLoadInfo records the most recent load attempt. At is an RFC3339 UTC
// timestamp or Unknown when no load attempt has been recorded.
type LastLoadInfo struct {
	Status string `json:"status"`
	Error  string `json:"error"`
	At     string `json:"at"`
}

// Model is the durable registry representation. Exists and Stale are derived
// from the filesystem when returned and are not persisted as authoritative
// facts.
type Model struct {
	ID                  int64
	Path                string
	Filename            string
	Size                int64
	Source              string
	RepositoryID        string
	RepositoryRevision  string
	Architecture        string
	Quantization        string
	Tokenizer           TokenizerMetadata
	CompatibilityStatus string
	LoadStatus          string
	LastLoad            LastLoadInfo
	RegisteredAt        int64
	UpdatedAt           int64
	Exists              bool
	Stale               bool
}

// RegisterRequest controls one registration or refresh operation.
type RegisterRequest struct {
	Path               string
	Source             string
	RepositoryID       string
	RepositoryRevision string
}

// LoadResult is supplied after a server attempts to load a model.
type LoadResult struct {
	Status string
	Error  string
	At     string // RFC3339 timestamp; empty means use the current UTC time.
}

// DiscoveredModel is a filesystem result ready for Register.
type DiscoveredModel struct {
	Path     string
	Size     int64
	Metadata GGUFMetadata
}

// Registry is the durable model registry backed by an existing SQLite pool.
type Registry struct {
	db *sql.DB
}

// New applies the registry migration and returns a registry using db. The
// caller owns db and remains responsible for closing it.
func New(db *sql.DB) (*Registry, error) {
	if db == nil {
		return nil, ErrDatabaseUnavailable
	}
	if err := applyMigration(db); err != nil {
		return nil, err
	}
	return &Registry{db: db}, nil
}

// NewRegistry is an explicit alias for New for callers that prefer the
// concrete package concept in their construction code.
func NewRegistry(db *sql.DB) (*Registry, error) { return New(db) }

// RegisterPath is a convenience wrapper around Register.
func (r *Registry) RegisterPath(ctx context.Context, path, source string) (Model, error) {
	return r.Register(ctx, RegisterRequest{Path: path, Source: source})
}
