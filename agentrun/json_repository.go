package agentrun

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
)

const SchemaVersion = 1

var (
	ErrCorrupt       = errors.New("corrupt agent run repository")
	ErrSchemaVersion = errors.New("unsupported agent run schema version")
	repositoryLocks  sync.Map
	runIDPattern     = regexp.MustCompile(`^run-[A-Za-z0-9-]+$`)
)

type runFile struct {
	SchemaVersion int `json:"schemaVersion"`
	Run           Run `json:"run"`
}

type JSONRepository struct {
	dir string
	mu  *sync.Mutex
}

func NewJSONRepository(dir string) (*JSONRepository, error) {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(abs, 0700); err != nil {
		return nil, err
	}
	key := filepath.Clean(abs)
	// Windows paths are case insensitive.
	if filepath.Separator == '\\' {
		key = strings.ToLower(key)
	}
	lock, _ := repositoryLocks.LoadOrStore(key, &sync.Mutex{})
	return &JSONRepository{dir: abs, mu: lock.(*sync.Mutex)}, nil
}

func validateRun(run Run) error {
	if !runIDPattern.MatchString(run.ID) || !run.Status.Valid() || run.CreatedAt <= 0 {
		return fmt.Errorf("%w: invalid run identity, status or timestamp", ErrCorrupt)
	}
	for i, event := range run.Events {
		if event.Sequence != uint64(i+1) || event.Type == "" || event.Timestamp <= 0 {
			return fmt.Errorf("%w: invalid event sequence", ErrCorrupt)
		}
		if event.RunID != "" && event.RunID != run.ID {
			return fmt.Errorf("%w: event run identity mismatch", ErrCorrupt)
		}
	}
	if run.Status.Terminal() != (run.CompletedAt > 0) {
		return fmt.Errorf("%w: inconsistent terminal state", ErrCorrupt)
	}
	if run.Checkpoint != nil && (run.Checkpoint.EventSequence > uint64(len(run.Events)) || run.Checkpoint.Boundary == "") {
		return fmt.Errorf("%w: invalid checkpoint", ErrCorrupt)
	}
	return nil
}

func (r *JSONRepository) List() ([]Run, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	entries, err := os.ReadDir(r.dir)
	if err != nil {
		return nil, err
	}
	runs := make([]Run, 0, len(entries))
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		path := filepath.Join(r.dir, entry.Name())
		if !entry.Type().IsRegular() {
			return nil, fmt.Errorf("%w: non-regular run file %s", ErrCorrupt, path)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		var document runFile
		if err := json.Unmarshal(data, &document); err != nil {
			return nil, fmt.Errorf("%w: %s: %v", ErrCorrupt, path, err)
		}
		if document.SchemaVersion != SchemaVersion {
			return nil, fmt.Errorf("%w: %s has version %d", ErrSchemaVersion, path, document.SchemaVersion)
		}
		if err := validateRun(document.Run); err != nil {
			return nil, fmt.Errorf("%s: %w", path, err)
		}
		if entry.Name() != document.Run.ID+".json" {
			return nil, fmt.Errorf("%w: filename/id mismatch", ErrCorrupt)
		}
		runs = append(runs, document.Run)
	}
	return runs, nil
}

func (r *JSONRepository) Save(run Run) error {
	if err := validateRun(run); err != nil {
		return err
	}
	data, err := json.Marshal(runFile{SchemaVersion: SchemaVersion, Run: run})
	if err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.writeLocked(run, data)
}

// Create atomically performs caller-supplied-ID creation. A compatible retry
// returns the existing durable state without replacing its file.
func (r *JSONRepository) Create(run Run) (Run, error) {
	if err := validateRun(run); err != nil {
		return Run{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	path := filepath.Join(r.dir, run.ID+".json")
	data, err := os.ReadFile(path)
	if err == nil {
		var document runFile
		if err = json.Unmarshal(data, &document); err != nil {
			return Run{}, fmt.Errorf("%w: %s: %v", ErrCorrupt, path, err)
		}
		if document.SchemaVersion != SchemaVersion || document.Run.ID != run.ID {
			return Run{}, fmt.Errorf("%w: invalid existing run file", ErrCorrupt)
		}
		if err = validateRun(document.Run); err != nil {
			return Run{}, fmt.Errorf("%s: %w", path, err)
		}
		if err = creationConflict(document.Run, run); err != nil {
			return Run{}, err
		}
		return document.Run, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return Run{}, err
	}
	data, err = json.Marshal(runFile{SchemaVersion: SchemaVersion, Run: run})
	if err != nil {
		return Run{}, err
	}
	if err = r.writeLocked(run, data); err != nil {
		return Run{}, err
	}
	return run, nil
}

func (r *JSONRepository) writeLocked(run Run, data []byte) error {
	// A unique temporary file in the same directory keeps rename on one volume.
	f, err := os.CreateTemp(r.dir, ".run-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	if err = os.Rename(f.Name(), filepath.Join(r.dir, run.ID+".json")); err != nil {
		return err
	}
	return nil
}
